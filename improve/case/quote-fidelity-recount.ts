/**
 * TASK-5 / AC-5.3 —— 用**真实会话**的压缩摘要复算保真门命中（warn 模式的误报率报告数据源）。
 *
 * 数据：会话日志里每条 `compaction/summary` 都自带 `shadowedSeqs`（本次压缩遮蔽的事件 seq
 * 列表）与 `summary`（模型亲写的摘要），所以可以逐条重放「这条摘要 vs 它覆盖的 user 消息」，
 * 而不用猜范围。
 *
 * 用法：cd <DSH>/_bc-src/bcdsh && npx tsx ../case/quote-fidelity-recount.ts
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { quoteFidelityViolations } from '../acpk/src/compress.js'
import type { CoreMessage, MessageProvenance } from '../acpk/src/types.js'
import { classifySurfaceEvent, provenanceOfEvent } from '../bcdsh/src/messages.ts'

const SESSION = '<DSH>/_bc-src/case/session-063661eb-0bc3-40fb-97b1-79ac199f6406.jsonl'

const lines = readFileSync(SESSION, 'utf8').split('\n').filter(Boolean)
const events: any[] = []
for (const line of lines) {
  try {
    events.push(JSON.parse(line))
  } catch {
    /* 坏行跳过 */
  }
}
const bySeq = new Map<string, any>()
for (const event of events) bySeq.set(String(event.seq ?? ''), event)

function textOf(event: any): string {
  const data = event.data ?? {}
  const content = data.message?.content ?? data.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  let text = ''
  for (const part of content) {
    if (part && part.type === 'text' && typeof part.text === 'string') text += part.text
    else if (part && Array.isArray(part.content)) text += textOf({ data: { content: part.content } })
  }
  return text
}

interface Row {
  compactionId: string
  shadowed: number
  userMessages: number
  violations: number
  /** 违规消息按宿主分类（real / instruction / checkpoint）拆分。 */
  violationClasses: Record<string, number>
  /** AC-9.5：范围内 user 消息按来源标签分布。`undefined` 单独一组，不许混进
   *  有标签链的误报率 —— 那部分根本没被检查（D-9A fail-open）。 */
  userByProvenance: Record<string, number>
  /** 修正口径：只看 real 分类且 <=500 字符的短消息时的候选条数与残余违规。 */
  strictCandidateMessages: number
  strictViolations: number
  strictMissing: { messageId: string; snippet: string }[]
  missing: { messageId: string; className: string; snippet: string }[]
  summaryHead: string
}

const rows: Row[] = []
for (const event of events) {
  if (event.type !== 'compaction/summary') continue
  const data = event.data ?? {}
  const shadowedSeqs: unknown = data.shadowedSeqs
  if (!Array.isArray(shadowedSeqs)) continue
  const ids: string[] = []
  const messages: CoreMessage[] = []
  const userByProvenance: Record<string, number> = {}
  for (const rawSeq of shadowedSeqs) {
    const seq = String(rawSeq)
    const covered = bySeq.get(seq)
    if (covered === undefined) continue
    const role =
      covered.type === 'user/message'
        ? 'user'
        : covered.type === 'assistant/message'
          ? 'assistant'
          : covered.type === 'tool/result'
            ? 'tool'
            : 'system'
    const text = textOf(covered)
    if (text.length === 0) continue
    ids.push(seq)
    // 来源标签必须走宿主投影的同一份实现（TASK-7）。不打标的话保真门会整条
    // 跳过检查（D-9A 的 fail-open），复算就退化成恒 0 的假结果 —— 2026-10-29
    // 第一次跑就踩了这个坑：60 → 0 看着像大胜，其实是没打标。
    const provenance: MessageProvenance | undefined =
      role === 'user' ? provenanceOfEvent(covered, text) : undefined
    if (role === 'user') {
      const key = provenance ?? 'undefined'
      userByProvenance[key] = (userByProvenance[key] ?? 0) + 1
    }
    messages.push({
      id: seq,
      role: role as CoreMessage['role'],
      contentType: 'text',
      text,
      provenance,
    })
  }
  // `summary` 是 content 块数组（[{type:'text', text}]），不是字符串。
  const summaryField = data.summary
  const summary =
    typeof summaryField === 'string'
      ? summaryField
      : textOf({
          data: {
            content: Array.isArray(summaryField)
              ? summaryField
              : (summaryField?.message?.content ?? summaryField?.content),
          },
        })
  const violations = quoteFidelityViolations(messages, ids, summary)
  // 修正口径的对照数据：只保留「real 分类 + 长度 <= 500 的短消息」——即最像
  // 「用户当轮亲口说的短指令」的那一类，看看残余命中还剩多少。
  const strictIds: string[] = []
  for (const message of messages) {
    if (message.role !== 'user') continue
    const covered = bySeq.get(message.id)
    if (covered === undefined) continue
    if (classifySurfaceEvent(covered) !== 'real') continue
    if ((message.text ?? '').trim().length > 500) continue
    strictIds.push(message.id)
  }
  const strictViolations = quoteFidelityViolations(messages, strictIds, summary)
  const violationClasses: Record<string, number> = {}
  const missing = violations.flatMap((violation) => {
    const covered = bySeq.get(violation.messageId)
    const className = covered === undefined ? 'unknown' : classifySurfaceEvent(covered)
    violationClasses[className] = (violationClasses[className] ?? 0) + 1
    return violation.missing.map((fragment) => ({
      messageId: violation.messageId,
      className,
      snippet: fragment.replace(/\s+/g, ' ').slice(0, 220),
    }))
  })
  rows.push({
    compactionId: String(data.compactionId ?? ''),
    shadowed: shadowedSeqs.length,
    userMessages: messages.filter((message) => message.role === 'user').length,
    violations: violations.length,
    violationClasses,
    userByProvenance,
    strictCandidateMessages: strictIds.length,
    strictViolations: strictViolations.length,
    strictMissing: strictViolations.flatMap((violation) =>
      violation.missing.map((fragment) => ({
        messageId: violation.messageId,
        snippet: fragment.replace(/\s+/g, ' ').slice(0, 220),
      })),
    ),
    missing,
    summaryHead: summary.replace(/\s+/g, ' ').slice(0, 220),
  })
}

const observed = rows.length
const flagged = rows.filter((row) => row.violations > 0).length
const classTotals: Record<string, number> = {}
for (const row of rows) {
  for (const [name, count] of Object.entries(row.violationClasses)) {
    classTotals[name] = (classTotals[name] ?? 0) + count
  }
}
/** AC-9.5：来源标签分布合计，与有标签链的误报率分开设账。 */
const provenanceTotals: Record<string, number> = {}
for (const row of rows) {
  for (const [name, count] of Object.entries(row.userByProvenance)) {
    provenanceTotals[name] = (provenanceTotals[name] ?? 0) + count
  }
}
const untaggedUser = provenanceTotals['undefined'] ?? 0
const outJson = '<DSH>/_bc-src/case/5-误报率明细-20261027.json'
writeFileSync(
  outJson,
  JSON.stringify(
    { session: SESSION, observed, flagged, classTotals, provenanceTotals, untaggedUser, rows },
    null,
    2,
  ),
  'utf8',
)
console.log('观测摘要条数:', observed)
console.log('命中（门会报）条数:', flagged)
console.log('命中率（按条）:', observed === 0 ? 'n/a' : ((flagged / observed) * 100).toFixed(1) + '%')
console.log('违规消息按宿主分类:', JSON.stringify(classTotals))
console.log('范围内 user 消息按来源分布:', JSON.stringify(provenanceTotals))
console.log(
  '  [AC-9.5] 其中无标签（保真门跳过检查）:', untaggedUser,
  '条 —— 单独设账，禁止混进有标签链的误报率',
)
console.log('明细 JSON:', outJson)
console.log('逐条明细:')
for (const row of rows) {
  console.log('---')
  console.log('compactionId:', row.compactionId)
  console.log(
    '遮蔽事件:', row.shadowed,
    '其中 user:', row.userMessages,
    '违规条数:', row.violations,
    '按类:', JSON.stringify(row.violationClasses),
  )
  console.log('  user 来源分布:', JSON.stringify(row.userByProvenance))
  console.log('摘要开头:', row.summaryHead)
  console.log(
    '  修正口径（real + <=500 字）: 候选', row.strictCandidateMessages,
    '条，残余违规', row.strictViolations, '条',
  )
  for (const item of row.strictMissing.slice(0, 6)) {
    console.log('  残余[' + item.messageId + ']:', item.snippet)
  }
  for (const item of row.missing.slice(0, 6)) {
    console.log('  缺失[' + item.messageId + '/' + item.className + ']:', item.snippet)
  }
  if (row.missing.length > 6) console.log('  … 另有', row.missing.length - 6, '条')
}
