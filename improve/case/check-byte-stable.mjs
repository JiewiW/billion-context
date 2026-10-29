/**
 * AC-10.1 的客观信号：默认构建产物是否与入库快照一致。
 *
 * 为什么不能直接用 `tests/surface-config.test.ts` 那条用例判：
 * Windows 上 `core.autocrlf` 会把 `fixtures/*.txt` 检出成 CRLF，而构建产物输出 LF，
 * 那条用例做 `strictEqual` 逐字节比较，于是恒失败——这不是内容漂移，是换行符口径差异。
 * 本脚本把两边归一化成 LF 再比，并同时打印 raw 与 normalized 两种结果。
 *
 * 用法（cwd 必须是 acpk 根目录，否则 tsx 解析 src 内部的 `./x.js` 会失败）：
 *   cd <DSH>/_bc-src/acpk && node --import tsx ../case/check-byte-stable.mjs
 *
 * 正信号：末尾打印 `BYTE_STABLE_OK`，即三条 fixture 全部 `normalizedEqual: true`。
 * `rawEqual: false` 且 `fixtureHasCRLF: true` 是 Windows 上的预期现象，不算失败。
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const ACPK_ROOT = '<DSH>/_bc-src/acpk'
const {
  buildCompressSystemPrompt,
  buildCompressTextSystemPrompt,
  buildCompressHybridSystemPrompt,
} = await import(pathToFileURL(`${ACPK_ROOT}/src/index.ts`).href)

const readFixture = (name) => readFileSync(`${ACPK_ROOT}/tests/fixtures/${name}`, 'utf8')
const normalize = (text) => text.replace(/\r\n/g, '\n')

const pairs = [
  ['prompt-function-default.txt', buildCompressSystemPrompt()],
  ['prompt-text-default.txt', buildCompressTextSystemPrompt()],
  ['prompt-hybrid-default.txt', buildCompressHybridSystemPrompt()],
]

let diffCount = 0
for (const [name, actual] of pairs) {
  const fixture = readFixture(name)
  const normalizedEqual = normalize(actual) === normalize(fixture)
  if (!normalizedEqual) diffCount += 1
  console.log(
    JSON.stringify({
      fixture: name,
      rawEqual: actual === fixture,
      normalizedEqual,
      fixtureHasCRLF: fixture.includes('\r\n'),
      actualHasCRLF: actual.includes('\r\n'),
    }),
  )
}
console.log(diffCount === 0 ? 'BYTE_STABLE_OK' : 'BYTE_STABLE_DIFF')
