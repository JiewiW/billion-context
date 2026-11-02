/**
 * TASK-7 / TASK-8 —— 来源标签与材料识别。
 *
 * 两件事：
 *   AC-7.1 七类来源的映射，每类一条证据（可读 alias = 宿主怎么写的这一行）；
 *   AC-8.1 材料识别的正负样本 —— 判据**只看文本**，不看有没有发生粘贴事件。
 *
 * 材料识别不是安全边界：判错只影响保真门用哪档口径（TASK-9），消息会不会被
 * 移走由内核 `prune.ts` 的 RL-4 保护名单兜底。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isMaterialUserText, provenanceOfEvent } from '../src/messages.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { MessageProvenance } from 'acp-kernel'

/** 一条 user/message 事件（单元级，不进真实会话）。 */
function userEvent(source: Record<string, unknown> | undefined, text: string): SessionEvent {
  return {
    type: 'user/message',
    seq: 1,
    data: { source, content: [{ type: 'text', text }] },
  } as unknown as SessionEvent
}

// ── AC-7.1 七类映射，每类一行可读 alias ──────────────────────────────────────

test('AC-7.1 七类来源映射', () => {
  const rows: Array<[string, Record<string, unknown> | undefined, string, MessageProvenance]> = [
    ['用户本人这一轮', { kind: 'user' }, '继续', 'user-turn'],
    ['宿主策略：AGENTS.md 注入', { kind: 'agent-instructions' }, '# 项目规则\n必须遵守。', 'host-policy'],
    ['宿主策略：技能目录', { kind: 'plugin:dsh-tool-skill' }, '<available_skills>…</available_skills>', 'host-policy'],
    ['引擎元数据：nudge 回显', { kind: 'plugin:acp-nudge' }, '上下文已用 78%。', 'engine-metadata'],
    ['宿主内容：运行时上下文快照', { kind: 'runtime-context' }, 'Current runtime context …', 'host-content'],
    ['子代理转述', { kind: 'subagent-report' }, '子代理回报：已完成。', 'relay'],
    ['压缩检查点', { plugin: 'compact', compactionId: 'c1' }, '已压缩摘要…', 'checkpoint'],
  ]
  for (const [alias, source, text, expected] of rows) {
    assert.equal(
      provenanceOfEvent(userEvent(source, text), text),
      expected,
      `来源映射不符：${alias}`,
    )
  }
})

test('AC-7.1 developer/message → engine-metadata（不参与用户原话判定）', () => {
  const event = { type: 'developer/message', seq: 2, data: {} } as unknown as SessionEvent
  assert.equal(provenanceOfEvent(event, 'tool-registry diff'), 'engine-metadata')
})

// ── AC-8.1 材料识别：正样本 ─────────────────────────────────────────────────

const LOG_PASTE = [
  '2026-10-18T07:22:39.789Z INFO  launcher: precheck start',
  '2026-10-18T07:22:39.790Z INFO  launcher: easytier-core present',
  '2026-10-18T07:22:39.791Z INFO  launcher: SPT.Launcher present',
  '2026-10-18T07:22:40.120Z WARN  launcher: old process not running',
  '2026-10-18T07:22:41.004Z INFO  launcher: starting EasyTier pid=49648',
  '2026-10-18T07:22:42.310Z ERROR CORE: failed to create instance',
  '2026-10-18T07:22:42.311Z ERROR CORE: unsupported core manual connector URL',
  '2026-10-18T07:22:42.312Z INFO  launcher: process died, see run.log.err',
  '2026-10-18T07:22:43.000Z INFO  launcher: cleanup done',
  '2026-10-18T07:22:43.001Z INFO  launcher: exit code 1',
].join('\n')

const SHELL_PASTE = [
  'PS <HOME>> Get-NetFirewallRule -DisplayGroup "EasyTier"',
  'Name        Direction        Action        Enabled',
  '----        ---------        ------        -------',
  '{80f64fff-3af1-4bcd-ba67-85cdc4f7c9e8}   Inbound   Allow   True',
  '{33ad57f0-76bb-4031-8b60-06e5b105df0a}   Inbound   Allow   True',
  '{3818c51b-267b-40c5-90d7-99464a2a3302}   Inbound   Allow   True',
  'PS <HOME>> Get-Content C:\\EasyTier\\relay.log -Tail 30',
  "error: unexpected argument '--vpn-ip' found",
  "  tip: a similar argument exists: '--vpn-portal'",
  'Usage: easytier-core.exe --network-name <NETWORK_NAME>',
  "For more information, try '--help'.",
].join('\n')

const JSON_PASTE = [
  '{',
  '  "taskId": "8bae5da5-15ee-4933-b1c3-b9111e9be9bb",',
  '  "phase": "PAUSED",',
  '  "verification": "unverified",',
  '  "control": {',
  '    "mode": "paused",',
  '    "pendingApprovalIds": [],',
  '    "budgetBlocked": false,',
  '    "recovering": true,',
  '    "outcomeUnknown": false',
  '  },',
  '  "workerId": "fusion-worker-08c87145-91d5-47cf-b7b5-462e6aab2345",',
  '  "modelCalls": 337,',
  '  "cacheKeepaliveCalls": 12,',
  '  "compactionCalls": 3,',
  '  "unfinishedEffects": [],',
  '  "actualBilledUsd": null,',
  '  "apiEquivalentUsd": null,',
  '  "notes": "以上为工具原始输出，未做任何裁剪或改写",',
  '}',
].join('\n')

const MARKDOWN_PASTE = [
  '【目标文档】',
  '# 用户登录模块技术说明 v1',
  '',
  '## 1. 概述',
  '',
  '登录模块负责校验用户凭据并签发会话令牌。本文描述接口契约与错误处理。',
  '',
  '## 2. 接口',
  '',
  '- POST /v1/login：入参 { username, password }，返回 { token, expiresAt }',
  '- POST /v1/logout：使当前令牌失效，返回 204',
  '- GET  /v1/me：返回当前用户信息，未登录返回 401',
  '',
  '## 3. 错误码',
  '',
  '| code | http | 含义 |',
  '| ---- | ---- | ---- |',
  '| 1001 | 400  | 参数缺失 |',
  '| 1002 | 401  | 凭据错误 |',
  '| 1003 | 429  | 频次超限 |',
  '',
  '## 4. 令牌',
  '',
  '访问令牌有效期 2 小时，刷新令牌 7 天。续期走 /v1/refresh，入参 { refreshToken }。',
  '',
  '## 5. 限流',
  '',
  '- 同一 IP 每分钟最多 30 次登录尝试',
  '- 同一账号连续 5 次失败后锁定 15 分钟',
  '- 刷新接口单独计数，每分钟最多 60 次',
  '',
  '## 6. 备注',
  '',
  '以上为接口当前实现的描述，不含历史版本差异。',
].join('\n')

test('AC-8.1 正样本：粘贴的日志 / 终端输出 / JSON / 文档都判成材料', () => {
  for (const [alias, text] of [
    ['带时间戳的日志', LOG_PASTE],
    ['PowerShell 会话与报错', SHELL_PASTE],
    ['工具输出的 JSON', JSON_PASTE],
    ['Markdown 文档', MARKDOWN_PASTE],
  ] as Array<[string, string]>) {
    assert.equal(isMaterialUserText(text), true, `应判为材料却没判：${alias}`)
  }
})

test('AC-8.1 材料消息的来源标签是 user-material', () => {
  assert.equal(
    provenanceOfEvent(userEvent({ kind: 'user' }, LOG_PASTE), LOG_PASTE),
    'user-material',
  )
})

// ── AC-8.1 材料识别：负样本 ─────────────────────────────────────────────────

/** 长指令清单：排版像材料，但开头就是用户在下命令（首行含"禁止/请"）。 */
const INSTRUCTION_LIST = [
  '只建卡，禁止 run、禁止执行任何卡片。请调用 task_board_create 工具依次创建 2 张探针任务卡（标题都含 S4PROBE-DELETE，验完即删），全部留在 todo 列，不要执行。',
  '',
  '【先建卡1】',
  '- title：【1/2】S4PROBE-DELETE 串行链首步',
  '- tags：[{"name":"chain:s4probe-del"},{"name":"seq:1"}]',
  '- description（首行必须原样）：串行链 s4probe-del 第 1/2 步；无前置卡；本卡完成前，第 2/2 步及以后禁止开始。',
  '- prompt：# 【1/2】S4PROBE-DELETE 串行链首步',
  '',
  '## 上下文交接',
  '- 前置卡：无（链首）。完成后回报产物路径，供后继卡执行者核对。',
  '',
  '## 执行步骤',
  '在 D:\\dsh\\logs\\s4-gate-repo 目录新建文件 gate-step1.txt，内容为 step1-done，然后回报。',
  '两张卡都建完后，用 task_board_get 逐张回读，向我报告：每张卡的 id、status、tags、parentId、depth。',
  '不要 run 任何卡，也不要改动任何既有文件，报告里必须逐项列出上述字段。',
].join('\n')

/** 首尾都是硬约束的长任务书：开头写明"严格按序"。 */
const LONG_BRIEF =
  '目标：把 D:\\dsh\\dsh-doc-review 插件从"全局常驻 doc_review 工具"改造为"用户手动执行 /doc-review 斜杠指令后，doc_review 仅在当前 agent 会话可见并启动审阅"，全部验收通过后发布到 GitHub。阶段索引（严格按序）：S1 机制复核 → S2 插件改造 → S3 单测 → S4 overlay 冒烟 → S5 版本/副本/文档 → S6 GitHub 发布。\n\n' +
  '【高危禁令（违反即任务失败）】\n' +
  '- 禁止修改、补丁、重打包 D:\\dsh\\node_modules 下任何 @deepseek-ai/* 内核包；它们只作为 API 事实源只读查阅。\n' +
  '- 禁止占用、重启或改动 3080 端口上正在运行的 DSH 实例；全部动态验证只允许以 overlay 方式进行。\n' +
  '- 禁止用"工具全局注册 + guard 拒绝调用"作为唯一可见性手段：guard 不阻止 schema 下发。\n' +
  '- 每个阶段必须先写验收信号再改代码，验收信号必须可复算、可证伪，不得写成主观判断。\n' +
  '- 交付说明必须逐条对应阶段索引，缺一条即判定本阶段未完成。\n' +
  '- 所有改动必须留在工作区，禁止在临时目录里改完就丢。\n' +
  '- 阶段之间不得跳序，S3 未全绿不得进入 S4。\n'

/** 长，但通篇是散文叙述（没有结构化排版）。 */
const PROSE = [
  '我把这两天的排查过程完整讲一遍，你帮我看看哪一步走岔了。',
  '最开始是压缩工具报 ref 找不到，我以为是会话升级把引用号冲掉了，就去翻会话文件，',
  '发现文件里每追加一次就写一个独立的压缩帧，用单帧解压只能解出开头那一百多字节，',
  '看起来像会话是空的，其实后面还有上万帧。换成按帧扫描之后数据全出来了，',
  '于是又去对来源分布，发现用户角色的消息里九成不是用户本人说的，是宿主注入的，',
  '这一层的判定如果只看角色就会把注入行当成用户原话，门自然就全查错了。',
  '所以真正要改的是先把来源分清，再决定门查谁、保护谁，而不是继续往门上加规则。',
  '顺带一提，这个结论只在当前这条链路上成立，别的宿主没有来源信息就判不出来。',
].join('\n')

test('AC-8.1 负样本：短指令 / 长指令清单 / 长任务书 / 散文 / 单行报错 都不是材料', () => {
  for (const [alias, text] of [
    ['短指令', '必须用 pnpm 安装依赖，不要用 npm。'],
    ['长指令清单（开头在下命令）', INSTRUCTION_LIST],
    ['长任务书（开头写明严格按序）', LONG_BRIEF],
    ['长散文（无结构化排版）', PROSE],
    ['单行长报错（行数不够）', 'Error: [Compression FAILED: Requested range(s) cannot be anchored ' + 'x'.repeat(600)],
  ] as Array<[string, string]>) {
    assert.equal(isMaterialUserText(text), false, `不该判成材料却判了：${alias}`)
  }
})

test('AC-8.1 判据只看文本：同一段文本不因"来自粘贴"与否而改变判定', () => {
  // 没有粘贴事件可查 —— 函数签名里就没有会话/事件之外的信息。文本相同 → 结果相同。
  assert.equal(isMaterialUserText(LOG_PASTE), isMaterialUserText(LOG_PASTE + ''))
})

test('AC-8.1 长度门槛：低于 MATERIAL_MIN_CHARS 一律不是材料', () => {
  const short = LOG_PASTE.split('\n').slice(0, 4).join('\n')
  assert.ok(short.length < 500)
  assert.equal(isMaterialUserText(short), false)
})
