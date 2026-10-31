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
import type { CoreMessage, MessageProvenance } from 'acp-kernel';
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session';
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        acpNudge: {
            kind: 'plugin:acp-nudge';
        };
        acpPrune: {
            kind: 'plugin:billion-context';
        };
        compactCheckpoint: {
            kind: 'compact-checkpoint';
            compactionId: string;
            sourceCommandId?: string;
        };
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
export declare function extractText(content: unknown): string;
interface ToolCallBlock {
    type: 'tool-call';
    id?: string;
    name?: string;
    arguments?: unknown;
}
/**
 * The tool-call blocks of one assistant content array, in CONTENT order.
 * Shared with the range-edge layer (src/region.ts `anchorsRangeEdge`,
 * src/tools.ts `edgeRefForSeq`): projection order IS this order (projectEvent
 * maps the calls in sequence), so "the node's first/last sub-message id" is
 * derivable from it without re-implementing the filter anywhere else.
 */
export declare function toolCallsOf(content: unknown): ToolCallBlock[];
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
export declare function toolCallIdOfResultEvent(event: SessionEvent): string | null;
/**
 * Index of assistant tool-call `id` → tool `name`, used to attribute
 * tool/result messages to their tool. Real DSH tool-results carry no
 * `message.toolName` (rule 10), so the projection backfills it from the
 * matching assistant tool-call. Scans ALL events up front (order-independent:
 * a result may precede its call in the array) and covers shadowed calls too.
 */
export declare function buildToolCallIndex(events: readonly SessionEvent[]): ReadonlyMap<string, string>;
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
export declare const SUMMARY_FRAME_PREFIX = "[Model-written summary \u2014 not user words; re-verify any obligations before relying on them]";
export declare function withSummaryFramePrefix(text: string): string;
/**
 * The lead-in of a summary the ENGINE writes itself — today only the
 * context-overflow emergency marker (src/index.ts `compactForOverflow`).
 * Recognition is by content, not by caller: the writer and both framing sites
 * share this ONE literal.
 */
export declare const ENGINE_SUMMARY_LEAD = "[engine-written summary \u2014 context-overflow emergency compaction";
export declare function isEngineWrittenSummary(text: string): boolean;
/**
 * The block summary the automatic overflow recovery writes. It is the engine's
 * own note — not model-written text, not user words — saying which range was
 * hidden to get the request under the window and where the originals still
 * live (the append-only log: search_context/decompress rebuild from it).
 */
export declare function overflowMarkerSummary(hiddenCount: number): string;
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
export declare function kernelBlockIdByCompactionId(events: readonly SessionEvent[]): ReadonlyMap<string, string>;
export declare function projectEvent(event: SessionEvent, toolNames?: ReadonlyMap<string, string>, kernelBlockIds?: ReadonlyMap<string, string>): CoreMessage[];
/** Project a session's message events into CoreMessage[] in log order. */
export declare function eventsToCoreMessages(events: readonly SessionEvent[], toolNames?: ReadonlyMap<string, string>): CoreMessage[];
/**
 * 折叠被后续快照完全覆盖的旧快照行（保留每个指纹的最后一条）。
 * 无快照时原样返回新数组（不共享引用，调用方可安全排序）。
 */
export declare function dedupeSupersededSnapshots(messages: readonly CoreMessage[]): CoreMessage[];
/**
 * 发给模型的 surface 视图 = 全量投影 + 快照折叠。
 *
 * 所有消费者（pre-step 压缩、nudge 范围表、compress/status 工具）都必须走这一个
 * 入口，否则「ref 表里有的消息模型看不到」「模型看到的消息 ref 表里没有」两类
 * 错位会同时出现。
 */
export declare function surfaceCoreMessages(events: readonly SessionEvent[], toolNames?: ReadonlyMap<string, string>): CoreMessage[];
/** The surface-visible message events of a session, in model-visible order. */
export declare function surfaceEventsOf(session: Session): SessionEvent[];
/**
 * ALL message-type events in log order — the visible surface PLUS everything
 * shadowed by compression. The ACP kernel deactivates any block whose consumed
 * message ids are absent from the array it is given (syncBlocks), and refuses
 * to anchor a block boundary that cannot find its messages, so T2/T3
 * distillation requires the full log, not just the visible surface.
 */
export declare function allLogMessages(session: import('@deepseek-ai/dsh-session').Session): CoreMessage[];
/** Extract the model-facing text of any surface message event. */
export declare function extractEventText(event: SessionEvent): string;
/** Count image/file blocks reachable from a content payload (same walk as extractText). */
export declare function countAttachmentBlocks(content: unknown): {
    images: number;
    files: number;
};
/**
 * Attachments carried by one surface event, walked exactly like
 * `extractEventText`. Used in two places: the compressible-range rows mark
 * media-bearing spans, and the callers that already own a token meter price
 * those spans with the provider-anchored media price instead of the text-only
 * estimate (issue #117).
 */
export declare function attachmentsOfEvent(event: SessionEvent): {
    images: number;
    files: number;
};
/**
 * The image/file blocks themselves (not just their counts), in document order.
 * The compressible-range rows price these with the fixed-heuristic media price
 * when the meter reports no routed surcharge, so a media-bearing span is never
 * shown as free (issue #117).
 */
export declare function mediaBlocksOfEvent(event: SessionEvent): readonly unknown[];
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
export declare function isCheckpointNode(event: SessionEvent): boolean;
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
export declare function checkpointCompactionIdOf(event: SessionEvent): string | null;
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
export type SurfaceEventClass = 'real' | 'metadata' | 'checkpoint' | 'instruction';
/** Plugin names the engine itself authors — safe to fold into real segments. */
export declare const METADATA_PLUGINS: ReadonlySet<string>;
/**
 * Resolve the owning plugin name from either durable source shape: the legacy
 * V3 wrapper `{ kind: 'plugin', plugin: '<name>' }` or the V4 producer kind
 * `'plugin:<name>'`. DSH 0.1.7's V3→V4 migration rewrites every unregistered
 * plugin row into the latter on file open, so both shapes coexist on a live
 * surface until a session has been fully rewritten (issue #163). Returns
 * undefined when neither shape is present, or when the name is missing,
 * non-string, or empty — callers then keep their conservative fallback.
 */
export declare function sourcePluginOf(source: {
    kind?: unknown;
    plugin?: unknown;
} | undefined): string | undefined;
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
export declare function isAgentInstructionsRow(event: SessionEvent): boolean;
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
export declare function isSkillCatalogRow(event: SessionEvent): boolean;
export declare function classifySurfaceEvent(event: SessionEvent): SurfaceEventClass;
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
export declare function classifyInjectedMessage(message: unknown): SurfaceEventClass;
export declare function traceSessionEvents(session: Session): void;
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
export declare function isRealUserTurn(event: SessionEvent): boolean;
/** 长度门槛，与 acpk 的 `QUOTE_LONG_CHARS` 对齐：短消息不存在"材料"问题。 */
export declare const MATERIAL_MIN_CHARS = 500;
/** 行数门槛：单行的长报错不算材料（它没有"正文 + 说明"的两层结构）。 */
export declare const MATERIAL_MIN_LINES = 6;
/**
 * 结构化行占比门槛：低于此说明主体是散文，是用户在说话。
 *
 * 2026-10-29 实测修正：任务卡正文全是 `# 标题` / `- 条目` 行，**句子**占比很低
 * 但**结构**占比很高（实测 0.88）。旧口径用"结构化行数 / 非空行数"，对
 * 「一句说明 + 一大段排版」的任务卡仍会误判成散文 —— 改成按**带标点的散文句**
 * 反推：只有当散文行确实占多数时才判不是材料。
 */
export declare const MATERIAL_STRUCTURE_RATIO = 0.5;
/**
 * 指令标记密度（个 / 1000 字符）—— **仅供诊断**，不再参与材料判定。
 *
 * ⚠️ 2026-10-29 实测修正：任务卡正文本身满是「必须/不得」（实测密度 3.0–3.5），
 * 但那是**文档内容**不是用户在下命令。旧口径只看密度，把任务卡判成"不是材料"，
 * 于是保真门去查文档正文里的「不得碰（C5-9）」→ 14 条误报。
 * 修正：密度高**不再单独否决**，只有当**开头像用户在对模型说话**时才否决。
 */
export declare const MATERIAL_MAX_DIRECTIVE_DENSITY = 3;
/**
 * 散文句占比上限：超过它说明用户在跟模型说话，不是在贴材料。
 *
 * 实测：任务卡 / 堆栈粘贴 / 日志粘贴的散文句占比都在 0.1 以下；
 * 用户自己写的长清单（编号 + 每行「必须/不得」）会超过这个比例 ——
 * 那正是 D-9D 要收回严档的场景，不该判成材料。
 */
export declare const MATERIAL_PROSE_MAX_RATIO = 0.5;
/**
 * 粘贴痕迹占比下限：堆栈 / 日志 / 代码围栏这类整段粘贴的内容。
 *
 * 它们既不是 Markdown 标题（抓不到结构占比），也不含散文句。
 * 靠"这种行占非空行的多少"来认 —— 实测堆栈粘贴占比 0.3 以上。
 */
export declare const MATERIAL_PASTE_ARTIFACT_RATIO = 0.3;
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
export declare const MATERIAL_HEADER_PROSE_MAX_LINES = 3;
/** 正文中散文行占比上限：超过说明用户自己在正文里说话，不是粘贴。 */
export declare const MATERIAL_BODY_PROSE_MAX_RATIO = 0.25;
/** 粘贴正文的最小体量：字符数、非空行数、占全文字符的比例。 */
export declare const MATERIAL_BODY_MIN_CHARS = 300;
export declare const MATERIAL_BODY_MIN_LINES = 2;
export declare const MATERIAL_BODY_CHARS_RATIO = 0.5;
/** 这条消息的硬约束密度（个 / 1000 字符）。仅供诊断与报告引用。 */
export declare function materialDirectiveDensity(text: string): number;
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
export declare function isMaterialUserText(text: string): boolean;
/**
 * 一条 surface 事件的来源标签（TASK-7）。映射自 `classifySurfaceEvent` 的四分类
 * 再加上来源细看，得到设计文档 §3.2 的七值。
 *
 * 用 `classifySurfaceEventRaw` 而不是 `classifySurfaceEvent`：后者会触发插桩写盘，
 * 而投影路径每轮都跑，插桩由宿主 `agent/pre-step` 的 `traceSessionEvents` 统一
 * 扫一遍（TASK-3 的口径），这里再写就是算两遍。
 */
export declare function provenanceOfEvent(event: SessionEvent, text: string): MessageProvenance;
export {};
