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

import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** 前 N 字符指纹长度（与 `_bc-src/case/dedup-recount.js` 的指纹口径同源）。 */
export const TRACE_FP_CHARS = 120

/** 日志默认落点：`%USERPROFILE%/.dsh/logs/acp-inject-trace.jsonl`。 */
export const TRACE_DEFAULT_FILE = join(homedir(), '.dsh', 'logs', 'acp-inject-trace.jsonl')

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
export const SEEN_CAP = 20000

/** 触顶时一次逐出的老键条数（SEEN_CAP 的十分之一）。 */
export const EVICT_BATCH = SEEN_CAP / 10

/**
 * 事件级去重的水位线：会话命名空间 → 该通道已记到的最大 seq。
 *
 * 依据（探针 `case/seq-uniqueness-probe.mjs`：20 个会话、102842 个事件，
 * 其中 41258 个属会被采集的类型）：会话日志只追加，同一会话内 seq 严格
 * 递增、**无重号**（实测还是一段连续区间）。旧的去重键是 `会话|类型#seq`，
 * 既已确认 seq 在会话内唯一，省掉 type 就不会漏记，换来的是每个会话只占
 * 一条记录、彻底不受 {@link SEEN_CAP} 约束。这次对账 28064 行与旧口径
 * 逐行一致，反过来也把这个前提坐实了。
 *
 * surface 与 spliced **必须分两条水位线**：同一会话里两通道的 seq 是交织的
 * （护栏用例「surface 通道先记过之后，spliced 通道同样不重复记」就是
 * surface@9 先到、spliced@7 后到），共用一条会把后到的合法事件整个跳过。
 */
const surfaceWatermarks = new Map<string, number>()
const splicedWatermarks = new Map<string, number>()

/**
 * 水位线表按**会话数**封顶（每会话只占一条，键是会话 id），满了逐出**最早
 * 进表**的那一个会话条目（注意不是"最久没动的"）。被逐出的会话若再被重扫，
 * 它的历史事件会重记一遍。
 *
 * 撞到这条上限需要同一个进程在开启插桩期间累计扫过 4096 个以上的会话：本机
 * `~/.dsh/sessions` 累计 332 个会话目录（其中 312 个有 v4 文件，2026-10-29
 * 实测），而只有**真正被扫描过**的会话才会占条目（插桩关闭时
 * `traceSessionEvents` 第一行就返回），所以正常采集碰不到。
 */
const WATERMARK_CAP = 4096

/**
 * 非数值 seq 的兜底去重键（`会话|类型#seq`，即 `eventKeyOf` 的旧键语义）。
 * 真实数据里 seq 全是数值（唯一例外是 `session` 头事件，且不在采集范围），
 * 这张表只兜异常/手工事件，配 `addBounded` 同样 FIFO 限容。
 */
const seenUnorderedKeys = new Set<string>()

/**
 * 消息级去重表（**跨通道共享**）。
 *
 * 为什么需要它：一条消息会出现在**两个通道**里 —— `agent/inbox/spliced` 的
 * `data.inserted` 先把它插进 inbox，宿主随后又把它写成一条 `user/message`。
 * 实测（20 个真实会话，5951 条 user/message + 3070 条 spliced 插入消息），
 * 两者按消息 id 的匹配率是 99.22%，即**几乎每一条都被记了两遍**。
 *
 * 不去重的后果不是"多记几行"，而是**浪费量虚高一倍** —— 5a 报告里
 * "同一份内容被重复注入"这个指标会从 46.11% 变成一个接近 100% 的假数字。
 *
 * 用消息 id 而不是指纹做键：id 是宿主给的 uuid，100% 存在且唯一（实测
 * 5951 条 user/message 全部有 id，且没有任何一条 id 在多条事件里重复出现）。
 * 指纹（前 120 字符）会把两条开头相同但内容不同的消息误判成同一条。
 */
const seenMessageIds = new Set<string>()

/** 单行日志的字段口径（计划书 TASK-3 的样例键名，逐字对齐）。 */
export interface InjectTraceLine {
  ts: string
  seq: number | string
  class: string
  source: string
  chars: number
  fp120: string
  trigger: string
}

/**
 * 是否开启采集。默认关闭：只有显式置位才写盘。
 * 值为 `0` / `off` / `false`（忽略大小写与首尾空白）时同样视为关闭。
 */
export function traceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.DSH_ACP_INJECT_TRACE
  if (raw === undefined) return false
  const normalized = raw.trim().toLowerCase()
  if (normalized === '' || normalized === '0' || normalized === 'off' || normalized === 'false') {
    return false
  }
  return true
}

/** 输出路径：env 覆盖优先，否则默认落点。 */
export function traceFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.DSH_ACP_INJECT_TRACE_FILE
  return override !== undefined && override.trim().length > 0 ? override.trim() : TRACE_DEFAULT_FILE
}

/** 本地时区的 ISO 时间戳（带 ±HH:MM 偏移，与计划书样例同形）。 */
function localIsoString(now: Date): string {
  const pad = (value: number, width = 2): string => String(Math.abs(value)).padStart(width, '0')
  const offsetMinutes = -now.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const offset =
    sign + pad(Math.floor(Math.abs(offsetMinutes) / 60)) + ':' + pad(Math.abs(offsetMinutes) % 60)
  return (
    now.getFullYear() +
    '-' +
    pad(now.getMonth() + 1) +
    '-' +
    pad(now.getDate()) +
    'T' +
    pad(now.getHours()) +
    ':' +
    pad(now.getMinutes()) +
    ':' +
    pad(now.getSeconds()) +
    '.' +
    pad(now.getMilliseconds(), 3) +
    offset
  )
}

/**
 * 事件的来源标签：`plugin:<name>`（两种插件形状归一）、直接 kind、`none`
 * （无 source 字段）或 `unknown`（source 存在但无可用 kind/plugin）。
 * 口径与 `messages.sourcePluginOf` 一致，但不 import 它 —— 反向 import 会与
 * `messages.ts` 形成循环依赖（messages 要 import 本模块的挂点函数）。
 *
 * 接受**载荷**而不是事件：`user/message` 事件的载荷是 `event.data`，
 * `agent/inbox/spliced` 插入消息的载荷是消息对象自身 —— 两者形状不同，
 * 但 `source` 字段的位置一致，所以这一个函数两边通用。
 */
function sourceLabelOf(payload: unknown): string {
  const source = (payload as { source?: { kind?: unknown; plugin?: unknown } } | undefined)?.source
  if (source === undefined || source === null || typeof source !== 'object') return 'none'
  if (source.kind === 'plugin' && typeof source.plugin === 'string' && source.plugin.length > 0) {
    return 'plugin:' + source.plugin
  }
  if (typeof source.kind === 'string' && source.kind.length > 0) return source.kind
  return 'unknown'
}

/**
 * 载荷里的消息 id（非空字符串才算数）。
 *
 * `user/message` 事件的载荷是 `event.data`（id 在 `data.id`），
 * `agent/inbox/spliced` 插入消息的载荷是消息对象自身（id 在 `message.id`）——
 * 同一个读取点覆盖两个通道。
 */
function messageIdOf(payload: unknown): string | null {
  const id = (payload as { id?: unknown } | undefined)?.id
  return typeof id === 'string' && id.length > 0 ? id : null
}

/**
 * 事件文本的字符数（§6 量纲：字符，不是 token）。
 *
 * 与 `messages.extractText` 同源语义（字符串原样、块数组按 `text` 累加、
 * `tool-result` 递归进内部 content），但本模块自带实现以避开循环 import。
 * 差异声明：`extractText` 还会对未知块类型做额外兜底，所以两者在**非文本块**
 * 上可能有极小偏差；5a 报告的分母一律以本口径为准。
 */
export function traceTextOf(event: SessionEvent): string {
  const data = event.data as
    | { content?: unknown; message?: { content?: unknown } }
    | undefined
  const content = data?.message?.content ?? data?.content
  return collectText(content)
}

/**
 * 一条 `agent/inbox/spliced` 插入消息的文本。
 *
 * 与 {@link traceTextOf} 同语义、同实现（共用 `collectText`），只是载荷形状不同：
 * spliced 的 inserted 元素是**消息对象**（`{id, role, content, source}`），
 * 不是事件（没有 `data` 层）。
 */
export function traceTextOfMessage(message: { content?: unknown } | undefined): string {
  return collectText(message?.content)
}

/**
 * 追加一行观测日志。**永不抛错** —— 观测失败不得影响主流程。
 */
function writeTraceLine(line: InjectTraceLine, env: NodeJS.ProcessEnv): void {
  const file = traceFilePath(env)
  mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, JSON.stringify(line) + '\n', 'utf8')
}

/**
 * 文本块的累加 —— **`messages.extractText` 的逐字复刻**。
 *
 * 插桩量的是**真正进上下文**的字符，所以口径必须与投影用的 `extractText`
 * 完全一致，否则线上采到的数与实际占用对不上。三处具体差异（早先的
 * `collectText` 都踩了，线上与回放各算各的，对不上账）：
 *
 *   - **只取 `type === 'text'` 的块**。早先的实现看的是"块上有没有 text 字段"，
 *     于是把 `reasoning` 块的推理内容也算进去 —— 而投影时 `extractText` 并不取它，
 *     那些字根本不进模型上下文。实测这一项让 20 个会话多算了 4105 行、
 *     1528 万字符。
 *   - **递归进 `block.content`**（且只递归数组）。`tool-result` 块的内部文本是
 *     实打实发给模型的，不能漏。
 *   - **多个块之间用 `\n` 连接**。`extractText` 是 `parts.join('\n')`，
 *     早先的实现直接累加，少了每个块边界的一个换行符。
 *
 * `image` / `file` 块按 `messages.extractText` 的做法渲染成一行占位符并计入 ——
 * 占位符同样进了模型上下文，量纲要与真实占用一致。
 */
function collectText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const part of content) {
    if (typeof part === 'string') {
      parts.push(part)
      continue
    }
    if (part === null || typeof part !== 'object') continue
    const block = part as { type?: unknown; text?: unknown; content?: unknown; attachment?: unknown }
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
    } else if (block.type === 'image' || block.type === 'file') {
      const placeholder = attachmentPlaceholder(block.type, block.attachment)
      if (placeholder !== null) parts.push(placeholder)
    } else if (Array.isArray(block.content)) {
      parts.push(collectText(block.content))
    }
  }
  return parts.join('\n')
}

/** 字节数的短人类可读形式（与 `messages.formatBytes` 同形，确定性、不随语言变）。 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

/**
 * 图片/文件块的一行占位符 —— `messages.attachmentPlaceholder` 的复刻。
 *
 * 复刻而不是 import：`messages.ts` 要 import 本模块，反向 import 会形成循环依赖
 * （这一点在模块头已声明）。两处必须保持同形，否则插桩量出来的字符数与真正
 * 发给模型的文本对不上。
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
  const dimensions =
    typeof a.width === 'number' && typeof a.height === 'number' ? ` ${a.width}x${a.height}` : ''
  return `[image ${mediaType}${name ? ` ${name}` : ''}${dimensions}${size}]`
}

/**
 * 去重键：同一事件在投影过程中会被反复分类，只记第一次。
 *
 * **必须带命名空间**（会话 id）：`seq` 是会话内的序号，不同会话会重号。
 * 早先的 `type#seq` 键在多会话场景下会把后一个会话的大量事件误判成
 * "已记过"而跳过 —— 实测 20 个会话时线上少记了 5820 行。
 */
function eventKeyOf(event: SessionEvent, namespace: string): string {
  const seq = (event as { seq?: unknown }).seq
  return namespace + '|' + String((event as { type?: unknown }).type) + '#' + String(seq)
}

/** seq 的数值形态：非有限数字（含 undefined、字符串）一律返回 null，调用方退回兜底键。 */
function numericSeqOf(seq: unknown): number | null {
  return typeof seq === 'number' && Number.isFinite(seq) ? seq : null
}

/**
 * Set 的 FIFO 逐出：删掉插入最早的 count 个键（JS 的 Set 迭代顺序就是插入顺序）。
 * 只在触顶时调用，一次逐出一小批，绝不整表清空。
 */
function evictOldestKeys(set: Set<string>, count: number): void {
  let removed = 0
  for (const key of set) {
    if (removed >= count) break
    set.delete(key)
    removed += 1
  }
}

/** Map 的 FIFO 逐出：删掉插入最早的 count 个条目（与 evictOldestKeys 分开写，避开 TS 联合类型迭代问题）。 */
function evictOldestEntries(map: Map<string, number>, count: number): void {
  let removed = 0
  for (const key of map.keys()) {
    if (removed >= count) break
    map.delete(key)
    removed += 1
  }
}

/**
 * 有界去重键添加：键已存在返回 false（已记过）；新增时若表已满，先 FIFO 逐出
 * 最老的一批（{@link EVICT_BATCH}）再加——绝不整表清空。
 */
function addBounded(set: Set<string>, key: string): boolean {
  if (set.has(key)) return false
  if (set.size >= SEEN_CAP) evictOldestKeys(set, EVICT_BATCH)
  set.add(key)
  return true
}

/**
 * 水位线认领：`seq` 高于当前水位线 → 推进水位线并返回 true（首次见到）；
 * 否则返回 false（已记过）。
 *
 * 新会话且表已满时先逐出最老的一个会话条目（每会话只占一条，正常远够用）。
 */
function bumpWatermark(map: Map<string, number>, namespace: string, seq: number): boolean {
  const watermark = map.get(namespace)
  if (watermark !== undefined && seq <= watermark) return false
  if (watermark === undefined && map.size >= WATERMARK_CAP) evictOldestEntries(map, 1)
  map.set(namespace, seq)
  return true
}

/**
 * 记录一次分类结果。**永不抛错**：任何异常都在此吞掉，观测不得影响主流程。
 *
 * @param surfaceClass 分类器给出的四值之一，原样写入（不在本模块重新判定）。
 * @param namespace 会话命名空间（会话 id），用于把去重键隔开到单个会话内。
 */
export function traceSurfaceEvent(
  event: SessionEvent,
  surfaceClass: string,
  env: NodeJS.ProcessEnv = process.env,
  namespace: string = '',
): void {
  if (!traceEnabled(env)) return
  try {
    // 事件级去重：数值 seq 记 surface 水位线（一条会话只占一个条目，不随事件
    // 数膨胀），非数值 seq 退回旧键表。标记发生在消息 id 检查与文本提取
    // **之前** —— 空文本事件也占去重位（旧版顺序语义，改了会让空事件每步都被
    // 重新分类一遍）。
    const seq = numericSeqOf((event as { seq?: unknown }).seq)
    if (seq === null) {
      if (!addBounded(seenUnorderedKeys, eventKeyOf(event, namespace))) return
    } else {
      if (!bumpWatermark(surfaceWatermarks, namespace, seq)) return
    }
    // 跨通道互斥：同一条消息若已在 `agent/inbox/spliced` 通道记过，这里不再记第二遍。
    // 没有这一步，线上活采集会把几乎每条消息记两遍（实测匹配率 99.22%），
    // "重复注入浪费量"这个指标会直接虚高一倍。
    const messageId = messageIdOf(event.data as { id?: unknown } | undefined)
    if (messageId !== null && !addBounded(seenMessageIds, messageId)) return
    const text = traceTextOf(event)
    // 空文本不记：回放口径（`case/replay-trace.ts`）也跳过空块，两边行数才可比。
    if (text.length === 0) return
    writeTraceLine(
      {
        ts: localIsoString(new Date()),
        seq: (event as { seq?: unknown }).seq as number | string,
        class: surfaceClass,
        source: sourceLabelOf(event.data),
        chars: text.length,
        fp120: text.slice(0, TRACE_FP_CHARS),
        // 分类点拿不到触发原因（触发方在上游 host 侧），按计划书填 unknown，禁止编造。
        trigger: 'unknown',
      },
      env,
    )
  } catch {
    // 观测失败不得影响压缩链：静默。
  }
}

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
export function traceInjectedMessage(
  message: { id?: unknown; content?: unknown; source?: unknown } | undefined,
  surfaceClass: string,
  hostSeq: number | string,
  env: NodeJS.ProcessEnv = process.env,
  namespace: string = '',
): void {
  if (!traceEnabled(env)) return
  try {
    const messageId = messageIdOf(message)
    if (messageId !== null && !addBounded(seenMessageIds, messageId)) return
    const text = traceTextOfMessage(message)
    // 空文本不记：与 surface 通道和回放口径保持一致。
    if (text.length === 0) return
    writeTraceLine(
      {
        ts: localIsoString(new Date()),
        seq: hostSeq,
        class: surfaceClass,
        source: sourceLabelOf(message),
        chars: text.length,
        fp120: text.slice(0, TRACE_FP_CHARS),
        trigger: 'unknown',
      },
      env,
    )
  } catch {
    // 观测失败不得影响主流程：静默。
  }
}

/** 测试辅助：清空全部去重状态（生产路径不需要）。 */
export function resetTraceSeen(): void {
  surfaceWatermarks.clear()
  splicedWatermarks.clear()
  seenUnorderedKeys.clear()
  seenMessageIds.clear()
}

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
export function claimSplicedEvent(hostSeq: number | string, namespace: string = ''): boolean {
  const seq = numericSeqOf(hostSeq)
  if (seq === null) return true
  return bumpWatermark(splicedWatermarks, namespace, seq)
}

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
export function eventAlreadyTraced(event: SessionEvent, namespace: string = ''): boolean {
  const seq = numericSeqOf((event as { seq?: unknown }).seq)
  if (seq === null) return seenUnorderedKeys.has(eventKeyOf(event, namespace))
  const watermark = surfaceWatermarks.get(namespace)
  return watermark !== undefined && seq <= watermark
}

/**
 * 这个消息 id 是否已经记过（跨通道共享）。
 *
 * 同上：先查再分类，避免对已经记过的消息重复跑分类器。
 */
export function messageAlreadyTraced(messageId: string | null): boolean {
  return messageId !== null && seenMessageIds.has(messageId)
}
