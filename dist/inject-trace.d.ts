/**
 * TASK-3 / 改进 5a — 重复注入**插桩**（纯观测，不去重、不改写、不改行为）。
 *
 * 目的：回答两个问题，且只靠真实数据回答，不靠猜。
 *   ① 会话里的「真实浪费」——同一份内容被重复注入——占多少字符；
 *   ② 重复成因四分类（real / metadata / checkpoint / instruction）各占多少。
 *
 * 挂点：`messages.ts` 的 `traceSessionEvents` —— 宿主每个 step 扫一遍会话全量
 * 日志，把所有通道的消息都过一遍分类器并记一行。
 *
 * 为什么是主动扫，而不是挂在分类器上等它被动被调用：
 *   - 分类器的调用点只有保护尾扫描（只碰 user/message）和可压缩范围扫描
 *     （要等会话真的发生压缩才跑），所以 assistant / tool 两个通道的采集
 *     覆盖会随会话压力浮动，短会话甚至一行都不记；
 *   - `agent/inbox/spliced` 通道的消息不是 surface 事件，永远不会被分类
 *     （5a 报告 §5.2 记的未做项）。
 *
 * 因此分类器本身（`classifySurfaceEvent`）**不再写盘**，写盘只有这一个入口 ——
 * 两个入口同时存在就会把同一条消息记两遍。
 *
 * 去重有两层，缺一不可：
 *   - 事件级：同一事件被反复扫到时只记一次。数值 seq 按会话记**水位线**
 *     （surface 与 spliced 两条通道各一张），非数值 seq 退回旧键表（键带
 *     会话命名空间，否则不同会话的相同 seq 会互相顶掉）；
 *   - 消息级：同一条消息在 `agent/inbox/spliced` 与 `user/message` 两个通道各
 *     出现一次（实测按 id 匹配率 99.22%），跨通道共享一张消息 id 表互斥。
 *
 * 读盘纪律（计划书 TASK-3「禁止」项）：
 *   - 不写 `~/.dsh/sessions/`（会话目录只由宿主写，混入外部文件会毒化会话索引）；
 *   - 写到 `~/.dsh/logs/acp-inject-trace.jsonl`，追加、单行 JSON；
 *   - 本模块的任何失败都必须静默吞掉：观测不得影响主流程。
 *
 * 开关（默认**关闭**——插桩是采集期的临时状态，不该让生产实例默默写盘）：
 *   - `DSH_ACP_INJECT_TRACE=1` 打开（`0`/`off`/`false` 关闭，未设置即关闭）；
 *   - `DSH_ACP_INJECT_TRACE_FILE=<path>` 覆盖输出路径（测试用临时目录）。
 *
 * @module billion-context/inject-trace
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session';
/** 前 N 字符指纹长度（与 `_bc-src/case/dedup-recount.js` 的指纹口径同源）。 */
export declare const TRACE_FP_CHARS = 120;
/** 日志默认落点：`%USERPROFILE%/.dsh/logs/acp-inject-trace.jsonl`。 */
export declare const TRACE_DEFAULT_FILE: string;
/**
 * 去重表的容量上限。长时间运行的实例会看到成千上万个事件/消息 id，而这些
 * 表只用于「同一事件/消息别记两行」。
 *
 * 触顶的处理是 **FIFO 逐出最老的一批**（`evictOldestKeys`），绝不整表清空：
 * 宿主每个 step 都会全量重扫一遍会话日志，整表清空之后下一步就把全部历史
 * 事件重新分类、重新写一遍行（实测 20 个会话 28064 行，必超 20000 上限），
 * 预查 `eventAlreadyTraced` 随之失效，日志里出现成批重复行。
 *
 * 事件级去重已经不在这张上限里：改用水位线（`surfaceWatermarks` /
 * `splicedWatermarks`，每个会话只占一条），受此上限约束的只剩两个 Set ——
 * `seenMessageIds`（跨通道消息 id）与 `seenUnorderedKeys`（非数值 seq 兜底键）。
 */
export declare const SEEN_CAP = 20000;
/** 触顶时一次逐出的老键条数（SEEN_CAP 的十分之一）。 */
export declare const EVICT_BATCH: number;
/** 单行日志的字段口径（计划书 TASK-3 的样例键名，逐字对齐）。 */
export interface InjectTraceLine {
    ts: string;
    seq: number | string;
    class: string;
    source: string;
    chars: number;
    fp120: string;
    trigger: string;
}
/**
 * 是否开启采集。默认关闭：只有显式置位才写盘。
 * 值为 `0` / `off` / `false`（忽略大小写与首尾空白）时同样视为关闭。
 */
export declare function traceEnabled(env?: NodeJS.ProcessEnv): boolean;
/** 输出路径：env 覆盖优先，否则默认落点。 */
export declare function traceFilePath(env?: NodeJS.ProcessEnv): string;
/**
 * 事件文本的字符数（§6 量纲：字符，不是 token）。
 *
 * 与 `messages.extractText` 同源语义（字符串原样、块数组按 `text` 累加、
 * `tool-result` 递归进内部 content），但本模块自带实现以避开循环 import。
 * 差异声明：`extractText` 还会对未知块类型做额外兜底，所以两者在**非文本块**
 * 上可能有极小偏差；5a 报告的分母一律以本口径为准。
 */
export declare function traceTextOf(event: SessionEvent): string;
/**
 * 一条 `agent/inbox/spliced` 插入消息的文本。
 *
 * 与 {@link traceTextOf} 同语义、同实现（共用 `collectText`），只是载荷形状不同：
 * spliced 的 inserted 元素是**消息对象**（`{id, role, content, source}`），
 * 不是事件（没有 `data` 层）。
 */
export declare function traceTextOfMessage(message: {
    content?: unknown;
} | undefined): string;
/**
 * 记录一次分类结果。**永不抛错**：任何异常都在此吞掉，观测不得影响主流程。
 *
 * @param surfaceClass 分类器给出的四值之一，原样写入（不在本模块重新判定）。
 * @param namespace 会话命名空间（会话 id），用于把去重键隔开到单个会话内。
 */
export declare function traceSurfaceEvent(event: SessionEvent, surfaceClass: string, env?: NodeJS.ProcessEnv, namespace?: string): void;
/**
 * 记录一条 `agent/inbox/spliced` 通道插入的消息。
 *
 * 为什么需要这个入口：插桩原本只挂在 `classifySurfaceEvent` 上，而那是
 * **surface 事件**的分类点；`agent/inbox/spliced` 的 `data.inserted` 里装的是
 * 消息对象，不是事件，永远不会经过那个分类器 —— 线上活采集会整条漏掉
 * 这个通道（5a 报告 §5.2 记的未做项）。
 *
 * 与 surface 通道**共享同一张消息 id 去重表**：同一条消息只记一次，
 * 先被扫到的通道先记。因此两通道合计的条数、字符数与回放口径一致。
 *
 * @param surfaceClass 分类结果，由宿主侧的分类器给出（本模块不重新判定）。
 * @param hostSeq 承载这条插入消息的事件 seq —— 用来定位，不参与去重。
 */
export declare function traceInjectedMessage(message: {
    id?: unknown;
    content?: unknown;
    source?: unknown;
} | undefined, surfaceClass: string, hostSeq: number | string, env?: NodeJS.ProcessEnv, namespace?: string): void;
/** 测试辅助：清空全部去重状态（生产路径不需要）。 */
export declare function resetTraceSeen(): void;
/**
 * 认领一条 `agent/inbox/spliced` 事件（事件级去重，spliced 通道专用）。
 *
 * 每步全量扫会把同一条 spliced 事件反复扫到；它的 inserted 列表整体只处理
 * 一次，比逐条查消息 id 表更早拦截，也让**没有 id 的插入消息**（消息 id 表
 * 管不到它们）同样不会被每步重记。seq 高于水位线才认领成功——会话日志只
 * 追加、seq 单调递增（真实数据实测），重复扫到的同一事件必然认领失败。
 *
 * 与 surface 通道的水位线**必须分开**（见 {@link splicedWatermarks}）：同一
 * 会话里两条通道的 seq 是交织的，共用一条会把后到的合法事件整个跳过。
 *
 * @param hostSeq 承载插入消息列表的事件 seq。
 * @param namespace 会话命名空间（会话 id）。
 * @returns true = 首次见到，调用方应处理 inserted 列表；false = 已处理过。
 *   非数值 seq 认领不了（比不了大小），返回 true 退回消息 id 表逐条去重——
 *   只保证不比旧版多记。
 */
export declare function claimSplicedEvent(hostSeq: number | string, namespace?: string): boolean;
/**
 * 这个事件是否已经记过。
 *
 * 用途：宿主每步都扫一遍全量日志补采集，而绝大多数事件在第一步就记过了。
 * 先查水位线再决定要不要跑分类器，可以避免每步重复做文本匹配
 * （分类器里 `isSkillCatalogRow` 要扫全文）—— 扫描成本从 O(n×文本) 降到 O(n)。
 *
 * 数值 seq 查 surface 水位线；非数值 seq（真实数据里只有 `session` 头事件，
 * 且不在采集范围）退回旧键表。
 */
export declare function eventAlreadyTraced(event: SessionEvent, namespace?: string): boolean;
/**
 * 这个消息 id 是否已经记过（跨通道共享）。
 *
 * 同上：先查再分类，避免对已经记过的消息重复跑分类器。
 */
export declare function messageAlreadyTraced(messageId: string | null): boolean;
