/**
 * TASK-3 补口的端到端验证：线上插桩路径的产出 == 回放口径。
 *
 * 背景：补上全通道主动补扫之后，线上活采集和回放脚本
 * （`case/replay-trace.ts`）走的是两条不同的路径：
 *   - 回放：一条 log 顺序扫过去，spliced 的 inserted 与后续 surface 消息
 *     按消息 id 去重（spliced 先到先记）。
 *   - 线上：宿主钩子每个 step 扫一遍全量日志，靠跨通道共享的消息 id 去重表互斥。
 *
 * 两条路径必须给出**同一个结果**（条数、字符数、四分类分布），否则 5a 报告的
 * 数字在线上和离线就对不上，这份采集数据也就没有比较价值。
 *
 * 本脚本用真实会话跑一遍线上路径，再独立算一遍回放口径，逐项对比。
 *
 * 用法：cd <DSH>/_bc-src/bcdsh && npx tsx ../case/trace-online-parity.ts
 */
import { readFileSync, rmSync, statSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { classifyInjectedMessage, classifySurfaceEvent, extractText, traceSessionEvents } from '../bcdsh/src/messages.ts'
import { resetTraceSeen } from '../bcdsh/src/inject-trace.ts'
// @ts-expect-error - 无类型声明的 JS 辅助模块
import { readSessionEvents } from './session-read.mjs'

const OUT = '<DSH>/_bc-src/case/acp-inject-trace-online-20261028.jsonl'
const SESSIONS_ROOT = process.argv[2] ?? `${process.env.HOME ?? ''}/.dsh/sessions`
const TOP_N = Number(process.argv[3] ?? 20)

process.env.DSH_ACP_INJECT_TRACE = '1'
process.env.DSH_ACP_INJECT_TRACE_FILE = OUT

/** 取体积最大的 N 个 v4 会话。 */
function pickSessions(root: string, count: number): string[] {
  const out: Array<{ file: string; size: number }> = []
  for (const ws of readdirSync(root, { withFileTypes: true })) {
    if (!ws.isDirectory()) continue
    const wsDir = join(root, ws.name)
    for (const sid of readdirSync(wsDir, { withFileTypes: true })) {
      if (!sid.isDirectory()) continue
      const file = join(wsDir, sid.name, 'session.v4.jsonl.zstd')
      try {
        out.push({ file, size: statSync(file).size })
      } catch {
        /* 无 v4 文件 */
      }
    }
  }
  return out
    .sort((a, b) => b.size - a.size)
    .slice(0, count)
    .map((item) => item.file)
}

/** 与 `inject-trace.ts` 的 `collectText` 同语义：只累加 text 块。 */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  let out = ''
  for (const part of content) {
    if (part === null || typeof part !== 'object') continue
    const block = part as { type?: unknown; text?: unknown }
    if (block.type === 'text' && typeof block.text === 'string') out += block.text
  }
  return out
}

/** 事件的文本：与 `inject-trace.ts` 的 `traceTextOf` 完全同形。 */
function eventTextOf(event: any): string {
  return textOf(event.data?.message?.content ?? event.data?.content)
}

// ── 线上路径：完全按宿主的方式走一遍 ─────────────────────────────────────
resetTraceSeen()
try {
  rmSync(OUT, { force: true })
} catch {
  /* 不存在即无需删 */
}

const sessions = pickSessions(SESSIONS_ROOT, TOP_N)
for (const file of sessions) {
  const { events } = readSessionEvents(file) as { events: any[] }
  // 宿主 pre-step 钩子做的事：扫一遍全量日志。会话 id 作去重命名空间。
  traceSessionEvents({ id: file, snapshotEvents: () => events } as never)
}

const online = readFileSync(OUT, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((raw) => JSON.parse(raw) as Record<string, unknown>)

// ── 回放口径：独立算一遍（不经过插桩） ────────────────────────────────────
const replayIds = new Set<string>()
let replayRawCount = 0
let replayRawChars = 0
let replayUniqueCount = 0
let replayUniqueChars = 0
const replayClassCount: Record<string, number> = {}
const replayClassChars: Record<string, number> = {}
/** 回放口径的逐条明细：fp120 -> {chars, class} */
const replayDetail = new Map<string, { chars: number; class: string }>()

/**
 * 回放口径：逐字照抄 `case/replay-trace.ts` 的 `pushMessage` —— 同样的去重规则
 * （`originType|id` + 全局 `*|id`）、同样的 `!Array.isArray(content) → 丢弃`、
 * 同样的 text 块筛选。自己重写一份简化版就等于拿两套规则在比，对账没有意义。
 */
let duplicatedIdSkips = 0

function recordReplay(
  message: any,
  originType: string,
  seq: string,
  seenIds: Set<string>,
): void {
  if (message === null || typeof message !== 'object') return
  const role = typeof message.role === 'string' ? message.role : 'unknown'
  const id = typeof message.id === 'string' ? message.id : ''
  if (id.length > 0) {
    if (seenIds.has(originType + '|' + id)) return
    if (seenIds.has('*|' + id)) {
      duplicatedIdSkips += 1
      return
    }
    seenIds.add('*|' + id)
    seenIds.add(originType + '|' + id)
  }
  // 文本口径与宿主投影一致（与 `replay-trace.ts` 现在的做法同形）。
  const text = extractText(message.content)
  if (text.length === 0) return
  replayRawCount += 1
  replayRawChars += text.length
  replayUniqueCount += 1
  replayUniqueChars += text.length
  // 分类：回放口径把每条消息还原成事件形状再过同一个分类器
  const eventType =
    role === 'user' ? 'user/message' : role === 'assistant' ? 'assistant/message' : 'tool/result'
  const probe = {
    seq: id.length > 0 ? id : seq,
    time: '',
    type: eventType,
    data: { id, role, content: [{ type: 'text', text }], source: message.source },
  }
  const cls = classifySurfaceEvent(probe as never)
  replayClassCount[cls] = (replayClassCount[cls] ?? 0) + 1
  replayClassChars[cls] = (replayClassChars[cls] ?? 0) + text.length
  const fp = text.slice(0, 120)
  const existing = replayDetail.get(fp)
  if (existing === undefined) replayDetail.set(fp, { chars: text.length, class: cls })
}

for (const file of sessions) {
  const { events } = readSessionEvents(file) as { events: any[] }
  // 每个会话一张独立的去重表：回放脚本处理的是单个会话，
  // 跨会话共用一张表会把不同会话里同号的消息误判成同一条。
  const seenIds = new Set<string>()
  for (const event of events) {
    const data = event.data
    if (data === undefined || data === null) continue
    const seq = String(event.seq ?? '')
    const eventType: string = event.type
    if (eventType === 'agent/inbox/spliced' && Array.isArray(data.inserted)) {
      for (const message of data.inserted) recordReplay(message, eventType, seq, seenIds)
      continue
    }
    if (eventType === 'user/message') {
      recordReplay(
        { id: data.id, role: data.role ?? 'user', content: data.content, source: data.source },
        eventType,
        seq,
        seenIds,
      )
      continue
    }
    if (eventType === 'assistant/message') {
      recordReplay(
        {
          id: data.id,
          role: 'assistant',
          content: data.message?.content ?? data.content,
          source: data.source,
        },
        eventType,
        seq,
        seenIds,
      )
      continue
    }
    if (eventType === 'tool/result') {
      recordReplay(
        {
          id: data.id,
          role: 'tool',
          content: data.message?.content ?? data.content,
          source: data.source,
        },
        eventType,
        seq,
        seenIds,
      )
      continue
    }
    if (eventType === 'compaction/summary') {
      recordReplay(
        {
          id: data.id,
          role: 'system',
          content: data.content ?? data.message?.content,
          source: data.source,
        },
        eventType,
        seq,
        seenIds,
      )
    }
  }
}

// ── 线上产出统计 ─────────────────────────────────────────────────────────
let onlineChars = 0
const onlineClassCount: Record<string, number> = {}
const onlineClassChars: Record<string, number> = {}
const onlineDetail = new Map<string, { chars: number; class: string }>()
for (const row of online) {
  const chars = Number(row.chars ?? 0)
  onlineChars += chars
  const cls = String(row.class)
  onlineClassCount[cls] = (onlineClassCount[cls] ?? 0) + 1
  onlineClassChars[cls] = (onlineClassChars[cls] ?? 0) + chars
  const fp = String(row.fp120 ?? '')
  const existing = onlineDetail.get(fp)
  if (existing === undefined) onlineDetail.set(fp, { chars, class: cls })
}

// ── 逐条对账 ─────────────────────────────────────────────────────────────
const onlyOnline = [...onlineDetail.entries()].filter(([fp]) => !replayDetail.has(fp))
const onlyReplay = [...replayDetail.entries()].filter(([fp]) => !onlineDetail.has(fp))

const report = {
  sessions: sessions.length,
  online: {
    rows: online.length,
    chars: onlineChars,
    byClass: onlineClassCount,
    classChars: onlineClassChars,
  },
  replay: {
    rawRows: replayRawCount,
    rawChars: replayRawChars,
    uniqueRows: replayUniqueCount,
    uniqueChars: replayUniqueChars,
    byClass: replayClassCount,
    classChars: replayClassChars,
  },
  parity: {
    rowsMatch: online.length === replayUniqueCount,
    charsMatch: onlineChars === replayUniqueChars,
    rowDelta: online.length - replayUniqueCount,
    charDelta: onlineChars - replayUniqueChars,
    classCountsMatch:
      JSON.stringify(onlineClassCount) === JSON.stringify(replayClassCount),
  },
  perFingerprint: {
    onlyOnline: onlyOnline.length,
    onlyReplay: onlyReplay.length,
    onlyOnlineSamples: onlyOnline.slice(0, 5).map(([fp, v]) => ({
      chars: v.chars,
      class: v.class,
      head: fp.slice(0, 60).replace(/\s+/g, ' '),
    })),
    onlyReplaySamples: onlyReplay.slice(0, 5).map(([fp, v]) => ({
      chars: v.chars,
      class: v.class,
      head: fp.slice(0, 60).replace(/\s+/g, ' '),
    })),
  },
}

console.log(JSON.stringify(report, null, 2))
if (!existsSync(OUT)) console.log('（线上产物文件未生成）')
