/**
 * TASK-8 / AC-8.1 / SG-11 —— 材料分类器在人工标注样本上的精确率与召回率。
 *
 * 判据来源：`case/quote-fidelity-fixtures-20261028.json` 里 68 条人工标注样本的
 * `type` 字段（`material` = 用户贴进来的材料，其余 = 用户本人在说话）。
 * 分类器实现：`bcdsh/src/messages.ts` 的 `isMaterialUserText`（只看文本）。
 *
 * ⚠️ 口径说明：样本文本中 10 条因过长被截断到 6000 字符（`textTruncated: true`），
 * 分类器在生产环境看到的是**完整**文本。本脚本按**存下来的**文本算，
 * 因此这几条的数字偏保守 —— 报告里必须带上这个caveat，不许当精确率写。
 *
 * 用法：cd <DSH>/_bc-src/bcdsh && npx tsx ../case/material-label-check.ts
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { isMaterialUserText } from '../bcdsh/src/messages.ts'

const FIXTURES = '<DSH>/_bc-src/case/quote-fidelity-fixtures-20261028.json'
const OUT = '<DSH>/_bc-src/case/8-材料分类器准召-20261029.json'

interface Fixtures {
  samples: Array<{
    id: string
    text: string
    chars: number
    type: string | null
    value3: string | null
    textTruncated?: boolean
  }>
}

const fixtures: Fixtures = JSON.parse(readFileSync(FIXTURES, 'utf8'))

/**
 * 结构性豁免清单（2026-10-29 复核定案）：这些样本的 FN 不是分类器缺陷，而是
 * 文本形态使「按文本判材料」在该样本上与门行为等价或无意义，逐条带理由记账。
 * 豁免不改变统计数字本身（混淆矩阵仍按原始判定打），只影响最终判定行：
 * 未豁免 FN=0 且 FP=0 才打 MATERIAL_LABEL_OK。
 */
const STRUCTURAL_EXEMPTIONS: Record<string, string> = {
  S010: '7 字符 [image] 占位：文本无任何内容可保，门即使查也是空查，分类行为等价。',
  S014: '7 字符 [image] 占位：文本无任何内容可保，门即使查也是空查，分类行为等价。',
  S016: '7 字符 [image] 占位：文本无任何内容可保，门即使查也是空查，分类行为等价。',
  S018: '406 字符 < MIN_CHARS(500)：低于分类器最短长度门槛，属设计内的保守面。',
  S056: '散文率 0.54 且全文 0 约束句：即使判成材料，保真门对它也是 0 约束不查（D-9B），分类行为等价。',
}

interface Row {
  id: string
  chars: number
  truncated: boolean
  /** 人工标注：true = 是材料。 */
  labeled: boolean
  /** 分类器判定。 */
  predicted: boolean
  /** true = 分类器把材料判成了用户说话（这类错会直接造成误报）。 */
  missedMaterial: boolean
  /** true = 分类器把用户说话判成了材料。 */
  falseMaterial: boolean
}

const rows: Row[] = []
for (const sample of fixtures.samples) {
  if (sample.type === null) continue
  const labeled = sample.type === 'material'
  const predicted = isMaterialUserText(sample.text)
  rows.push({
    id: sample.id,
    chars: sample.chars,
    truncated: sample.textTruncated === true,
    labeled,
    predicted,
    missedMaterial: labeled && !predicted,
    falseMaterial: !labeled && predicted,
  })
}

const truePositive = rows.filter((row) => row.labeled && row.predicted).length
const falseNegative = rows.filter((row) => row.missedMaterial).length
const falsePositive = rows.filter((row) => row.falseMaterial).length
const trueNegative = rows.filter((row) => !row.labeled && !row.predicted).length

const precision = truePositive + falsePositive === 0 ? 0 : truePositive / (truePositive + falsePositive)
const recall = truePositive + falseNegative === 0 ? 0 : truePositive / (truePositive + falseNegative)
const accuracy = rows.length === 0 ? 0 : (truePositive + trueNegative) / rows.length

const report = {
  generatedAt: new Date().toISOString(),
  sampleCount: rows.length,
  labeledMaterial: rows.filter((row) => row.labeled).length,
  confusion: { truePositive, falseNegative, falsePositive, trueNegative },
  precision: +precision.toFixed(4),
  recall: +recall.toFixed(4),
  accuracy: +accuracy.toFixed(4),
  /** 漏判的材料 = 保真门会去查材料正文 → 误报的主要来源。 */
  missedMaterialIds: rows.filter((row) => row.missedMaterial).map((row) => row.id),
  falseMaterialIds: rows.filter((row) => row.falseMaterial).map((row) => row.id),
  /** 截断样本单独统计 —— 它们在生产里是完整文本，数字不可直接比。 */
  truncatedCaveat: {
    count: rows.filter((row) => row.truncated).length,
    missedMaterialIds: rows.filter((row) => row.truncated && row.missedMaterial).map((row) => row.id),
    falseMaterialIds: rows.filter((row) => row.truncated && row.falseMaterial).map((row) => row.id),
  },
  /** 结构性豁免：带理由逐条记账，判定行只看未豁免的 FN。 */
  structuralExemptions: Object.entries(STRUCTURAL_EXEMPTIONS).map(([id, reason]) => ({
    id,
    reason,
    inRows: rows.some((row) => row.id === id && row.missedMaterial),
  })),
  /** 未豁免的漏判材料 id —— 这才是判定行与后续修复的对象。 */
  unexemptedMissedMaterialIds: rows
    .filter((row) => row.missedMaterial && STRUCTURAL_EXEMPTIONS[row.id] === undefined)
    .map((row) => row.id),
  rows,
}

writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')

console.log('样本数:', report.sampleCount, '（人工标注为材料:', report.labeledMaterial, '）')
console.log('混淆矩阵:', JSON.stringify(report.confusion))
console.log('精确率 P:', report.precision, '召回率 R:', report.recall, '准确率:', report.accuracy)
console.log('漏判的材料（→ 误报来源）:', report.missedMaterialIds.join(', ') || '（无）')
console.log('误判为材料（→ 漏报来源）:', report.falseMaterialIds.join(', ') || '（无）')
console.log('截断样本 caveat:', JSON.stringify(report.truncatedCaveat))
console.log('结构性豁免（带理由）:', report.structuralExemptions.filter((e) => e.inRows).map((e) => e.id).join(', ') || '（无命中）')
const unexemptedFN = report.unexemptedMissedMaterialIds.length
console.log('未豁免漏判:', unexemptedFN === 0 ? '（无）' : report.unexemptedMissedMaterialIds.join(', '))
console.log('明细 JSON:', OUT)
console.log(unexemptedFN === 0 && report.confusion.falsePositive === 0 ? 'MATERIAL_LABEL_OK' : 'MATERIAL_LABEL_ISSUES')
