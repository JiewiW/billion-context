/**
 * 前提验证：会话日志里的 `seq` 是不是可以当"事件身份"用。
 *
 * 为什么要验：`inject-trace.ts` 的事件级去重从"逐个记去重键"改成了"每个会话
 * 只记一个最大序号（水位线）"，这条改法成立的前提是 —— 会话日志里
 * **同一个 seq 只会出现一次**。若某个 seq 可能被两个不同事件共用（例如
 * 同一会话里 5 号既是 user/message 又是 tool/result），水位线就会把后一个
 * 误判成"记过了"而漏记。
 *
 * 量四件事：
 *   1. seq 是不是数值、是不是**严格递增**（允许断层，不允许回头）；
 *   2. 有没有**重号**（同一会话同一 seq 出现 ≥2 次）—— 这是致命项；
 *   3. 真出现重号时，重号的事件是不是**不同类型**（把风险坐实/否掉）；
 *   4. 序号会不会**断层**（中间缺号）—— 断层是真实的（日志会在 Compaction
 *      时被重写/截断），去重实现不能假定连续性。
 *
 * 用法：node --experimental-strip-types ../case/seq-uniqueness-probe.mjs <sessionsRoot> <topN>
 *       node case/seq-uniqueness-probe.mjs "<HOME>/.dsh/sessions" 20
 */
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
// @ts-expect-error - 无类型声明的 JS 辅助模块
import { readSessionEvents } from './session-read.mjs'

/** 线上真正会被记为一行的话（`messages.ts` 的 TRACED_EVENT_TYPES）。 */
const TRACED_TYPES = new Set([
  'user/message',
  'assistant/message',
  'tool/result',
  'compaction/summary',
  'agent/inbox/spliced',
])

const SESSIONS_ROOT = process.argv[2] ?? join(process.env.HOME ?? '', '.dsh', 'sessions')
const TOP_N = Number(process.argv[3] ?? 20)

/** 取体积最大的 N 个 v4 会话（与 `trace-online-parity.ts` 同一批）。 */
function pickSessions(rootDir, count) {
  const found = []
  for (const ws of readdirSync(rootDir, { withFileTypes: true })) {
    if (!ws.isDirectory()) continue
    const wsDir = join(rootDir, ws.name)
    for (const sid of readdirSync(wsDir, { withFileTypes: true })) {
      if (!sid.isDirectory()) continue
      const file = join(wsDir, sid.name, 'session.v4.jsonl.zstd')
      try {
        found.push({ file, size: statSync(file).size })
      } catch {
        /* 无 v4 文件 */
      }
    }
  }
  return found.sort((a, b) => b.size - a.size).slice(0, count)
}

const sessions = pickSessions(SESSIONS_ROOT, TOP_N)
const report = {
  sessions: sessions.length,
  eventsTotal: 0,
  tracedEventsTotal: 0,
  nonNumericSeqEvents: [],
  orderViolations: [],
  duplicateSeqSamples: [],
  duplicateSeqOfDifferentType: [],
  sessionsWithDuplicateSeq: 0,
  duplicateSeqGroups: 0,
  sessionsWithGap: 0,
  gapSamples: [],
}

for (const session of sessions) {
  const { events } = readSessionEvents(session.file)
  report.eventsTotal += events.length
  /** seq -> [{ seqIndex, type }]，用来找重号。 */
  const seqOwners = new Map()
  let previousSeq = null
  let index = 0
  for (const event of events) {
    index += 1
    const seq = event.seq
    if (typeof seq !== 'number' || !Number.isFinite(seq)) {
      if (report.nonNumericSeqEvents.length < 5) {
        report.nonNumericSeqEvents.push({ session: session.file.slice(-12), type: event.type, seq: String(seq) })
      }
      continue
    }
    if (TRACED_TYPES.has(event.type)) report.tracedEventsTotal += 1
    if (previousSeq !== null && seq < previousSeq && report.orderViolations.length < 5) {
      report.orderViolations.push({ session: session.file.slice(-12), prev: previousSeq, seq, type: event.type })
    }
    previousSeq = seq
    const owners = seqOwners.get(seq) ?? []
    owners.push({ type: event.type, index })
    seqOwners.set(seq, owners)
  }
  const duplicates = [...seqOwners.entries()].filter(([, owners]) => owners.length > 1)
  // 断层：已见的数值序号最大值，但事件数小于"最大值 - 最小值 + 1" ⇒ 中间有缺口。
  if (seqOwners.size > 0) {
    const numericSeqs = [...seqOwners.keys()]
    const minSeq = Math.min(...numericSeqs)
    const maxSeq = Math.max(...numericSeqs)
    const span = maxSeq - minSeq + 1
    if (span !== seqOwners.size) {
      report.sessionsWithGap += 1
      if (report.gapSamples.length < 5) {
        report.gapSamples.push({
          session: session.file.slice(-12),
          minSeq,
          maxSeq,
          distinctSeqs: seqOwners.size,
          missing: span - seqOwners.size,
        })
      }
    }
  }
  if (duplicates.length > 0) {
    report.sessionsWithDuplicateSeq += 1
    report.duplicateSeqGroups += duplicates.length
    for (const [seq, owners] of duplicates) {
      const types = [...new Set(owners.map((owner) => owner.type))]
      if (report.duplicateSeqSamples.length < 10) {
        report.duplicateSeqSamples.push({ session: session.file.slice(-12), seq, types, count: owners.length })
      }
      // 致命项：同一 seq 被**不同类型**的事件共用 —— 水位线会漏记后一个。
      if (types.length > 1 && report.duplicateSeqOfDifferentType.length < 10) {
        report.duplicateSeqOfDifferentType.push({ session: session.file.slice(-12), seq, types })
      }
    }
  }
}

console.log(JSON.stringify(report, null, 2))
