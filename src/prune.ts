import { activeBlocks, coveredMessageIds } from "./state.js";
import type { CompressionState, CoreMessage, MessageProvenance } from "./types.js";

export const SUMMARY_HEADER = "[Compressed conversation section]";

// Reserved prefix for rendered-summary ids. Hosts own their message ids and
// must never assign one with this prefix; kernel-generated ids are mNNNNN
// refs and bN block ids.
const SUMMARY_ID_PREFIX = "acp_summary_";

/**
 * The transient visible id of an active block's rendered summary message.
 * This is a VIEW-ONLY representation: it must never be persisted into
 * `effectiveMessageIds`/`directMessageIds` (the durable coverage is the
 * block's raw message ids).
 */
export function summaryMessageId(blockId: string): string {
  return `${SUMMARY_ID_PREFIX}${blockId}`;
}

export function isSummaryMessageId(id: string): boolean {
  return id.startsWith(SUMMARY_ID_PREFIX);
}

/**
 * Base id of a message id: everything before the first `#`. Sub-id
 * projections (`base#callId`, `base#r0`, …) are alternate renderings of the
 * same original message, so coverage is decided per original message — id
 * comparisons normalize to the base (issue #231).
 */
export function baseIdOf(id: string): string {
  const hash = id.indexOf("#");
  return hash > 0 ? id.substring(0, hash) : id;
}

/**
 * True when `id` falls under any covered original message, regardless of
 * which projection form the block recorded and which the current view emits.
 * `coveredBases` must be the set of `baseIdOf(c)` over the covered ids,
 * built once per pass (O(1) per message instead of a scan). The exact
 * membership test is subsumed: a covered id's own base is in the set.
 */
export function isCovered(id: string, coveredBases: Set<string>): boolean {
  return coveredBases.has(baseIdOf(id));
}

/**
 * True when a message is a rendered block summary (the exact shape prune
 * emits). The id prefix alone is not sufficient — a host-authored message
 * that happens to carry a reserved id must not be treated as a rendered
 * summary (it would be silently dropped from ranges or deleted by rebuild).
 */
export function isRenderedSummaryMessage(
  message: Pick<CoreMessage, "id" | "role" | "contentType">,
): boolean {
  return (
    isSummaryMessageId(message.id) &&
    message.role === "system" &&
    message.contentType === "text"
  );
}

export interface PruneOptions {
  injectSummaries?: boolean;
  /** 用户消息原文保留条数（方案 A=0 / 方案 B=N>0）。缺省按 0 处理 = 全部保留。 */
  userVerbatimKeep?: number;
}

/** 算用户本人发言的来源集合：用户这一轮说的话，以及用户贴进来的材料。 */
const USER_VERBATIM_PROVENANCES: ReadonlySet<MessageProvenance> = new Set<
  MessageProvenance
>(["user-turn", "user-material"]);

/**
 * 是否算「用户原文」，受 RL-4 保护。
 *
 * ⚠️ **`provenance === undefined` 必须返回 true（继续保护）**。这个分支省不得：
 * 老宿主与老持久化数据没有来源标签，省掉它等于一夜之间把这些宿主上对用户消息
 * 的原文保护全部撤掉，且**不报错、不可见**——违反 RL-4 的正是这种静默失效。
 *
 * 注意方向与保真门相反：那里无标签是「跳过检查」（少查一次，无害且可见），
 * 这里是「继续保护」。判别口诀：先问这层失效是「没查」还是「没保」——
 * 前者放开，后者收紧。详见计划书 §2 高危 1。
 */
export function isUserVerbatimProvenance(
  provenance: MessageProvenance | undefined,
): boolean {
  return (
    provenance === undefined || USER_VERBATIM_PROVENANCES.has(provenance)
  );
}

/** 受原文保护的 user 消息 id 集合。
 *  keep = 0（方案 A）→ 全部用户发言；keep = N > 0（方案 B）→ 最近 N 条。
 *  只认 `user-turn` / `user-material` / 无标签：宿主注入行（AGENTS.md、技能目录、
 *  运行时上下文、检查点）同样是 role === "user"，但它们被压缩掉正是我们想要的，
 *  保护它们会让「受保护原文」里塞满注入文本（实测旧口径误判率 92.9%）。
 *  预先算成 id 集合是必需的：protectedFn 对每条消息各调用一次，
 *  若在谓词内部用 indexOf 定位角色下标会退化成 O(n²)。 */
export function collectUserVerbatimIds(
  messages: CoreMessage[],
  keep: number,
): Set<string> {
  const userIndices: number[] = [];
  messages.forEach((message, index) => {
    if (message.role !== "user") return;
    if (!isUserVerbatimProvenance(message.provenance)) return;
    userIndices.push(index);
  });
  const kept = keep > 0 ? userIndices.slice(-keep) : userIndices;
  const ids = new Set<string>();
  for (const index of kept) ids.add(messages[index]!.id);
  return ids;
}

export function prune(
  messages: CoreMessage[],
  state: CompressionState,
  options: PruneOptions = {},
): CoreMessage[] {
  const covered = coveredMessageIds(state);
  if (covered.size === 0) return [...messages];
  const coveredBases = new Set<string>();
  for (const id of covered) coveredBases.add(baseIdOf(id));

  const inject = options.injectSummaries ?? true;
  const firstUserIndex = messages.findIndex(
    (message) => message.role === "user",
  );

  const baseIndexById = new Map<string, number>();
  const summaryIndexById = new Map<string, number>();
  messages.forEach((message, index) => {
    const base = baseIdOf(message.id);
    const existing = baseIndexById.get(base);
    if (existing === undefined || index < existing)
      baseIndexById.set(base, index);
    if (isRenderedSummaryMessage(message))
      summaryIndexById.set(message.id, index);
  });

  const anchors = inject
    ? collectSummaryAnchors(state, baseIndexById, summaryIndexById)
    : [];

  return stripOrphanedReasoning(
    stripOrphanedToolResults(
      stripOrphanedToolCalls(
        rebuildMessages(messages, coveredBases, firstUserIndex, anchors, {
          userVerbatimIds: collectUserVerbatimIds(
            messages,
            options.userVerbatimKeep ?? 0,
          ),
        }),
      ),
    ),
  );
}

interface SummaryAnchor {
  blockId: string;
  summary: string;
  topic?: string;
  insertAt: number;
}

function collectSummaryAnchors(
  state: CompressionState,
  baseIndexById: Map<string, number>,
  summaryIndexById: Map<string, number>,
): SummaryAnchor[] {
  const anchors: SummaryAnchor[] = [];
  for (const block of activeBlocks(state)) {
    // Prefer the position of an already-rendered summary (hosts may pass a
    // previously-pruned view): keeps the summary stable in place instead of
    // jumping to index 0 when the raw ids are no longer in the input.
    const existingIndex = summaryIndexById.get(summaryMessageId(block.blockId));
    if (existingIndex !== undefined) {
      anchors.push({
        blockId: block.blockId,
        summary: block.summary,
        topic: block.topic,
        insertAt: existingIndex,
      });
      continue;
    }
    let earliest: number | null = null;
    for (const id of block.effectiveMessageIds) {
      const index = baseIndexById.get(baseIdOf(id));
      if (index !== undefined && (earliest === null || index < earliest)) {
        earliest = index;
      }
    }
    anchors.push({
      blockId: block.blockId,
      summary: block.summary,
      topic: block.topic,
      insertAt: earliest ?? 0,
    });
  }
  anchors.sort((left, right) => left.insertAt - right.insertAt);
  return anchors;
}

/**
 * A rendered summary replaces the messages its block covers, so it takes the
 * position of the earliest covered message. That position can fall inside a
 * unit the provider validates as a whole, and a summary may never be placed
 * inside such a unit:
 *
 * - A parallel tool burst: a range that covers one call and its result leaves
 *   the burst's other calls visible, and the summary then lands between an
 *   assistant `tool_calls` message and the tool results answering it. Strict
 *   upstreams reject the whole request in that shape ("an assistant message
 *   with 'tool_calls' must be followed by tool messages responding to each
 *   'tool_call_id'"), so an anchor that would separate a call from its result
 *   is moved past that result.
 * - A single assistant message: consecutive assistant cores (a reasoning run,
 *   its text and its tool calls) merge into one wire message. An anchor landing
 *   between them splits the message, and its tool calls then reach the provider
 *   without the reasoning run they were produced with — DeepSeek thinking mode
 *   rejects that ("The `reasoning_content` in the thinking mode must be passed
 *   back to the API"), so an anchor inside an assistant run is moved back to the
 *   run's start.
 */
// Per-rebuild indexes for anchor pairing (#498). Building these once per
// rebuild costs O(N); rebuilding them per anchor made prune O(anchors × N).
interface AnchorPairingIndex {
  /** Start of the maximal consecutive assistant-role run containing i; -1 when `messages[i]` is not assistant. */
  runStart: Int32Array;
  /** Farthest `firstResultIndex(callId) + 1` across assistant tool-call messages at positions `< i`; 0 when none. Length N+1. */
  prefixEnd: Int32Array;
}

function buildAnchorPairingIndex(messages: CoreMessage[]): AnchorPairingIndex {
  const n = messages.length;

  // A duplicate call id can appear on multiple results; the earliest position
  // is the pairing boundary.
  const resultIndexByCallId = new Map<string, number>();
  messages.forEach((message, at) => {
    if (message.contentType !== "tool-result") return;
    if (typeof message.toolCallId !== "string") return;
    if (!resultIndexByCallId.has(message.toolCallId)) {
      resultIndexByCallId.set(message.toolCallId, at);
    }
  });

  const runStart = new Int32Array(n).fill(-1);
  for (let i = 0; i < n;) {
    if (messages[i]!.role !== "assistant") {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < n && messages[j + 1]!.role === "assistant") j++;
    for (let k = i; k <= j; k++) runStart[k] = i;
    i = j + 1;
  }

  const prefixEnd = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) {
    const message = messages[i]!;
    let end = 0;
    if (
      message.role === "assistant" &&
      message.contentType === "tool-call" &&
      typeof message.toolCallId === "string"
    ) {
      const resultIndex = resultIndexByCallId.get(message.toolCallId);
      if (resultIndex !== undefined) end = resultIndex + 1;
    }
    prefixEnd[i + 1] = Math.max(prefixEnd[i]!, end);
  }

  return { runStart, prefixEnd };
}

function pairSafeAnchorIndex(
  messages: CoreMessage[],
  index: number,
  ix: AnchorPairingIndex,
): number {
  const n = messages.length;
  let safe = index;
  // Only assistant cores that reach the wire matter; a covered core between
  // them is dropped, and the runs then merge in the rendered view. Both steps
  // below therefore walk the input, where the covered ids are still present.
  if (safe > 0 && safe < n) {
    const start = ix.runStart[safe]!;
    if (start >= 0 && messages[safe - 1]!.role === "assistant") {
      safe = start;
    }
  }

  // Degenerate inputs outside [0, n] have no prefix to scan; the original
  // full-scan behavior returned them unchanged.
  if (safe < 0 || safe > n) return safe;

  // Each move lands just past a result, so the loop reaches a fixed point; the
  // bound only guards against a malformed message list. Entries whose result
  // ends at or before `safe` contribute ≤ safe and are absorbed by
  // max(safe, ·), so the unfiltered prefix max agrees with the filtered scan.
  for (let guard = 0; guard < n; guard++) {
    const next = Math.max(safe, ix.prefixEnd[safe]!);
    if (next === safe) break;
    safe = next;
  }
  return safe;
}

function rebuildMessages(
  messages: CoreMessage[],
  coveredBases: Set<string>,
  firstUserIndex: number,
  anchors: SummaryAnchor[],
  options: { userVerbatimIds?: Set<string> } = {},
): CoreMessage[] {
  const ix = anchors.length > 0 ? buildAnchorPairingIndex(messages) : null;
  const safeAnchors = anchors
    .map((anchor) => ({
      ...anchor,
      insertAt: ix
        ? pairSafeAnchorIndex(messages, anchor.insertAt, ix)
        : anchor.insertAt,
    }))
    .sort((left, right) => left.insertAt - right.insertAt);
  const result: CoreMessage[] = [];
  const pending = [...safeAnchors];
  const anchoredSummaryIds = new Set(
    anchors.map((anchor) => summaryMessageId(anchor.blockId)),
  );

  for (let index = 0; index < messages.length; index++) {
    while (pending.length > 0 && pending[0]!.insertAt === index) {
      result.push(renderSummary(pending.shift()!));
    }
    // First-user-message pin: the session's opening user message survives
    // prune even when covered by an active block. This check deliberately
    // PRECEDES the covered check below — swapping them would let a compress
    // range strip the last guaranteed user message off the wire. Strict
    // providers reject conversations with no user message. See DESIGN.md §8.1.
    if (index === firstUserIndex && firstUserIndex >= 0) {
      result.push(messages[index]!);
      continue;
    }
    // 用户消息原文保护：受保护集合内的 user 消息即便已被活跃块覆盖也留在线上，
    // 与上面的首条钉一起构成「至少一条 user + 受保护 user」双重保证。
    if (
      messages[index]!.role === "user" &&
      (options.userVerbatimIds?.has(messages[index]!.id) ?? false)
    ) {
      result.push(messages[index]!);
      continue;
    }
    if (isCovered(messages[index]!.id, coveredBases)) continue;
    // A stale copy of this block's summary from a previously-pruned view:
    // the freshly rendered one above replaces it. Only rendered-summary
    // shaped messages qualify — a host message that merely reuses the
    // reserved prefix is content, not a stale copy.
    if (
      isRenderedSummaryMessage(messages[index]!) &&
      anchoredSummaryIds.has(messages[index]!.id)
    )
      continue;
    result.push(messages[index]!);
  }

  while (pending.length > 0) {
    result.push(renderSummary(pending.shift()!));
  }

  return result;
}

function renderSummary(anchor: SummaryAnchor): CoreMessage {
  const body = anchor.summary.trim();
  const topicLine = anchor.topic
    ? `${SUMMARY_HEADER} — ${anchor.topic}`
    : SUMMARY_HEADER;
  const text = body.length === 0 ? topicLine : `${topicLine}\n${body}`;
  return {
    id: summaryMessageId(anchor.blockId),
    role: "system",
    contentType: "text",
    text,
  };
}

function stripOrphanedToolResults(messages: CoreMessage[]): CoreMessage[] {
  const knownCallIds = new Set<string>();
  for (const m of messages) {
    if (m.contentType === "tool-call" && m.toolCallId) {
      knownCallIds.add(m.toolCallId);
    }
  }
  return messages.filter(
    (m) =>
      m.contentType !== "tool-result" ||
      !m.toolCallId ||
      knownCallIds.has(m.toolCallId),
  );
}

function stripOrphanedToolCalls(messages: CoreMessage[]): CoreMessage[] {
  const knownResultIds = new Set<string>();
  for (const m of messages) {
    if (m.contentType === "tool-result" && m.toolCallId) {
      knownResultIds.add(m.toolCallId);
    }
  }
  return messages.filter(
    (m) =>
      m.contentType !== "tool-call" ||
      !m.toolCallId ||
      m.toolName === "compress" ||
      knownResultIds.has(m.toolCallId),
  );
}

/**
 * Defense-in-depth for reasoning/text pairing (analogue of
 * {@link stripOrphanedToolCalls}). A `reasoning` message is only meaningful
 * when immediately followed — after any same-run reasoning — by its companion
 * assistant text/tool-call; strict thinking models (DeepSeek et al.) reject
 * reasoning_content that has lost its response with HTTP 400. Compress-time
 * boundary expansion normally keeps the pair in one block, so this only fires
 * for degenerate straddles (block-boundary ranges, malformed input, or a
 * reasoning that never had a companion): drop the dangling run rather than
 * ship a 400-triggering half-pair. Runs AFTER tool stripping, since removing
 * an orphaned tool-call can leave its preceding reasoning dangling too.
 */
function stripOrphanedReasoning(messages: CoreMessage[]): CoreMessage[] {
  const drop = new Set<number>();
  for (let i = 0; i < messages.length; i++) {
    if (drop.has(i)) continue;
    if (messages[i]!.contentType !== "reasoning") continue;
    let j = i;
    while (
      j + 1 < messages.length &&
      messages[j + 1]!.contentType === "reasoning"
    ) {
      j++;
    }
    const companion = messages[j + 1];
    const hasCompanion =
      companion !== undefined &&
      companion.role === "assistant" &&
      (companion.contentType === "text" ||
        companion.contentType === "tool-call");
    if (!hasCompanion) {
      for (let k = i; k <= j; k++) drop.add(k);
    }
  }
  if (drop.size === 0) return messages;
  return messages.filter((_, i) => !drop.has(i));
}
