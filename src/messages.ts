/**
 * M1 — session-log projection: DSH surface events → acp-kernel CoreMessage.
 *
 * The ACP kernel is message-array based; DSH is event-log based. This module
 * is the bridge in the direction the engine needs (projectEvent /
 * eventsToCoreMessages). The reverse direction (CoreMessage[] → session
 * appends) is the M5 region transaction's job.
 * Mirrors billion-context-pi's `projectMessage`/`entriesToCoreMessages`
 * against DSH event shapes (see V-verification: SurfaceEventType =
 * 'user/message' | 'assistant/message' | 'tool/result').
 * @module billion-context-pi-dsh/messages
 */

import type { CoreMessage, MessageProvenance } from 'acp-kernel'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { eventAtOf, sessionEventsOf } from './session-events.ts'
import { decodeAcpBlockLedger } from './block-ledger.ts'
import { claimSplicedEvent, eventAlreadyTraced, messageAlreadyTraced, traceEnabled, traceInjectedMessage, traceSurfaceEvent } from './inject-trace.ts'

// DSH ≥0.1.7's V4 session format admits producer-owned source kinds
// ('plugin:<name>') and rejects the legacy wrapper shape
// `{ kind: 'plugin', plugin: '<name>' }` (issue #163). dsh-llm's
// MessageSourceMap predates V4 admission, so register this plugin's two
// producer kinds on its documented merge-extensibility seam ("plugins add
// their own kinds"). Type-level only — no runtime effect.
// The target MUST be the package ROOT specifier '@deepseek-ai/dsh-llm' —
// the same spelling dsh-compaction uses for its 'compact-checkpoint' member
// (0.2.0 line). The map lives on the ROOT module as of the 0.2.0 line (the
// `/message` subpath export is gone; dsh-compaction itself augments the
// root), and under tsgo (typescript 7) augmenting the '/message' subpath
// splits the MessageSourceMap symbol, so the host packages' root-spelled
// augmentations stop merging into it and the checkpoint write fails
// typecheck with TS2322. The root spelling is also what the pre-0.2.0 lines
// need (measured green on the 0.1.5-rc.2 baseline too), so it is the one
// spelling that serves every admitted line.
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    acpNudge: { kind: 'plugin:acp-nudge' }
    acpPrune: { kind: 'plugin:billion-context' }
    // V4 checkpoint producer kind (issue #181): emitted by checkpointSourceFor
    // when the resolved dsh-compaction copy predates the host's v4 writer and
    // its wrapper-shaped compactCheckpointSource() output is normalized.
    compactCheckpoint: { kind: 'compact-checkpoint'; compactionId: string; sourceCommandId?: string }
  }
}

/**
 * Extract plain text from a DSH content block array or string.
 *
 * Recursive: a real DSH `tool-result` block is `{ type: 'tool-result',
 * toolCallId, content: ContentBlock[] }` — the inner `content` array holds
 * the actual `text` blocks, so a top-level-only walk would drop every tool
 * result from the projection (and with it the seq's ref assignment, breaking
 * compress boundary resolution). Nested arrays are flattened depth-first.
 *
 * That nesting is the PRE-0.2.0 shape. On the 0.2.0 seam line a tool result is
 * a first-class ToolResultMessage whose content blocks are plain
 * text/image/file blocks — nothing to unwrap — so the recursive branch simply
 * finds the text one level up. It stays because this engine supports every
 * line in its declared peer range, and a top-level-only walk would silently
 * drop text on the older ones.
 *
 * Non-text blocks that the provider still bills for render as a deterministic
 * one-line placeholder instead of vanishing (issue #117). An `image`/`file`
 * block used to contribute nothing, which silently made a picture-only user
 * message — or a tool result carrying a screenshot — invisible to the engine:
 * no ref (so no compress boundary), `anchorsRangeEdge` false (so the range
 * solver shrank past it and swallowed neighbours), invisible to the kernel's
 * recent/last-user protection (so the last real user turn could be compressed
 * away), priced at zero tokens, and absent from search/decompress output. The
 * host itself projects non-text references to deterministic handle text for
 * files ("request assembly projects every occurrence to deterministic handle
 * text", dsh-llm/lib/types/types.d.ts), and this is the same idea one layer
 * down. Only durable attachment metadata is used, so the placeholder is stable
 * across turns (cache prefix, summary text, search hits).
 */
export function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const b = block as { type?: unknown; text?: unknown; content?: unknown; attachment?: unknown }
    if (b.type === 'text' && typeof b.text === 'string') {
      parts.push(b.text)
    } else if (b.type === 'image' || b.type === 'file') {
      const placeholder = attachmentPlaceholder(b.type, b.attachment)
      if (placeholder !== null) parts.push(placeholder)
    } else if (Array.isArray(b.content)) {
      parts.push(extractText(b.content))
    }
  }
  return parts.join('\n')
}

/** Byte size as a short human string — deterministic, never locale-dependent. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

/**
 * One-line stand-in for an image/file block. Reads only durable attachment
 * metadata (media type, pixel size, byte length, display name) — never bytes,
 * paths or URLs — so the text is safe to feed back as a summary, to search,
 * and to send to the provider.
 */
function attachmentPlaceholder(type: 'image' | 'file', attachment: unknown): string | null {
  if (attachment === null || typeof attachment !== 'object') return null
  const a = attachment as {
    mediaType?: unknown
    width?: unknown
    height?: unknown
    bytes?: unknown
    name?: unknown
  }
  const name = typeof a.name === 'string' && a.name.length > 0 ? a.name : undefined
  const size = typeof a.bytes === 'number' && Number.isFinite(a.bytes) ? ` ${formatBytes(a.bytes)}` : ''
  if (type === 'file') return `[file ${name ?? 'attachment'}${size}]`
  const mediaType = typeof a.mediaType === 'string' && a.mediaType.length > 0 ? a.mediaType : 'image'
  const dimensions = typeof a.width === 'number' && typeof a.height === 'number' ? ` ${a.width}x${a.height}` : ''
  return `[image ${mediaType}${name ? ` ${name}` : ''}${dimensions}${size}]`
}

interface ToolCallBlock {
  type: 'tool-call'
  id?: string
  name?: string
  arguments?: unknown
}

/**
 * The tool-call blocks of one assistant content array, in CONTENT order.
 * Shared with the range-edge layer (src/region.ts `anchorsRangeEdge`,
 * src/tools.ts `edgeRefForSeq`): projection order IS this order (projectEvent
 * maps the calls in sequence), so "the node's first/last sub-message id" is
 * derivable from it without re-implementing the filter anywhere else.
 */
export function toolCallsOf(content: unknown): ToolCallBlock[] {
  if (!Array.isArray(content)) return []
  return content.filter((b): b is ToolCallBlock => (b as { type?: string }).type === 'tool-call')
}

function stringifyArgs(args: unknown): string {
  if (!args) return ''
  if (typeof args === 'string') return args
  try {
    return JSON.stringify(args)
  } catch {
    return String(args)
  }
}

/**
 * The tool-call id of one tool/result surface message, or null.
 *
 * Three durable locations, in priority order (hard-won rule 10): the
 * MESSAGE-level `toolCallId` field (written by dsh-llm's createToolResultMessage
 * on the 0.1.7+ lines), the nested `{ type: 'tool-result', toolCallId }`
 * content block, then `message.source.callId` (present on every line). A real
 * event carries at least two of the three; the order only matters for
 * fixtures that set a subset. Shared with `src/region.ts`'s call/result
 * pairing — one implementation, never a copy.
 */
export function toolCallIdOfResultEvent(event: SessionEvent): string | null {
  if (event.type !== 'tool/result') return null
  // Structural read through `unknown`: the typed event data names dsh-llm's
  // ContentBlock union (readonly, toolCallId only on some members), which no
  // single straight assertion overlaps with across seam lines.
  const message = (event.data as unknown as {
    message?: {
      toolCallId?: unknown
      content?: Array<{ type?: unknown; toolCallId?: unknown }>
      source?: { callId?: unknown }
    }
  }).message
  const block = Array.isArray(message?.content)
    ? message.content.find((candidate) => candidate?.type === 'tool-result')
    : undefined
  const id = message?.toolCallId ?? block?.toolCallId ?? message?.source?.callId
  return typeof id === 'string' ? id : null
}

/**
 * Index of assistant tool-call `id` → tool `name`, used to attribute
 * tool/result messages to their tool. Real DSH tool-results carry no
 * `message.toolName` (rule 10), so the projection backfills it from the
 * matching assistant tool-call. Scans ALL events up front (order-independent:
 * a result may precede its call in the array) and covers shadowed calls too.
 */
export function buildToolCallIndex(events: readonly SessionEvent[]): ReadonlyMap<string, string> {
  const index = new Map<string, string>()
  for (const event of events) {
    if (event.type !== 'assistant/message') continue
    const content = (event.data as { message?: { content?: unknown } }).message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      const candidate = block as { type?: unknown; id?: unknown; name?: unknown } | null
      if (candidate !== null && typeof candidate === 'object' && candidate.type === 'tool-call' && typeof candidate.id === 'string') {
        index.set(candidate.id, typeof candidate.name === 'string' ? candidate.name : '')
      }
    }
  }
  return index
}

/**
 * Project one surface message event into CoreMessage(s).
 *  - user/message      → user text (verbatim content)
 *  - assistant/message → assistant text, or one CoreMessage per tool-call
 *  - tool/result       → tool result (role 'tool'); toolName/toolCallId are
 *                        backfilled from `toolNames` (assistant tool-call
 *                        index) — real DSH events do not carry them at the
 *                        message level. Without an index the result stays
 *                        untagged (`toolName: ''`), never "text".
 * Non-surface events project to nothing.
 */
/**
 * B1 summary source framing. A compaction summary is MODEL-WRITTEN text, not
 * user words — injected as a user/message with the same standing as real input,
 * which let obligation sentences inside summaries read as user directives and
 * the model's own guesses read as user commitments. The frame says both things
 * up front. It is applied at creation (src/region.ts writes the framed blocks
 * to BOTH durable writes) and again at projection (below) as an idempotent
 * safety net for legacy blocks written before the feature.
 */
export const SUMMARY_FRAME_PREFIX = '[Model-written summary — not user words; re-verify any obligations before relying on them]'

export function withSummaryFramePrefix(text: string): string {
  if (text.startsWith(SUMMARY_FRAME_PREFIX)) return text
  // Engine-written summaries are exempt: the frame claims a provenance they do
  // not have ("Model-written …"). Deciding that HERE — in the one function the
  // creation write (region.ts `prefixSummaryBlocks`) and the projection net
  // (`projectEvent`) both go through — keeps the durable text and the
  // model-visible text identical by construction, instead of by two call-site
  // conditions that drift apart.
  if (isEngineWrittenSummary(text)) return text
  return `${SUMMARY_FRAME_PREFIX}\n${text}`
}

/**
 * The lead-in of a summary the ENGINE writes itself — today only the
 * context-overflow emergency marker (src/index.ts `compactForOverflow`).
 * Recognition is by content, not by caller: the writer and both framing sites
 * share this ONE literal.
 */
export const ENGINE_SUMMARY_LEAD = '[engine-written summary — context-overflow emergency compaction'

export function isEngineWrittenSummary(text: string): boolean {
  return text.startsWith(ENGINE_SUMMARY_LEAD)
}

/**
 * The block summary the automatic overflow recovery writes. It is the engine's
 * own note — not model-written text, not user words — saying which range was
 * hidden to get the request under the window and where the originals still
 * live (the append-only log: search_context/decompress rebuild from it).
 */
export function overflowMarkerSummary(hiddenCount: number): string {
  return `${ENGINE_SUMMARY_LEAD}: ${hiddenCount} surface message(s) hidden because the provider rejected the request as exceeding the context window. The originals are intact in the session log — use search_context or decompress (see acp_status) to read them, or re-run the compress tool over this range to write a proper summary.]`
}

/**
 * Kernel block id per compaction id, read from the durable block ledger.
 *
 * The kernel needs the block id on every host-carried checkpoint message:
 * `CoreMessage.summaryOfBlockId` tells it that this message is the host's own
 * rendering of a compression block, so a PLAIN message-ref range does not
 * supersede that block — the kernel keeps the carrier visible and says so in
 * its warning list (upstream #335, adopted with the 0.0.101 pin). A carrier of
 * an inactive or unknown block folds normally, so an absent/legacy id degrades
 * to the pre-#335 behavior instead of over-protecting.
 *
 * The join key (the `compaction/summary` `compactionId`) and the two accepted
 * field locations (rawOutput-embedded payload, then the legacy top-level
 * member) mirror `rebuildBlockLedger` in src/region.ts. That twin cannot be
 * called from here: the region layer imports this module, so the dependency
 * would cycle. `tests/checkpoint-span.test.ts` pins the two in lockstep.
 */
export function kernelBlockIdByCompactionId(
  events: readonly SessionEvent[],
): ReadonlyMap<string, string> {
  const map = new Map<string, string>()
  for (const event of events) {
    if (event.type !== 'compaction/summary') continue
    const data = event.data as { compactionId?: unknown; rawOutput?: unknown; kernelBlockId?: unknown }
    const compactionId = typeof data.compactionId === 'string' ? data.compactionId : null
    if (compactionId === null) continue
    const embedded = decodeAcpBlockLedger(data.rawOutput).kernelBlockId
    const kernelBlockId = embedded ?? (typeof data.kernelBlockId === 'string' ? data.kernelBlockId : null)
    if (kernelBlockId !== null && kernelBlockId !== undefined) map.set(compactionId, kernelBlockId)
  }
  return map
}

export function projectEvent(
  event: SessionEvent,
  toolNames?: ReadonlyMap<string, string>,
  kernelBlockIds?: ReadonlyMap<string, string>,
): CoreMessage[] {
  switch (event.type) {
    case 'user/message': {
      const raw = extractText((event.data as { content?: unknown }).content)
      // B1: frame compaction summaries at projection too (idempotent — creation-time
      // framing already covers new blocks; this catches legacy blocks whose nodes
      // were written before the feature existed).
      const text = isCheckpointNode(event) ? withSummaryFramePrefix(raw) : raw
      if (text.length === 0) return []
      const compactionId = isCheckpointNode(event) ? checkpointCompactionIdOf(event) : null
      const summaryOfBlockId = compactionId === null ? undefined : kernelBlockIds?.get(compactionId)
      return [{
        id: String(event.seq),
        role: 'user',
        contentType: 'text',
        text,
        // TASK-7/8：来源标签。传给内核后，保真门只查 `user-turn` / `user-material`，
        // 原文保护名单只保护这两类**加无标签**的（两条方向相反，见各自注释）。
        // 用 `raw`（未加检查点框的原文）判材料，避免框文本污染开头判定。
        provenance: provenanceOfEvent(event, raw),
        ...(summaryOfBlockId === undefined ? {} : { summaryOfBlockId }),
      }]
    }
    case 'assistant/message': {
      const content = (event.data as { message?: { content?: unknown } }).message?.content
      const calls = toolCallsOf(content)
      const text = extractText(content)
      if (calls.length === 0) {
        return text.trim().length > 0
          ? [{ id: String(event.seq), role: 'assistant', contentType: 'text', text }]
          : []
      }
      if (calls.length === 1) {
        const call = calls[0]!
        const argStr = stringifyArgs(call.arguments)
        const body = argStr && text ? `${text}\n${argStr}` : argStr || text
        return [{
          id: String(event.seq),
          role: 'assistant',
          contentType: 'tool-call',
          toolName: call.name ?? '',
          toolCallId: call.id ?? '',
          text: body,
        }]
      }
      return calls.map((call) => ({
        id: `${event.seq}#${call.id ?? ''}`,
        role: 'assistant' as const,
        contentType: 'tool-call' as const,
        toolName: call.name ?? '',
        toolCallId: call.id ?? '',
        text: stringifyArgs(call.arguments) || text,
      }))
    }
    case 'tool/result': {
      const message = (event.data as {
        message?: { content?: unknown; toolName?: string; toolCallId?: string }
      }).message
      const text = extractText(message?.content)
      if (text.length === 0) return []
      const key = toolCallIdOfResultEvent(event)
      return [{
        id: String(event.seq),
        role: 'tool',
        contentType: 'tool-result',
        toolName: toolNames?.get(key ?? '') ?? '',
        toolCallId: message?.toolCallId ?? key ?? '',
        text,
      }]
    }
    default:
      return []
  }
}

/** Project a session's message events into CoreMessage[] in log order. */
export function eventsToCoreMessages(events: readonly SessionEvent[], toolNames?: ReadonlyMap<string, string>): CoreMessage[] {
  const index = toolNames ?? buildToolCallIndex(events)
  const out: CoreMessage[] = []
  // The compactionId → block-id map is built LAZILY: a session with no
  // checkpoint carrier on its surface pays nothing, and a session with them
  // pays one pass over the log (the numbers only matter for the checkpoint
  // branch of projectEvent).
  let kernelBlockIds: ReadonlyMap<string, string> | null = null
  for (const event of events) {
    if (kernelBlockIds === null && isCheckpointNode(event)) kernelBlockIds = kernelBlockIdByCompactionId(events)
    out.push(...projectEvent(event, index, kernelBlockIds ?? undefined))
  }
  return out
}

/**
 * 改进 5b（TASK-4）—— 运行时上下文快照的「只留最新一份」。
 *
 * 5a 插桩在真实会话（session-063661eb，459 个文本块 / 804,575 字符）上量到：
 * 重复注入 370,965 字符（46.11%），其中 `Current runtime context` 快照 45 份、
 * 248,674 字符，**单份 10,845 字符** —— 逐版本累积，占总浪费的 64.1%。
 *
 * 为什么可以只留最新一份（而不是"缓存 + 增量"）：
 * 快照文本自身声明 `This snapshot supersedes earlier runtime context`，即后一份是
 * **全量状态**、对前一份没有增量语义。宿主的追加门是「本次快照文本与 retained 不同才
 * 追加一行」（见 REAL_CONTENT_PLUGINS 注释），与我们是否投影旧行无关，因此折叠旧行
 * **不会**诱发宿主重注入循环。
 *
 * 口径：同一份快照的稳定指纹 = 归一化后的前 {@link SNAPSHOT_FP_CHARS} 字符
 * （与 5a 插桩的 `fp120` 同源）。同指纹分组内只保留**最后**一条。
 *
 * 安全边界：本函数只用于 surface 投影（发给模型的视图）；`allLogMessages` 走全量
 * 日志、**绝不去重** —— 内核的 T2/T3 蒸馏要能锚到每一条历史消息。
 */
const SNAPSHOT_PREFIX = 'Current runtime context'
const SNAPSHOT_FP_CHARS = 120

function snapshotTextOf(message: CoreMessage): string | undefined {
  if (message.role !== 'user' || message.contentType !== 'text') return undefined
  const text = message.text ?? ''
  return text.startsWith(SNAPSHOT_PREFIX) ? text : undefined
}

function snapshotFingerprint(text: string): string {
  return text.slice(0, SNAPSHOT_FP_CHARS).replace(/\s+/g, ' ')
}

/**
 * 折叠被后续快照完全覆盖的旧快照行（保留每个指纹的最后一条）。
 * 无快照时原样返回新数组（不共享引用，调用方可安全排序）。
 */
export function dedupeSupersededSnapshots(
  messages: readonly CoreMessage[],
): CoreMessage[] {
  const lastIndexOf = new Map<string, number>()
  const drop = new Set<number>()
  messages.forEach((message, index) => {
    const text = snapshotTextOf(message)
    if (text === undefined) return
    const fingerprint = snapshotFingerprint(text)
    const previous = lastIndexOf.get(fingerprint)
    if (previous !== undefined) drop.add(previous)
    lastIndexOf.set(fingerprint, index)
  })
  if (drop.size === 0) return [...messages]
  return messages.filter((_, index) => !drop.has(index))
}

/**
 * 发给模型的 surface 视图 = 全量投影 + 快照折叠。
 *
 * 所有消费者（pre-step 压缩、nudge 范围表、compress/status 工具）都必须走这一个
 * 入口，否则「ref 表里有的消息模型看不到」「模型看到的消息 ref 表里没有」两类
 * 错位会同时出现。
 */
export function surfaceCoreMessages(
  events: readonly SessionEvent[],
  toolNames?: ReadonlyMap<string, string>,
): CoreMessage[] {
  return dedupeSupersededSnapshots(eventsToCoreMessages(events, toolNames))
}

/** The surface-visible message events of a session, in model-visible order. */
export function surfaceEventsOf(session: Session): SessionEvent[] {
  return session.surface.nodes
    .map((seq) => eventAtOf(session, seq))
    .filter((event): event is SessionEvent => event !== undefined)
}

/**
 * ALL message-type events in log order — the visible surface PLUS everything
 * shadowed by compression. The ACP kernel deactivates any block whose consumed
 * message ids are absent from the array it is given (syncBlocks), and refuses
 * to anchor a block boundary that cannot find its messages, so T2/T3
 * distillation requires the full log, not just the visible surface.
 */
export function allLogMessages(session: import('@deepseek-ai/dsh-session').Session): CoreMessage[] {
  return eventsToCoreMessages(sessionEventsOf(session))
}

/** Extract the model-facing text of any surface message event. */
export function extractEventText(event: SessionEvent): string {
  switch (event.type) {
    case 'user/message':
      return extractText((event.data as { content?: unknown }).content)
    case 'assistant/message':
      return extractText((event.data as { message?: { content?: unknown } }).message?.content)
    case 'tool/result':
      return extractText((event.data as { message?: { content?: unknown } }).message?.content)
    default:
      return ''
  }
}

/** Count image/file blocks reachable from a content payload (same walk as extractText). */
export function countAttachmentBlocks(content: unknown): { images: number; files: number } {
  const counts = { images: 0, files: 0 }
  countAttachments(content, counts)
  return counts
}

function countAttachments(content: unknown, counts: { images: number; files: number }): void {
  if (!Array.isArray(content)) return
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const b = block as { type?: unknown; content?: unknown }
    if (b.type === 'image') counts.images += 1
    else if (b.type === 'file') counts.files += 1
    else if (Array.isArray(b.content)) countAttachments(b.content, counts)
  }
}

/**
 * Attachments carried by one surface event, walked exactly like
 * `extractEventText`. Used in two places: the compressible-range rows mark
 * media-bearing spans, and the callers that already own a token meter price
 * those spans with the provider-anchored media price instead of the text-only
 * estimate (issue #117).
 */
export function attachmentsOfEvent(event: SessionEvent): { images: number; files: number } {
  return countAttachmentBlocks(contentBlocksOfEvent(event))
}

/**
 * The image/file blocks themselves (not just their counts), in document order.
 * The compressible-range rows price these with the fixed-heuristic media price
 * when the meter reports no routed surcharge, so a media-bearing span is never
 * shown as free (issue #117).
 */
export function mediaBlocksOfEvent(event: SessionEvent): readonly unknown[] {
  const blocks: unknown[] = []
  collectMediaBlocks(contentBlocksOfEvent(event), blocks)
  return blocks
}

function collectMediaBlocks(content: unknown, out: unknown[]): void {
  if (!Array.isArray(content)) return
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const b = block as { type?: unknown; content?: unknown }
    if (b.type === 'image' || b.type === 'file') out.push(block)
    else if (Array.isArray(b.content)) collectMediaBlocks(b.content, out)
  }
}

/** Where one surface event keeps its typed content blocks (never text). */
function contentBlocksOfEvent(event: SessionEvent): unknown {
  switch (event.type) {
    case 'user/message':
      return (event.data as { content?: unknown }).content
    case 'assistant/message':
    case 'tool/result':
      return (event.data as { message?: { content?: unknown } }).message?.content
    default:
      return undefined
  }
}

/**
 * Whether a surface user message is a compaction checkpoint node (already
 * compressed). Defined here (not in region.ts) so the classifier below and
 * region.ts share ONE implementation.
 *
 * Recognizes BOTH host shapes (issue #168): the ≤0.1.6 wrapper
 * `{ kind: 'plugin', plugin: 'compact', compactionId }` and the 0.1.7+
 * producer-owned kind `{ kind: 'compact-checkpoint', compactionId }` written
 * by dsh-compaction's `compactCheckpointSource()` (verified against the
 * published 0.1.7-alpha.1 artifact: the marker object is exactly
 * `{ kind: 'compact-checkpoint' }` plus `compactionId` and an optional
 * `sourceCommandId`). The 0.1.7 V3→V4 migration rewrites pre-0.1.7 sessions
 * to the new shape, so both shapes coexist on one surface and both must be
 * recognized — a row that misses this predicate classifies as `real`, which
 * double-counts its summary text in acp_status, can steal the protected-tail
 * window, and hides it from every distillation entry point below.
 */
export function isCheckpointNode(event: SessionEvent): boolean {
  if (event.type !== 'user/message') return false
  const source = (event.data as { source?: { kind?: string; plugin?: string } }).source
  return source?.plugin === 'compact' || source?.kind === 'compact-checkpoint'
}

/**
 * The durable compaction id stamped on a checkpoint summary node, reading BOTH
 * host shapes (see {@link isCheckpointNode}). Returns null when the event is
 * not a checkpoint node or carries no id — a malformed row still CLASSIFIES
 * as a checkpoint (it must never read as real content) but has no block to
 * link to. Single shared extractor for the ledger index (`summarySeqIndex`),
 * the distill-edge resolver (`blockRefForSummarySeq`) and the decompress
 * recursion (`checkpointBlockIdOf`) — those sites must not re-derive the shape
 * check themselves (issue #168).
 */
export function checkpointCompactionIdOf(event: SessionEvent): string | null {
  if (!isCheckpointNode(event)) return null
  const source = (event.data as { source?: { compactionId?: unknown } }).source
  return typeof source?.compactionId === 'string' ? source.compactionId : null
}

/**
 * Injection/authoring classification of one surface event — the ONE shared
 * classifier for range scanning and the protected-tail scan (never ad-hoc
 * predicates that drift apart).
 *
 * - `real` — genuine conversation content (user turns without an injected
 *   source, assistant prose/tool-calls, tool results, sub-agent relay rows,
 *   and host content channels in BOTH spellings: legacy plugin names and the
 *   DSH >= 0.1.7 direct-kind renames, issue #169). EXCEPTION: skill-catalog
 *   rows carrying the `<available_skills>` marker stay `instruction` even
 *   when their source shape is unusable (issue #185) — folding one loses
 *   skill discovery permanently. This is the only class that may win "last
 *   real user message" protection (minus all non-user rows, see
 *   `isRealUserTurn`).
 * - `metadata` — the engine's own ephemeral rows: nudge echoes and
 *   compress-pair replacement stubs. Their content is derived from
 *   already-visible messages, so folding them into an adjacent real segment
 *   is zero-loss — this preserves main's behavior for engine-authored rows.
 * - `checkpoint` — compaction summary nodes (both host shapes, see
 *   `isCheckpointNode`: legacy `plugin: 'compact'` and 0.1.7+
 *   `kind: 'compact-checkpoint'`, issue #168).
 *   Distillation is an explicit act; never folded into any segment.
 * - `instruction` — host-authored policy/instructions: AGENTS.md injections
 *   (both host shapes), skill catalogs, host compaction summary rows
 *   (`compact-basic`, issue #169), and ANY unknown `kind:'plugin'` row or
 *   unaudited direct kind. Folding these is unsafe (the model would lose
 *   live policy text, and the host re-injects the current AGENTS.md copy
 *   when it disappears — the compress → re-inject loop this PR fixes).
 *   Unknown channel names fall here deliberately in BOTH namespaces: a
 *   future host injection must never silently become compressible content.
 */
export type SurfaceEventClass = 'real' | 'metadata' | 'checkpoint' | 'instruction'

/** Plugin names the engine itself authors — safe to fold into real segments. */
export const METADATA_PLUGINS: ReadonlySet<string> = new Set([
  'acp-nudge', // nudge echo (src/nudge.ts)
  'billion-context', // compress-pair replacement stub (src/region.ts)
])

/**
 * Host plugins whose rows are real CONTENT, not policy: folding them reclaims
 * tokens and provokes nothing, so they fold exactly like an assistant turn.
 *  - '@deepseek-ai/dsh-system-prompt' (dsh-agent-loop): dynamic-context
 *    snapshot rows. The host appends a new row only when the snapshot TEXT
 *    changes (`if (this.retained?.text === snapshot) return`), so removing an
 *    old row never re-appends it — long sessions just accumulate them.
 *  - 'user-approval' (dsh-user-approval): one-shot approval-policy notice.
 *  - 'tools-ptc' (dsh-tools): deferred tool context, can carry image blocks.
 * A plugin NOT listed here still falls to 'instruction' below, so a future
 * presence-driven injection channel stays protected by default (issue #71
 * review B2).
 */
const REAL_CONTENT_PLUGINS: ReadonlySet<string> = new Set([
  '@deepseek-ai/dsh-system-prompt',
  'user-approval',
  'tools-ptc',
])

/**
 * DSH >= 0.1.7 (V4 format) renames the SAME host channels out of the plugin
 * namespace into DIRECT kinds without any plugin field (the V3→V4 migration's
 * rename map, audited from @deepseek-ai/dsh-session-persistence-jsonl
 * 0.1.7-alpha.1): '@deepseek-ai/dsh-system-prompt' -> 'runtime-context',
 * 'tools-ptc'/'tools-code-mode' -> 'ptc-mode'. Pre-migration logs keep the
 * legacy plugin shape, so both spellings must classify identically
 * (issue #169). Same semantics as their plugin counterparts: real content,
 * foldable, never the user speaking.
 */
const REAL_CONTENT_KINDS: ReadonlySet<string> = new Set([
  'runtime-context', // dynamic-context snapshot (was '@deepseek-ai/dsh-system-prompt')
  'ptc-mode', // deferred tool context (was 'tools-ptc' / 'tools-code-mode')
])

/** Audited relay kinds: not the user speaking, but genuine conversation content. */
const AUDITED_RELAY_KINDS: ReadonlySet<string> = new Set([
  'subagent-report',
  'subagent-settled',
])

/** Known host policy kinds that must never be folded (safe-listing beyond `plugin`). */
const HOST_INSTRUCTION_KINDS: ReadonlySet<string> = new Set([
  'agent-instructions', // AGENTS.md injection (hook shape: {kind:'agent-instructions', form:'instructions'})
  'skill-catalog', // skill catalog (form:'catalog')
  // Host compaction summary row (DSH >= 0.1.7; was plugin 'dsh-compaction-basic').
  // That legacy name was never whitelisted, so its rows were barriers already —
  // the renamed spelling keeps exactly that treatment instead of silently
  // becoming foldable content (issue #169).
  'compact-basic',
])

/**
 * Resolve the owning plugin name from either durable source shape: the legacy
 * V3 wrapper `{ kind: 'plugin', plugin: '<name>' }` or the V4 producer kind
 * `'plugin:<name>'`. DSH 0.1.7's V3→V4 migration rewrites every unregistered
 * plugin row into the latter on file open, so both shapes coexist on a live
 * surface until a session has been fully rewritten (issue #163). Returns
 * undefined when neither shape is present, or when the name is missing,
 * non-string, or empty — callers then keep their conservative fallback.
 */
export function sourcePluginOf(
  source: { kind?: unknown; plugin?: unknown } | undefined,
): string | undefined {
  if (source === undefined || typeof source !== 'object') return undefined
  const kind = source.kind
  if (kind === 'plugin') {
    return typeof source.plugin === 'string' && source.plugin.length > 0 ? source.plugin : undefined
  }
  if (typeof kind === 'string' && kind.startsWith('plugin:')) {
    const name = kind.slice('plugin:'.length)
    return name.length > 0 ? name : undefined
  }
  return undefined
}

/**
 * True for AGENTS.md instruction rows in ALL host shapes: the hook shape
 * (`kind:'agent-instructions'`, form 'instructions'), the legacy V3 wrapper
 * (`kind:'plugin'` + plugin 'agent-instructions'), and the V4 producer kind
 * (`kind:'plugin:agent-instructions'`) that DSH 0.1.7's migration rewrites
 * legacy rows into on file open (issue #163) — a migrated session must keep
 * its newest-row pin, or the current copy becomes foldable and the
 * compress → re-inject loop returns. Shared by the newest-row scan and the
 * range scanner so protection and folding always agree on what counts as an
 * AGENTS.md row.
 */
export function isAgentInstructionsRow(event: SessionEvent): boolean {
  if (event.type !== 'user/message') return false
  const source = (event.data as { source?: { kind?: string; plugin?: string } }).source
  if (!source) return false
  return source.kind === 'agent-instructions' || sourcePluginOf(source) === 'agent-instructions'
}

/**
 * True for skill-catalog rows (issue #185) — the `<available_skills>` list the
 * harness injects (dsh-tool-skill's `agent/pre-step`) so the model knows which
 * skills are installed. Recognized in every known host shape:
 *
 * - the direct kind `{ kind: 'skill-catalog', form: 'catalog' }` (audited;
 *   already in HOST_INSTRUCTION_KINDS);
 * - the plugin shapes, legacy wrapper `{ kind: 'plugin', plugin:
 *   'dsh-tool-skill' }` and V4 producer kind `plugin:dsh-tool-skill`
 *   (unknown plugin names already fall to instruction — naming the channel
 *   explicitly pins it there so a future REAL_CONTENT_PLUGINS entry can never
 *   silently re-admit the catalog as foldable content);
 * - CONTENT FALLBACK: any user row whose text carries the `<available_skills>`
 *   marker, whatever its source shape. Hosts that inject the catalog through a
 *   plain user message with NO usable source marker (the wild shape behind
 *   issue #185) would otherwise classify as `real`, get offered in the nudge
 *   range table, and be folded away. Folding the visible catalog is NOT
 *   recoverable by the host: dsh-tool-skill's resend gate is the catalog
 *   DIGEST, and shadowing the visible row changes nothing about it, so the
 *   model loses skill discovery until the catalog actually changes. The
 *   marker is the stable contract between harness and model; a user who pastes
 *   it into a chat turn becomes a barrier for that one row (harmless), while
 *   folding a real catalog is a permanent capability loss (not harmless) —
 *   the asymmetry decides.
 */
export function isSkillCatalogRow(event: SessionEvent): boolean {
  if (event.type !== 'user/message') return false
  const source = (event.data as { source?: { kind?: unknown; plugin?: unknown } }).source
  if (source?.kind === 'skill-catalog') return true
  if (sourcePluginOf(source) === 'dsh-tool-skill') return true
  return extractText(contentBlocksOfEvent(event)).includes('<available_skills>')
}

export function classifySurfaceEvent(event: SessionEvent): SurfaceEventClass {
  // 纯分类，**不写盘**。写盘只有一个入口：{@link traceSessionEvents}。
  //
  // 为什么插桩不挂在这里：这个函数被保护尾扫描和可压缩范围扫描反复调用，
  // 而那两个调用点都只在"会话真的发生压缩"时才跑 —— 挂在这里的话，采集覆盖
  // 会随会话压力浮动，短会话一行都记不到。改由宿主每个 step 主动全量扫一遍
  // （traceSessionEvents），覆盖面才稳定。
  return classifySurfaceEventRaw(event)
}

/**
 * 分类一个事件并记进观测日志 —— **写盘的唯一入口**。
 *
 * 命名空间（会话 id）把去重键隔开到单个会话内：`seq` 是会话内序号，
 * 不同会话会重号，不隔开就会互相顶掉（实测 20 个会话时少记了 5820 行）。
 */
function classifyAndTrace(event: SessionEvent, namespace: string): SurfaceEventClass {
  const surfaceClass = classifySurfaceEventRaw(event)
  traceSurfaceEvent(event, surfaceClass, process.env, namespace)
  return surfaceClass
}

/**
 * 分类一条 `agent/inbox/spliced` 通道插入的消息。
 *
 * 这个通道的 `data.inserted` 元素是**消息对象**（`{id, role, content, source}`），
 * 不是 surface 事件，所以它永远走不到 `classifySurfaceEvent` —— 线上活采集
 * 原先整条漏掉这个通道（5a 报告 §5.2 记的未做项）。
 *
 * 要给它同样的四分类口径，就把它构造成等价的 `user/message` 形状再过一次
 * 分类器 —— 这正是回放脚本 `case/replay-trace.ts` 的做法，两边口径因此一致。
 *
 * 用 `classifySurfaceEventRaw` 而不是 `classifySurfaceEvent`：后者会回头调
 * 插桩，插桩再调这里就是无限递归。
 */
export function classifyInjectedMessage(message: unknown): SurfaceEventClass {
  const payload = (message ?? {}) as { content?: unknown; source?: unknown }
  const probe = {
    seq: 0,
    time: '',
    type: 'user/message',
    data: { role: 'user', content: payload.content, source: payload.source },
  } as unknown as SessionEvent
  return classifySurfaceEventRaw(probe)
}

/**
 * 插桩补扫：把一个会话的全量消息扫一遍，补上"等分类器被动调用"漏掉的通道。
 *
 * 为什么必须主动扫，不能只等分类器被调用：
 *   - `classifySurfaceEvent` 的调用点只有两处 —— 保护尾扫描（只对 user/message）
 *     和可压缩范围扫描（要等到模型请求压缩或生成范围表时才跑）。
 *   - 所以 `assistant/message` 与 `tool/result` 两个通道**只有在会话发生压缩时**
 *     才被分类到 —— 采集覆盖会随会话压力浮动，甚至整个短会话一行都不记。
 *   - `agent/inbox/spliced` 通道的消息根本不是 surface 事件，永远不会被分类
 *     （5a 报告 §5.2 记的未做项）。
 *
 * 落点是宿主的 `agent/pre-step` 钩子（每步必过，且在 `autoNudge` 早退之前，
 * 所以关掉自动 nudge 也不会漏采）。插桩关闭时第一行就返回，零成本。
 *
 * 扫描范围与回放脚本 `case/replay-trace.ts` **逐项对齐**，否则线上采到的数
 * 与离线回放的数没有可比性：
 *   - `agent/inbox/spliced` → 走插入消息路径；
 *   - `user/message` / `assistant/message` / `tool/result` /
 *     `compaction/summary` → 走真实分类器；
 *   - `developer/message` **不在内**（回放口径同样没有，为了可比保持一致）。
 *
 * 与 surface 通道**共享同一张消息 id 去重表**（见 inject-trace.ts），所以
 * 同一条消息只记一次，两通道合计的条数与字符数与回放口径一致。
 */
const TRACED_EVENT_TYPES: ReadonlySet<string> = new Set([
  'user/message',
  'assistant/message',
  'tool/result',
  'compaction/summary',
])

export function traceSessionEvents(session: Session): void {
  if (!traceEnabled()) return
  // 会话 id 作命名空间：不同会话的 seq 会重号，去重键必须隔开。
  const namespace = typeof session.id === 'string' ? session.id : ''
  const events = sessionEventsOf(session)
  for (const event of events) {
    // Widen to string first: the seam's event-type union does not spell every
    // channel we care about, and a direct comparison would not typecheck.
    const eventType: string = event.type
    if (eventType === 'agent/inbox/spliced') {
      const inserted = (event.data as { inserted?: unknown } | undefined)?.inserted
      if (!Array.isArray(inserted)) continue
      // 事件级认领：整条 spliced 事件（含全部 inserted）只处理一遍。每步全量扫
      // 会反复扫到它，逐条查消息 id 表之前先在这里拦截，没有 id 的插入消息
      // （消息 id 表管不到）也因此不会被每步重记。
      if (!claimSplicedEvent(event.seq, namespace)) continue
      for (const message of inserted) {
        if (message === null || typeof message !== 'object') continue
        const id = typeof message.id === 'string' && message.id.length > 0 ? message.id : null
        // 先查再分类：已记过的消息不必再跑一次分类器（每步都扫，代价敏感）。
        if (messageAlreadyTraced(id)) continue
        traceInjectedMessage(
          message,
          classifyInjectedMessage(message),
          event.seq,
          process.env,
          namespace,
        )
      }
      continue
    }
    if (!TRACED_EVENT_TYPES.has(eventType)) continue
    if (eventAlreadyTraced(event, namespace)) continue
    classifyAndTrace(event, namespace)
  }
}

function classifySurfaceEventRaw(event: SessionEvent): SurfaceEventClass {
  // Compaction summary nodes first — they are user messages too.
  if (isCheckpointNode(event)) return 'checkpoint'
  // developer/message (DSH >= 0.2.0): host-written tool-registry diff rows
  // (tool-addition/tool-removal blocks, source { kind: 'tool-registry' }) —
  // bookkeeping about the request header, not conversation content. Foldable
  // like other host metadata: they carry no text in our projection and the
  // host appends them once per header diff (no presence gate), so folding can
  // never provoke a re-injection loop. They can never win user-turn
  // protection either (that gate requires user/message).
  //
  // Read through a widened local: the 0.1.5/0.1.6 seam lines' event union has
  // no such member, so a direct comparison would not typecheck against their
  // types even though the runtime check is exactly what we want.
  const eventType: string = event.type
  if (eventType === 'developer/message') return 'metadata'
  // Assistant / tool events are always genuine content.
  if (event.type !== 'user/message') return 'real'
  const source = (event.data as { source?: { kind?: string; plugin?: string } }).source
  // Skill-catalog rows must be caught even when the host injects them without
  // a usable source marker — folding one loses skill discovery permanently
  // (issue #185). Only the <available_skills> content fallback does real work
  // on these paths; the predicate's source-shape checks are already decided
  // here by construction.
  if (!source) return isSkillCatalogRow(event) ? 'instruction' : 'real' // user turn written without a source: genuine content
  const kind = source.kind
  if (kind === 'user') return isSkillCatalogRow(event) ? 'instruction' : 'real' // real user turn (host stamps {kind:'user'})
  // Plugin-attributed rows arrive in two shapes: the legacy V3 wrapper
  // `{ kind: 'plugin', plugin: '<name>' }` and the V4 producer kind
  // `'plugin:<name>'` that DSH 0.1.7's V3→V4 migration rewrites every
  // unregistered plugin row into on file open (issue #163). Both classify by
  // the SAME name table; a legacy wrapper without a parseable name stays
  // conservative (instruction), exactly as before this change.
  const plugin = sourcePluginOf(source)
  if (kind === 'plugin' || plugin !== undefined) {
    if (plugin !== undefined && METADATA_PLUGINS.has(plugin)) return 'metadata'
    if (plugin !== undefined && REAL_CONTENT_PLUGINS.has(plugin)) return 'real'
    // Unknown plugin names are policy rows until proven otherwise: a future
    // presence-driven injection must never silently become compressible.
    return 'instruction'
  }
  // Direct kinds (no plugin field). DSH >= 0.1.7's rename map moves host
  // channels out of the plugin namespace into direct kinds (issue #169), so
  // the conservative default must hold here too: only AUDITED kinds are real
  // content; everything else is a barrier until proven otherwise. A row whose
  // source carries no usable kind keeps its pre-0.1.7 treatment (real) —
  // except skill-catalog rows, which must be caught regardless of shape
  // (issue #185, see above).
  if (typeof kind !== 'string') return isSkillCatalogRow(event) ? 'instruction' : 'real'
  if (HOST_INSTRUCTION_KINDS.has(kind)) return 'instruction'
  if (REAL_CONTENT_KINDS.has(kind) || AUDITED_RELAY_KINDS.has(kind)) return 'real'
  // Unaudited direct kind: a future host channel must never silently become
  // compressible content or win user-turn protection (rule 16) — same default
  // as unknown plugin names above.
  return 'instruction'
}

/**
 * Whether an event is a real user turn — the protected-tail criterion. An
 * injected row (AGENTS.md, skill catalog, nudge echo, tool notice) is real
 * *content* at most but is never the user speaking: the latest real user
 * message must keep its protection window even when an injected row lands
 * after it. The scan this replaces protected "the last non-checkpoint
 * user/message", which on live sessions is frequently an AGENTS.md injection
 * row (the host appends it in the same enter batch) — the actual last user
 * message was left compressible while synthetic output sat safe.
 */
export function isRealUserTurn(event: SessionEvent): boolean {
  if (event.type !== 'user/message') return false
  if (classifySurfaceEvent(event) !== 'real') return false
  const source = (event.data as { source?: { kind?: string; plugin?: string } }).source
  // Host content rows that are NOT the user speaking (dynamic-context snapshot,
  // approval notice, deferred tool context): foldable, but they must never win
  // the protection window — that is exactly the bug class issue #71 fixes.
  // Legacy plugin shapes resolve through sourcePluginOf (issue #163); DSH
  // >= 0.1.7 renames the same channels to direct kinds without any plugin
  // field (issue #169) — REAL_CONTENT_KINDS covers those spellings.
  const plugin = sourcePluginOf(source)
  if (plugin !== undefined && REAL_CONTENT_PLUGINS.has(plugin)) return false
  const kind = source?.kind
  if (typeof kind === 'string' && REAL_CONTENT_KINDS.has(kind)) return false
  return kind !== 'subagent-report' && kind !== 'subagent-settled'
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK-8 —— 材料识别（`user-material`）
//
// 用户的消息里有一大类不是「用户在跟模型说话」，而是把日志、报错、代码、文档、
// 第三方回答**贴进来**（有时外面裹一两句说明）。对这类消息逐字要求整条保留是
// 做不到的：它本身就是几千到几万字符，摘要里塞不下；真正要保住的是外面那句
// 说明（AC-8.2）。
//
// 两条纪律：
//   ① **只看文本**。不看是否发生粘贴事件（宿主没有这个信号，且同一段文本从
//      文件读入和从剪贴板粘贴在会话里长得一样）。
//   ② 这不是安全边界。判错只影响保真门用哪档口径，不影响消息会不会被移走
//      （那条由 `prune.ts` 的 RL-4 保护名单兜底）。
// ─────────────────────────────────────────────────────────────────────────────

/** 长度门槛，与 acpk 的 `QUOTE_LONG_CHARS` 对齐：短消息不存在"材料"问题。 */
export const MATERIAL_MIN_CHARS = 500
/** 行数门槛：单行的长报错不算材料（它没有"正文 + 说明"的两层结构）。 */
export const MATERIAL_MIN_LINES = 6
/**
 * 结构化行占比门槛：低于此说明主体是散文，是用户在说话。
 *
 * 2026-10-29 实测修正：任务卡正文全是 `# 标题` / `- 条目` 行，**句子**占比很低
 * 但**结构**占比很高（实测 0.88）。旧口径用"结构化行数 / 非空行数"，对
 * 「一句说明 + 一大段排版」的任务卡仍会误判成散文 —— 改成按**带标点的散文句**
 * 反推：只有当散文行确实占多数时才判不是材料。
 */
export const MATERIAL_STRUCTURE_RATIO = 0.5
/**
 * 指令标记密度（个 / 1000 字符）—— **仅供诊断**，不再参与材料判定。
 *
 * ⚠️ 2026-10-29 实测修正：任务卡正文本身满是「必须/不得」（实测密度 3.0–3.5），
 * 但那是**文档内容**不是用户在下命令。旧口径只看密度，把任务卡判成"不是材料"，
 * 于是保真门去查文档正文里的「不得碰（C5-9）」→ 14 条误报。
 * 修正：密度高**不再单独否决**，只有当**开头像用户在对模型说话**时才否决。
 */
export const MATERIAL_MAX_DIRECTIVE_DENSITY = 3

/** 只看开头这一小段判断"用户有没有在说话"。 */
const MATERIAL_HEAD_CHARS = 200

/**
 * 文档头标记：开头这一行就是"这是一份文档"的显式声明。
 *
 * 任务卡的写法高度一致（`【目标文档】` / `# 任务卡…` / `## 自包含目标…`），
 * 命中即判材料，**不再受密度与结构占比否决** —— 密度高恰恰是文档的常态。
 */
const MATERIAL_DOC_HEADER: readonly RegExp[] = [
  /^\s*【\s*(?:目标文档|文档|材料|任务卡|计划书|需求|规格)\s*】/,
  /^\s*#{1,3}\s*(?:任务卡|自包含目标|文档|材料|计划书|需求文档|规格)/,
  /^\s*(?:目标文档|文档正文|材料正文)\s*[:：]/,
]

/**
 * 散文句：看起来像人写的句子（中文标点结尾、有句读）。
 *
 * 用于把"用户自己写的那几句"与"贴进来的正文"分开。任务卡正文由
 * `##` / `-` / 表格行构成，几乎不含散文句；用户在外面裹的说明才是散文句。
 */
const PROSE_SENTENCE = /[。！？；]\s*$|[:：]\s*$/

/**
 * 散文句占比上限：超过它说明用户在跟模型说话，不是在贴材料。
 *
 * 实测：任务卡 / 堆栈粘贴 / 日志粘贴的散文句占比都在 0.1 以下；
 * 用户自己写的长清单（编号 + 每行「必须/不得」）会超过这个比例 ——
 * 那正是 D-9D 要收回严档的场景，不该判成材料。
 */
export const MATERIAL_PROSE_MAX_RATIO = 0.5

/**
 * 粘贴痕迹占比下限：堆栈 / 日志 / 代码围栏这类整段粘贴的内容。
 *
 * 它们既不是 Markdown 标题（抓不到结构占比），也不含散文句。
 * 靠"这种行占非空行的多少"来认 —— 实测堆栈粘贴占比 0.3 以上。
 */
export const MATERIAL_PASTE_ARTIFACT_RATIO = 0.3

/**
 * 混合形态判定（2026-10-29 二补，根因③残留）：「一两句用户说明 + 大段粘贴正文」。
 * SG-11 实测 7 条漏判（S033/S035/S039/S041/S053 等）全属此类 —— 首行是用户在说话
 * （「你帮我看看这个报错」「只做一件事：…」），正文却是堆栈 / 报错 / 宿主 UI 回显。
 * 旧口径首行命中直接称呼就一票否决，S035 这种正文挤在 3 行里的还过不了行数门槛。
 *
 * 修正：判定改为**按正文主导** —— 剥离开头的散文说明行后，只要正文是"非散文行
 * 占绝对多数"的大段内容，就判材料。首行的直接称呼不再否决粘贴为主的正文：
 * AC-8.2 保的正是"外面那句"，正文本来就不要求逐字。
 */

/** 开头最多剥离的散文说明行数（说明通常 1–2 行）。 */
export const MATERIAL_HEADER_PROSE_MAX_LINES = 3
/** 正文中散文行占比上限：超过说明用户自己在正文里说话，不是粘贴。 */
export const MATERIAL_BODY_PROSE_MAX_RATIO = 0.25
/** 粘贴正文的最小体量：字符数、非空行数、占全文字符的比例。 */
export const MATERIAL_BODY_MIN_CHARS = 300
export const MATERIAL_BODY_MIN_LINES = 2
export const MATERIAL_BODY_CHARS_RATIO = 0.5

/**
 * 全文级「向模型要交付物」的祈使 —— 用户手写任务书（编号列表 + 「请返回: …」）
 * 的标志。那是用户在向模型要东西，排版再像文档也不是材料；真材料的正文是
 * 堆栈/日志/UI 回显，不含这类句子。
 */
const MATERIAL_DELIVER_REQUEST_RE = /请(?:返回|给出|提供|列出|输出|回复|汇总|整理)/

/** 剥离开头连续的散文说明行（跳过空行），返回剩余正文行。 */
function stripHeaderProse(lines: readonly string[]): string[] {
  let prose = 0
  let start = 0
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = (lines[i] ?? '').trim()
    if (trimmed.length === 0) continue
    if (PROSE_SENTENCE.test(trimmed) && prose < MATERIAL_HEADER_PROSE_MAX_LINES) {
      prose += 1
      start = i + 1
      continue
    }
    break
  }
  return lines.slice(start)
}

/** 粘贴痕迹行的特征：堆栈帧、日志级别、代码围栏、思考/失败/工具调用等宿主回显。 */
const PASTE_ARTIFACT_LINE: readonly RegExp[] = [
  /^\s*at\s+\S/, // 堆栈帧
  /^\s*(?:ERROR|WARN|WARNING|INFO|DEBUG|FATAL|TRACE)\b/, // 日志级别
  /^\s*```/, // 代码围栏
  /^\s*(?:思考|失败|成功|工具调用|输出|结果)\s*$/, // 宿主回显标签
  /^\s*[A-Za-z_$][\w$.]*\s*[:=]\s*\S/, // key: value
  /^\s*at\s+\S.*\(\s*(?:at\s+)?/,
  // —— 2026-10-29 二补：混合形态正文里的宿主 UI 泄漏行（S041/S053 实测）——
  /^\s*\d{1,2}:\d{2}\s*$/, // 时间戳独占行（`15:27` / `22:57`）
  /^\s*(?:处理失败|执行了命令|本轮运行失败|处理中|已完成)\s*$/, // 宿主状态回显
  /^\s*›/, // 提示符行
  /^\s*(?:读取|查找|查找文件|搜索|搜索文件内容|写入|编辑|列出|打开)\s*$/, // 工具调用标签行
]



/** 结构化行的排版特征：列表、表格、标题、提示符、日志、代码、JSON、堆栈…… */
const MATERIAL_STRUCTURED_LINE: readonly RegExp[] = [
  /^\s*```/, // 代码围栏
  /^\s*(?:[-*+]|\d+[.)、])\s+\S/, // 列表 / 编号行
  /^\s*\|.*\|/, // markdown 表格行
  /^\s*#{1,6}\s+\S/, // 标题
  /^\s*>/, // 引用行
  /^\s*(?:\$|PS\s|PS>|C:\\|D:\\|C:>|D:>)\S/, // shell / PowerShell 提示符 / Windows 盘符
  /^\s*(?:\/\/|\/\*|\*\/|\*)\s*\S/, // 注释
  /^\s*[A-Za-z_$][\w$.]*\s*[:=]\s*\S/, // key: value / key = value
  /^\s*"[^"]+"\s*:/, // JSON 键
  /^\s*[{}\[\]](?:\s*$)|\s*[{}\[\]]\s*$/, // 括号独占行 / 行尾括号
  /^\s*\[[^\]]+\]/, // [TAG] 日志前缀
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/, // 时间戳
  /^\s*at\s+\S/, // 堆栈帧
  /^\s*(?:ERROR|WARN|WARNING|INFO|DEBUG|FATAL|TRACE)\b/, // 日志级别
  /^\s*(?:import|export|from|const|let|var|function|class|def|return|if|for|while|try|catch|end|fi|done)\b/, // 代码关键字
  /\t/, // 制表符分隔的列
  /^\s*\S+(?:\s{2,}\S+){2,}\s*$/, // 多列（≥2 空格分隔）
]

/**
 * 「用户在跟模型说话」的标记。命中即**不是**材料 —— 哪怕正文看起来像粘贴的。
 * 只收第二人称与强祈使，不收「目标 / 任务 / 要求」这类在文档标题里也常见的词。
 */
const DIRECT_ADDRESS_MARKERS: readonly string[] = [
  '请', '帮我', '麻烦', '你', '你们', '咱们', '现在', '接下来', '另外', '还有',
  '顺便', '继续', '别', '不要', '不得', '禁止', '必须', '务必', '严格', '记得',
  '注意', '只能', '能否', '能不能',
]

/**
 * 硬约束标记（算密度用）。与上面不同：这里不收"你"这类称呼。
 *
 * 2026-10-29 起**只用于诊断输出**，不再参与材料判定 ——
 * 任务卡正文满是「必须/不得」，密度高是文档的常态，不能据此否决。
 */
const CONSTRAINT_MARKERS: readonly string[] = [
  '必须', '务必', '不得', '禁止', '不要', '只能', '确保', '严格', '记得', '请先',
]

function countOccurrences(text: string, needles: readonly string[]): number {
  let n = 0
  for (const needle of needles) n += text.split(needle).length - 1
  return n
}

/** 这条消息的硬约束密度（个 / 1000 字符）。仅供诊断与报告引用。 */
export function materialDirectiveDensity(text: string): number {
  const trimmed = text.trim()
  if (trimmed.length === 0) return 0
  return (countOccurrences(trimmed, CONSTRAINT_MARKERS) * 1000) / trimmed.length
}

function isStructuredLine(line: string): boolean {
  return MATERIAL_STRUCTURED_LINE.some((re) => re.test(line))
}

/** 粘贴痕迹行占非空行的比例。堆栈 / 日志 / 代码围栏整段粘贴时这个值明显偏高。 */
function pasteArtifactRatio(lines: readonly string[]): number {
  let artifact = 0
  let counted = 0
  for (const line of lines) {
    if (line.trim().length === 0) continue
    counted += 1
    if (PASTE_ARTIFACT_LINE.some((re) => re.test(line))) artifact += 1
  }
  if (counted === 0) return 0
  return artifact / counted
}

/**
 * 这条用户消息是不是"贴进来的材料"（TASK-8）。**只看文本**，不看粘贴事件。
 *
 * 五个条件全部满足才算材料：够长、够多行、主体是结构化排版、开头不像在跟模型
 * 说话、通篇硬约束密度低。任一条不满足 → 用户本人在说话（`user-turn`）。
 *
 * 2026-10-29 按 SG-11 的量化结果修正（原材料判据 P=0.93 / **R=0.45**，漏判 16 条）：
 *   - **文档头标记**（`【目标文档】` / `# 任务卡…`）→ 直接判材料，不再被密度否决。
 *     任务卡正文满是「必须/不得」，那是**文档内容**，不是用户在下命令。
 *   - **散文句占比**取代"结构化行数占比"作否决依据：任务卡的散文句很少
 *     （正文全是 `#`/`-`/表格行），用户在外面裹的说明才是散文句。
 *     「一句说明 + 一大段排版」的老口径会误判成散文 —— 现在不会了。
 *   - 堆栈/日志/代码围栏这类**粘贴痕迹**单独识别：它们不含散文句，
 *     但也不是 Markdown 标题，靠结构占比抓不住。
 */
export function isMaterialUserText(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length < MATERIAL_MIN_CHARS) return false
  const lines = trimmed.split('\n')

  // 文档头标记 = 显式声明"这是一份文档"。命中即判材料，
  // **且不再被后面的密度/结构否决** —— 密度高恰恰是文档的常态。
  const firstLine = lines[0] ?? ''
  if (MATERIAL_DOC_HEADER.some((re) => re.test(firstLine))) return true

  // 全文级「向模型要交付物」否决（S048）：用户手写任务书（编号列表 +
  // 「请返回: …」）没有粘贴痕迹，排版却很像文档。真材料的正文是堆栈/日志/
  // UI 回显，粘贴痕迹占比高 —— 只有无粘贴痕迹时这条否决才生效。
  if (
    MATERIAL_DELIVER_REQUEST_RE.test(trimmed) &&
    pasteArtifactRatio(lines) < MATERIAL_PASTE_ARTIFACT_RATIO
  ) {
    return false
  }

  // 混合形态（二补，先于行数与称呼否决）：「一两句说明 + 大段粘贴正文」。
  // 自带体量守卫（正文 ≥2 行、≥300 字符、占全文 ≥ 一半、散文 ≤1/4），
  // 单行长报错与用户自己写的散文进不来。S033/S035/S039/S041/S053/S056 靠这条恢复。
  {
    const body = stripHeaderProse(lines)
    const bodyLines: string[] = []
    let bodyChars = 0
    let bodyProse = 0
    let numbered = 0
    for (const line of body) {
      const t = line.trim()
      if (t.length === 0) continue
      bodyLines.push(t)
      bodyChars += t.length
      if (PROSE_SENTENCE.test(t)) bodyProse += 1
      if (/^\d+[.)、]\s*\S/.test(t)) numbered += 1
    }
    if (
      bodyLines.length >= MATERIAL_BODY_MIN_LINES &&
      bodyChars >= MATERIAL_BODY_MIN_CHARS &&
      bodyChars >= trimmed.length * MATERIAL_BODY_CHARS_RATIO &&
      bodyProse / bodyLines.length <= MATERIAL_BODY_PROSE_MAX_RATIO &&
      // 编号指令行 ≥3 → 用户手写的任务清单（S045「1. … 2. …」8 条），不是粘贴物；
      // 真材料正文（堆栈/日志/UI 回显）不含这种行。回退到旧口径判定。
      numbered < 3
    ) {
      return true
    }
  }

  if (lines.length < MATERIAL_MIN_LINES) return false

  // 开头那段：用户在材料外面裹的说明通常就在第一行。
  const head = firstLine.slice(0, MATERIAL_HEAD_CHARS)

  // 用户在跟模型说话 → 不是材料（哪怕正文看起来像粘贴的）。
  // 混合形态已在上面放行，走到这里的正文以散文为主，称呼否决仍然成立。
  if (DIRECT_ADDRESS_MARKERS.some((m) => head.includes(m))) return false

  let structured = 0
  let counted = 0
  let prose = 0
  for (const line of lines) {
    // 空行既不是排版也不是散文，计入分母只会稀释比例（Markdown 文档尤其吃亏）。
    if (line.trim().length === 0) continue
    counted += 1
    if (isStructuredLine(line)) structured += 1
    else if (PROSE_SENTENCE.test(line.trim())) prose += 1
  }
  if (counted === 0) return false

  // 散文句占多数 → 用户在跟模型说话，不是在贴材料。
  // 反过来（散文句少 + 结构行多）→ 材料。
  const proseRatio = prose / counted
  if (proseRatio > MATERIAL_PROSE_MAX_RATIO) return false

  // 排版特征：结构化行为主（Markdown 文档），或整段是粘贴痕迹（堆栈/日志/代码）。
  if (structured / counted >= MATERIAL_STRUCTURE_RATIO) return true
  if (pasteArtifactRatio(lines) >= MATERIAL_PASTE_ARTIFACT_RATIO) return true

  return false
}


/**
 * 一条 surface 事件的来源标签（TASK-7）。映射自 `classifySurfaceEvent` 的四分类
 * 再加上来源细看，得到设计文档 §3.2 的七值。
 *
 * 用 `classifySurfaceEventRaw` 而不是 `classifySurfaceEvent`：后者会触发插桩写盘，
 * 而投影路径每轮都跑，插桩由宿主 `agent/pre-step` 的 `traceSessionEvents` 统一
 * 扫一遍（TASK-3 的口径），这里再写就是算两遍。
 */
export function provenanceOfEvent(event: SessionEvent, text: string): MessageProvenance {
  const surfaceClass = classifySurfaceEventRaw(event)
  if (surfaceClass === 'checkpoint') return 'checkpoint'
  if (surfaceClass === 'instruction') return 'host-policy'
  if (surfaceClass === 'metadata') return 'engine-metadata'
  // `real`：可能是用户本人、宿主内容通道、子代理转述，或用户贴的材料。
  if (event.type !== 'user/message') return 'user-turn' // assistant / tool 不投影成 user
  const source = (event.data as { source?: { kind?: string; plugin?: string } }).source
  const plugin = sourcePluginOf(source)
  if (plugin !== undefined && REAL_CONTENT_PLUGINS.has(plugin)) return 'host-content'
  const kind = source?.kind
  if (typeof kind === 'string' && REAL_CONTENT_KINDS.has(kind)) return 'host-content'
  if (typeof kind === 'string' && AUDITED_RELAY_KINDS.has(kind)) return 'relay'
  // 走到这里就已经是用户在说话了：`isRealUserTurn` 的剩余条件与上面三行逐条
  // 相同，这里不重复调用它 —— 那个公开函数走 `classifySurfaceEvent`（会触发
  // 插桩写盘），而投影路径每轮都跑，插桩只能由 `traceSessionEvents` 扫一遍。
  if (isMaterialUserText(text)) return 'user-material'
  return 'user-turn'
}
