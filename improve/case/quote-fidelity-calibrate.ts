/**
 * TASK-9 / AC-9.1 + AC-9.2 —— 在 TASK-11 的标注样本上标定 θ 与 T_high。
 *
 * 用例构造（全部确定性，可复算）：
 *   - `faithful` 摘要：把该条的**约束句逐字**放进摘要（= 合格的摘要）→ 期望「不报」；
 *   - `lossy`   摘要：一句与原文无关的通用套话（= 把约束整条丢掉的摘要）→
 *                    value3 为 instruction/acceptance 时期望「报」，为 none 时期望「不报」。
 *
 * 判定走**生产代码同一条**路径（`quoteFidelityViolations`），本脚本只负责造用例与扫阈值 ——
 * 不另写一套判定逻辑（RL-11）。阈值扫描用 `coverageOf`（生产代码导出的覆盖率口径）。
 *
 * 用法：cd <DSH>/_bc-src/bcdsh && npx tsx ../case/quote-fidelity-calibrate.ts
 */

import { readFileSync, writeFileSync } from 'node:fs'
import {
  constraintSentencesOf,
  importanceOf,
  quoteCoverageOf,
  quoteFidelityViolations,
  quoteIdentityTokensOf,
  quoteKeywordsOf,
  quoteOuterSentenceOf,
  quoteTierOf,
} from '../acpk/src/compress.js'
import {
  QUOTE_LONG_CHARS,
  QUOTE_T_HIGH,
  QUOTE_THETA_LOOSE,
  QUOTE_THETA_OUTER,
  QUOTE_THETA_STRICT,
} from '../acpk/src/compression-rules.js'
import type { CoreMessage, MessageProvenance } from '../acpk/src/types.js'
import { isMaterialUserText } from '../bcdsh/src/messages.ts'

const FIXTURES = '<DSH>/_bc-src/case/quote-fidelity-fixtures-20261028.json'
const OUT = '<DSH>/_bc-src/case/9-阈值标定-20261029.json'

/** 与样本无关的通用套话：模拟"约束被整条丢掉"的摘要。 */
const FILLER =
  '本段主要围绕任务推进展开，用户补充了若干背景信息，双方确认了下一步方向，具体措辞从略，按既有约定继续执行即可。'

interface Fixtures {
  samples: Array<{
    id: string
    text: string
    chars: number
    bucket: string
    value3: string | null
    type: string | null
    textTruncated?: boolean
  }>
  missFixtures: Array<{
    id: string
    fromSample: string
    faithfulSummary: string
    lossySummary: string
    expected: string
  }>
}

interface Case {
  caseId: string
  sampleId: string
  kind: 'faithful' | 'lossy' | 'miss-fixture'
  value3: string
  type: string
  chars: number
  provenance: MessageProvenance
  tier: string
  importance: number
  /** 该条最弱那条约束句的关键词覆盖率（生产代码同一口径）。 */
  coverage: number
  /** 能不能被检测到硬约束句。false = 门不查这条（D-9B），与阈值无关。 */
  hasConstraint: boolean
  /**
   * faithful 摘要是否逐字保真：样本循环的 faithful 按构造逐字嵌入恒真；
   * miss-fixture 的手写摘要做机械核验（逐字包含每条门作用域约束句）。
   * 核验不过的进 fixtureParaphrase 账，不进 θ 带应过侧（转述文本会拉低应过侧覆盖率）。
   */
  verbatimFaithful: boolean
  expected: 'flag' | 'pass'
  flagged: boolean
}

const fixtures: Fixtures = JSON.parse(readFileSync(FIXTURES, 'utf8'))

/**
 * 该条的最弱约束句覆盖率 —— 标定扫的信号量。
 *
 * 与生产代码同一口径：严档按**每条约束句**分别算，取最小值
 * （一条被丢掉就足以让这条消息不合格，所以看最弱的那条）。
 * 长材料按「外面那句」的约束句算。
 */
function coverageOf(text: string, provenance: MessageProvenance, summary: string): number {
  const summaryTokens = quoteKeywordsOf(summary)
  let constraints: string[]
  if (provenance === 'user-material' && text.length > QUOTE_LONG_CHARS) {
    const outerConstraints = constraintSentencesOf(quoteOuterSentenceOf(text))
    if (outerConstraints.length === 0) return 1
    constraints = outerConstraints
  } else {
    constraints = constraintSentencesOf(text)
    if (constraints.length === 0) return 1
  }
  let worst = 1
  for (const sentence of constraints) {
    const coverage = quoteCoverageOf(quoteKeywordsOf(sentence), summaryTokens)
    if (coverage < worst) worst = coverage
  }
  return worst
}

/**
 * 门实际约束的硬约束句集合 —— 判定/标定/记账三方共用的作用域口径（RL-11）。
 * user-material 长文：D-9E 把外层约束句当全条约束；其余按全文本体。
 */
function gateScopedConstraints(text: string, provenance: MessageProvenance): string[] {
  return provenance === 'user-material' && text.length > QUOTE_LONG_CHARS
    ? constraintSentencesOf(quoteOuterSentenceOf(text))
    : constraintSentencesOf(text)
}

function buildCase(
  id: string,
  sampleId: string,
  kind: Case['kind'],
  value3: string,
  type: string,
  chars: number,
  provenance: MessageProvenance,
  text: string,
  summary: string,
  expected: 'flag' | 'pass',
): Case {
  const message: CoreMessage = {
    id,
    role: 'user',
    contentType: 'text',
    text,
    provenance,
  }
  return {
    caseId: `${id}:${kind}`,
    sampleId,
    kind,
    value3,
    type,
    chars,
    provenance,
    tier: quoteTierOf(text),
    importance: +importanceOf(text).toFixed(4),
    coverage: +coverageOf(text, provenance, summary).toFixed(4),
    hasConstraint: gateScopedConstraints(text, provenance).length > 0,
    verbatimFaithful:
      kind === 'faithful' ||
      (kind === 'miss-fixture' &&
        gateScopedConstraints(text, provenance).every((sentence) => summary.includes(sentence))),
    expected,
    flagged: quoteFidelityViolations([message], [message.id], summary).length > 0,
  }
}

const cases: Case[] = []

for (const sample of fixtures.samples) {
  if (sample.value3 === null || sample.type === null) continue
  // 来源标签走宿主的真实分类器（TASK-8），不是这里另判一套。
  const provenance: MessageProvenance = isMaterialUserText(sample.text)
    ? 'user-material'
    : 'user-turn'
  const gateConstraints = gateScopedConstraints(sample.text, provenance)
  const identity = quoteIdentityTokensOf(sample.text)
  const identityTag = identity.length > 0 ? identity.join('、') : sample.id
  const faithfulBody = `用户原话（逐字保留）：${gateConstraints.join(' ')}。`
  // 保真摘要（AC-9.4 外层保真契约）：约束句逐字 + 材料标识 token，两件都要 ——
  // 门对长材料查的就是这两件事，外层没有约束句时门仍查标识，所以材料 faithful
  // 无论如何都要带标识（缺了会被门正确拒绝，不能算「合格摘要」）。
  const faithful =
    provenance === 'user-material'
      ? `${faithfulBody}材料标识：${identityTag}。${FILLER}`
      : gateConstraints.length === 0
        ? FILLER
        : `${faithfulBody}${FILLER}`
  // lossy 摘要：材料类 = 标识 token 还在、外层约束整条丢掉 —— 门此时查的就是
  // 外层保真（θ_outer），这是 θ 带要分开的两侧之一；普通发言类 = 纯套话。
  const lossySummary =
    provenance === 'user-material' ? `这段材料（${identityTag}）的概要：${FILLER}` : FILLER
  for (const [kind, summary] of [
    ['faithful', faithful],
    ['lossy', lossySummary],
  ] as Array<['faithful' | 'lossy', string]>) {
    cases.push(
      buildCase(
        sample.id,
        sample.id,
        kind,
        sample.value3,
        sample.type,
        sample.chars,
        provenance,
        sample.text,
        summary,
        // lossy 摘要下：有硬约束的必须报（漏报 = 真危险），没有硬约束的不许报（误报）。
        kind === 'faithful' || sample.value3 === 'none' ? 'pass' : 'flag',
      ),
    )
  }
}

// 手写的漏报样例（AC-11.2）也进同一套账。
const sampleById = new Map(fixtures.samples.map((sample) => [sample.id, sample]))
for (const miss of fixtures.missFixtures) {
  const source = sampleById.get(miss.fromSample)
  if (source === undefined) continue
  const provenance: MessageProvenance = isMaterialUserText(source.text)
    ? 'user-material'
    : 'user-turn'
  for (const [kind, summary] of [
    ['faithful', miss.faithfulSummary],
    ['lossy', miss.lossySummary],
  ] as Array<['faithful' | 'lossy', string]>) {
    cases.push(
      buildCase(
        miss.id,
        miss.fromSample,
        'miss-fixture',
        source.value3 ?? 'unknown',
        source.type ?? 'unknown',
        source.chars,
        provenance,
        source.text,
        summary,
        kind === 'faithful' ? 'pass' : 'flag',
      ),
    )
  }
}

function matrix(list: Case[]) {
  let tp = 0
  let fp = 0
  let tn = 0
  let fn = 0
  for (const item of list) {
    if (item.expected === 'flag' && item.flagged) tp += 1
    else if (item.expected === 'pass' && item.flagged) fp += 1
    else if (item.expected === 'pass' && !item.flagged) tn += 1
    else fn += 1
  }
  return { tp, fp, tn, fn }
}

/**
 * θ 扫描只在 lossy 用例上做：faithful 用例的覆盖率天然接近 1，混进来会把区间
 * 撑得毫无意义。真正要分开的是「丢了约束该不该报」。
 */
const lossy = cases.filter((item) => item.kind === 'lossy' || item.kind === 'miss-fixture')
const lossyWithExpectFlag = lossy.filter((item) => item.expected === 'flag')
const lossyWithExpectPass = lossy.filter((item) => item.expected === 'pass')

const maxFlagCoverage = lossyWithExpectFlag.length
  ? Math.max(...lossyWithExpectFlag.map((item) => item.coverage))
  : Number.NaN
const minPassCoverage = lossyWithExpectPass.length
  ? Math.min(...lossyWithExpectPass.map((item) => item.coverage))
  : Number.NaN

/**
 * 可调池 = θ 带两侧的口径。两侧都必须真的被 θ 约束：
 *   - 应报侧：标签确认有约束（instruction/acceptance）、门作用域内检测得到硬约束句、
 *     摘要按期望该报（lossy/miss-fixture 的 lossy 侧）。
 *   - 应过侧：保真性**可机械核验**的 faithful —— 样本循环的 faithful 按构造逐字嵌入；
 *     miss-fixture 的手写摘要须通过逐字包含核验（verbatimFaithful），核验不过的
 *     是夹具转述偏差（fixtureParaphrase 账），混进来会把应过侧覆盖率拉到 0.3x，
 *     θ 带就假阴性了。
 *   - value3=none 但检测到约束的不进池 —— 标注与祈使检测的固有分歧（D-9B 残留），
 *     不是 θ 能分开的（历史上它把区间撑成空集，SG-10 假阴性）。
 *   - 检测不到约束的（hasConstraint=false）不进池 —— 门根本不查（D-9B），
 *     单列 structuralMisses 设账。
 */
const tunable = [
  ...lossy.filter(
    (item) =>
      item.hasConstraint &&
      item.value3 !== 'none' &&
      (item.expected === 'flag' || item.verbatimFaithful),
  ),
  ...cases.filter((item) => item.kind === 'faithful' && item.hasConstraint && item.value3 !== 'none'),
]
const structuralMisses = lossy.filter((item) => !item.hasConstraint && item.expected === 'flag')
/** 夹具转述账：miss-fixture 的手写 faithful 摘要未逐字包含约束句（AC-5 逐字契约下门拒绝属正确行为）。 */
const fixtureParaphrase = cases.filter(
  (item) => item.kind === 'miss-fixture' && item.expected === 'pass' && !item.verbatimFaithful,
)
const looseFlag = tunable.filter((item) => item.expected === 'flag')
const loosePass = tunable.filter((item) => item.expected === 'pass')
const looseMaxFlag = looseFlag.length ? Math.max(...looseFlag.map((i) => i.coverage)) : Number.NaN
const looseMinPass = loosePass.length ? Math.min(...loosePass.map((i) => i.coverage)) : Number.NaN

/** D-9B 残留账：value3=none 但门检测到约束句的用例（标注分歧），单独记账不进 θ 带。 */
const d9bResidue = cases.filter((item) => item.value3 === 'none' && item.hasConstraint)
const tunableMatrix = matrix(tunable)

const hasConstraint = cases.filter((item) => item.value3 === 'instruction' || item.value3 === 'acceptance')
const noConstraint = cases.filter((item) => item.value3 === 'none')
const minConstraintImportance = hasConstraint.length
  ? Math.min(...hasConstraint.map((item) => item.importance))
  : Number.NaN
const maxNoneImportance = noConstraint.length
  ? Math.max(...noConstraint.map((item) => item.importance))
  : Number.NaN

const overall = matrix(cases)
const lossyMatrix = matrix(lossy)
const thetaBand =
  Number.isNaN(looseMaxFlag) || Number.isNaN(looseMinPass)
    ? null
    : looseMaxFlag < looseMinPass
      ? { low: +looseMaxFlag.toFixed(4), high: +looseMinPass.toFixed(4) }
      : null
const importanceBand =
  Number.isNaN(minConstraintImportance) || Number.isNaN(maxNoneImportance)
    ? null
    : maxNoneImportance < minConstraintImportance
      ? { low: +maxNoneImportance.toFixed(4), high: +minConstraintImportance.toFixed(4) }
      : null
/** 生产 θ 是否落在带内（带非空时才有意义）。 */
const thetaInsideBand = thetaBand !== null && QUOTE_THETA_LOOSE > thetaBand.low

const report = {
  generatedAt: new Date().toISOString(),
  constants: {
    QUOTE_THETA_STRICT,
    QUOTE_THETA_LOOSE,
    QUOTE_THETA_OUTER,
    QUOTE_T_HIGH,
    QUOTE_LONG_CHARS,
  },
  caseCount: cases.length,
  byKind: cases.reduce<Record<string, number>>((acc, item) => {
    acc[item.kind] = (acc[item.kind] ?? 0) + 1
    return acc
  }, {}),
  byTier: cases.reduce<Record<string, number>>((acc, item) => {
    acc[item.tier] = (acc[item.tier] ?? 0) + 1
    return acc
  }, {}),
  byProvenance: cases.reduce<Record<string, number>>((acc, item) => {
    acc[item.provenance] = (acc[item.provenance] ?? 0) + 1
    return acc
  }, {}),
  confusion: { all: overall, lossyOnly: lossyMatrix, tunableOnly: tunableMatrix },
  d9bResidue: {
    note: 'value3=none 但门检测到硬约束句的用例：标注与祈使检测的固有分歧（D-9B 残留），单独记账，不进 θ 带两侧。',
    count: d9bResidue.length,
    caseIds: d9bResidue.map((item) => item.caseId),
  },
  fixtureParaphrase: {
    note: 'miss-fixture 手写 faithful 摘要未逐字包含约束句（转述）：AC-5 逐字契约下门拒绝属正确行为，AC-11.2 契约只覆盖 lossy 侧；单独记账，不进 θ 带应过侧。',
    count: fixtureParaphrase.length,
    caseIds: fixtureParaphrase.map((item) => item.caseId),
  },
  theta: {
    tunableCases: tunable.length,
    structuralMisses: structuralMisses.length,
    structuralMissIds: structuralMisses.map((item) => item.caseId),
    maxCoverageOfShouldFlag: +looseMaxFlag.toFixed(4),
    minCoverageOfShouldPass: +looseMinPass.toFixed(4),
    band: thetaBand,
    productionThetaInsideBand: thetaInsideBand,
    productionThetaNote:
      thetaBand === null
        ? 'θ 带为空（D-9B）。'
        : thetaInsideBand
          ? `θ_loose=${QUOTE_THETA_LOOSE} 在带内。`
          : `θ_loose=${QUOTE_THETA_LOOSE} 在带下缘外侧（带下限 ${thetaBand.low}，差 ${+(thetaBand.low - QUOTE_THETA_LOOSE).toFixed(4)}）：边缘用例（如 M04:lossy，覆盖率 ${+looseMaxFlag.toFixed(4)}）按现 θ 不由覆盖率命中，由强调句/逐字检查兜底与否以 FN 账为准。`,
    allLossy: {
      maxCoverageOfShouldFlag: +maxFlagCoverage.toFixed(4),
      minCoverageOfShouldPass: +minPassCoverage.toFixed(4),
    },
  },
  importance: {
    minOfInstructionLike: +minConstraintImportance.toFixed(4),
    maxOfNone: +maxNoneImportance.toFixed(4),
    band: importanceBand,
  },
  worst: {
    falsePositives: cases
      .filter((item) => item.expected === 'pass' && item.flagged)
      .map((item) => ({ caseId: item.caseId, value3: item.value3, type: item.type, tier: item.tier, coverage: item.coverage })),
    falseNegatives: cases
      .filter((item) => item.expected === 'flag' && !item.flagged)
      .map((item) => ({ caseId: item.caseId, value3: item.value3, type: item.type, tier: item.tier, coverage: item.coverage })),
  },
  cases: cases,
}
writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')

console.log('用例总数:', cases.length, JSON.stringify({
  byKind: report.byKind,
  byTier: report.byTier,
  byProvenance: report.byProvenance,
}))
console.log('混淆矩阵（全部）:', JSON.stringify(overall))
console.log('混淆矩阵（只看 lossy + 漏报样例）:', JSON.stringify(lossyMatrix))
console.log('混淆矩阵（可调池 = θ 带两侧口径）:', JSON.stringify(tunableMatrix))
console.log('D-9B 残留账（value3=none 但检测到约束）:', d9bResidue.length, JSON.stringify(d9bResidue.map((i) => i.caseId)))
console.log('夹具转述账（手写 faithful 非逐字，门拒绝属正确行为）:', fixtureParaphrase.length, JSON.stringify(fixtureParaphrase.map((i) => i.caseId)))
console.log('结构性漏报（检测不到硬约束句，门不查，θ 救不了）:',
  structuralMisses.length, JSON.stringify(structuralMisses.map((i) => i.caseId)))
console.log('θ 扫描（只看可调用例）:',
  '应报组最大覆盖率 =', +looseMaxFlag.toFixed(4),
  '｜ 应过组最小覆盖率 =', +looseMinPass.toFixed(4),
  '｜ 可行区间 =', thetaBand === null ? '空（走 D-9B）' : `(${thetaBand.low}, ${thetaBand.high}]`)
console.log('importance 扫描:',
  '指令组最小 =', +minConstraintImportance.toFixed(4),
  '｜ none 组最大 =', +maxNoneImportance.toFixed(4),
  '｜ 可行区间 =', importanceBand === null ? '空（走 D-9C）' : `(${importanceBand.low}, ${importanceBand.high}]`)
console.log('误报样例:', report.worst.falsePositives.length, '漏报样例:', report.worst.falseNegatives.length)
for (const item of report.worst.falsePositives.slice(0, 10)) console.log('  FP', JSON.stringify(item))
for (const item of report.worst.falseNegatives.slice(0, 10)) console.log('  FN', JSON.stringify(item))
console.log('阈值标定 JSON:', OUT)
console.log('AC-9.1（θ 区间）:', thetaBand === null ? '未分开 → 走 D-9B' : `分开 → (${thetaBand.low}, ${thetaBand.high}]`)
console.log('生产 θ 位置:', thetaBand === null ? '（带空）' : thetaInsideBand ? `θ_loose=${QUOTE_THETA_LOOSE} 在带内` : `θ_loose=${QUOTE_THETA_LOOSE} 在带下缘外侧，见 productionThetaNote`)
console.log(
  'AC-9.2（importance 区间）:',
  importanceBand === null
    ? '未分开 → 走 D-9C（档位不再靠 importance 区分）'
    : `分开 → (${importanceBand.low}, ${importanceBand.high}]`,
)
console.log(thetaBand === null ? 'CALIBRATION_FAIL' : 'CALIBRATION_OK')
