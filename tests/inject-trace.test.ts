/**
 * TASK-3 / 改进 5a —— 插桩护栏。
 *
 * 插桩本身是"纯观测"，所以这些用例守住五件事：
 *   1. 默认不写盘（插桩态只能显式开启，否则生产实例会默默写日志）；
 *   2. 同一事件只记一行（分类器被投影/保护扫描反复调用，不能一行变十行）；
 *   3. 字段口径与计划书样例逐字对齐，且每行可 JSON.parse（AC-3.1 的机器判据）；
 *   4. 插桩永不改变分类结果、永不抛错（观测不得影响压缩链）；
 *   5. 去重表触顶只逐出最老一批，绝不整表清空（宿主每步全量重扫，清空
 *      等于下一步把全部历史重记一遍）。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { classifyInjectedMessage, classifySurfaceEvent, traceSessionEvents } from '../src/messages.ts'
import {
  EVICT_BATCH,
  SEEN_CAP,
  TRACE_FP_CHARS,
  claimSplicedEvent,
  eventAlreadyTraced,
  messageAlreadyTraced,
  resetTraceSeen,
  traceEnabled,
  traceInjectedMessage,
  traceSurfaceEvent,
  traceTextOf,
} from '../src/inject-trace.ts'

function userEvent(seq: number | string, text: string, source: unknown = { kind: 'user' }) {
  return {
    seq,
    time: '',
    type: 'user/message',
    data: { role: 'user', content: [{ type: 'text', text }], source },
  } as never
}

function withTraceFile(run: (file: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'acp-trace-'))
  const file = join(dir, 'acp-inject-trace.jsonl')
  const prevFlag = process.env.DSH_ACP_INJECT_TRACE
  const prevFile = process.env.DSH_ACP_INJECT_TRACE_FILE
  process.env.DSH_ACP_INJECT_TRACE = '1'
  process.env.DSH_ACP_INJECT_TRACE_FILE = file
  resetTraceSeen()
  try {
    run(file)
  } finally {
    resetTraceSeen()
    if (prevFlag === undefined) delete process.env.DSH_ACP_INJECT_TRACE
    else process.env.DSH_ACP_INJECT_TRACE = prevFlag
    if (prevFile === undefined) delete process.env.DSH_ACP_INJECT_TRACE_FILE
    else process.env.DSH_ACP_INJECT_TRACE_FILE = prevFile
    rmSync(dir, { recursive: true, force: true })
  }
}

test('AC-3.1 开关：默认关闭，只有显式置位才采集', () => {
  assert.equal(traceEnabled({} as NodeJS.ProcessEnv), false, '未设置 = 关闭')
  assert.equal(traceEnabled({ DSH_ACP_INJECT_TRACE: '0' } as NodeJS.ProcessEnv), false)
  assert.equal(traceEnabled({ DSH_ACP_INJECT_TRACE: ' off ' } as NodeJS.ProcessEnv), false)
  assert.equal(traceEnabled({ DSH_ACP_INJECT_TRACE: 'FALSE' } as NodeJS.ProcessEnv), false)
  assert.equal(traceEnabled({ DSH_ACP_INJECT_TRACE: '1' } as NodeJS.ProcessEnv), true)
  assert.equal(traceEnabled({ DSH_ACP_INJECT_TRACE: 'on' } as NodeJS.ProcessEnv), true)
})

test('AC-3.1 关闭时一行都不写（默认态对生产实例零副作用）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acp-trace-off-'))
  const file = join(dir, 'acp-inject-trace.jsonl')
  delete process.env.DSH_ACP_INJECT_TRACE
  process.env.DSH_ACP_INJECT_TRACE_FILE = file
  resetTraceSeen()
  try {
    traceSessionEvents(fakeSession([userEvent(1, 'hello')]))
    assert.equal(existsSync(file), false, '关闭态不得创建日志文件')
  } finally {
    delete process.env.DSH_ACP_INJECT_TRACE_FILE
    rmSync(dir, { recursive: true, force: true })
  }
})

test('AC-3.1 同一事件只记一行，字段口径与计划书样例一致', () => {
  withTraceFile((file) => {
    const text = 'x'.repeat(TRACE_FP_CHARS) + '-tail-must-not-be-in-fingerprint'
    const event = userEvent(1234, text)
    // 宿主每个 step 都会扫一遍全量日志，同一事件被反复扫到是常态：
    // 只许记第一次。
    traceSessionEvents(fakeSession([event]))
    traceSessionEvents(fakeSession([event]))
    traceSessionEvents(fakeSession([event]))
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean)
    assert.equal(lines.length, 1, '同一 seq 只记一行')
    const line = JSON.parse(lines[0]!) as Record<string, unknown>
    for (const key of ['ts', 'seq', 'class', 'source', 'chars', 'fp120', 'trigger']) {
      assert.ok(key in line, `字段缺失: ${key}`)
    }
    assert.equal(line.seq, 1234)
    assert.equal(line.class, 'real')
    assert.equal(line.source, 'user')
    assert.equal(line.chars, text.length)
    assert.equal(line.fp120, text.slice(0, TRACE_FP_CHARS))
    assert.ok(!String(line.fp120).includes('tail'), 'fp120 只取前 120 字符')
    assert.equal(line.trigger, 'unknown', '分类点拿不到触发原因，按计划书填 unknown')
    assert.match(String(line.ts), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/)
  })
})

test('AC-3.1 不同事件各记一行，注入行按真实 class 落盘', () => {
  withTraceFile((file) => {
    traceSessionEvents(
      fakeSession([
        userEvent(1, 'real turn'),
        userEvent(2, 'AGENTS.md policy', { kind: 'plugin', plugin: 'agent-instructions' }),
        userEvent(3, 'snapshot', { kind: 'runtime-context' }),
      ]),
    )
    const record = readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((raw) => JSON.parse(raw) as { seq: number; class: string; source: string })
    assert.deepEqual(
      record.map((row) => [row.seq, row.class, row.source]),
      [
        [1, 'real', 'user'],
        [2, 'instruction', 'plugin:agent-instructions'],
        [3, 'real', 'runtime-context'],
      ],
    )
  })
})

test('插桩不改变分类结果：开/关两态逐事件一致', () => {
  const events = [
    userEvent(1, 'plain'),
    userEvent(2, 'policy', { kind: 'plugin', plugin: 'agent-instructions' }),
    userEvent(3, 'catalog marker <available_skills>'),
    userEvent(4, 'nudge', { kind: 'plugin', plugin: 'acp-nudge' }),
  ]
  delete process.env.DSH_ACP_INJECT_TRACE
  resetTraceSeen()
  const off = events.map((event) => classifySurfaceEvent(event))
  withTraceFile(() => {
    const on = events.map((event) => classifySurfaceEvent(event))
    assert.deepEqual(on, off, '插桩开关不得影响分类')
  })
})

test('traceTextOf 口径：字符串/块数组/tool-result 嵌套都按文本累加', () => {
  const flat = {
    seq: 1,
    type: 'tool/result',
    data: { message: { content: [{ type: 'text', text: 'abc' }] } },
  } as never
  assert.equal(traceTextOf(flat), 'abc')
  const nested = {
    seq: 2,
    type: 'tool/result',
    data: {
      message: {
        content: [
          { type: 'text', text: 'ab' },
          { type: 'tool-result', content: [{ type: 'text', text: 'cd' }] },
        ],
      },
    },
  } as never
  assert.equal(traceTextOf(nested), 'ab\ncd', '多块之间按投影口径用换行连接')
  const plain = { seq: 3, type: 'user/message', data: { content: 'xyz' } } as never
  assert.equal(traceTextOf(plain), 'xyz')
})

test('traceTextOf 口径：与投影用的 extractText 一致（reasoning 不计入）', () => {
  // reasoning 块带着 text 字段，但投影时 extractText 不取它 ——
  // 那些字根本不进模型上下文，插桩也不该算进去。
  const withReasoning = {
    seq: 4,
    type: 'assistant/message',
    data: {
      message: {
        content: [
          { type: 'reasoning', text: '模型的内心戏，不进上下文' },
          { type: 'text', text: '真正给模型看的回答' },
        ],
      },
    },
  } as never
  assert.equal(traceTextOf(withReasoning), '真正给模型看的回答')
})

test('观测失败必须静默：目标不可写时不抛错', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acp-trace-bad-'))
  const prevFlag = process.env.DSH_ACP_INJECT_TRACE
  const prevFile = process.env.DSH_ACP_INJECT_TRACE_FILE
  process.env.DSH_ACP_INJECT_TRACE = '1'
  // 指向一个已存在的目录：appendFileSync 会 EISDIR。
  process.env.DSH_ACP_INJECT_TRACE_FILE = dir
  resetTraceSeen()
  try {
    assert.doesNotThrow(() => {
      traceSurfaceEvent(userEvent(7, 'text'), 'real')
    })
  } finally {
    resetTraceSeen()
    if (prevFlag === undefined) delete process.env.DSH_ACP_INJECT_TRACE
    else process.env.DSH_ACP_INJECT_TRACE = prevFlag
    if (prevFile === undefined) delete process.env.DSH_ACP_INJECT_TRACE_FILE
    else process.env.DSH_ACP_INJECT_TRACE_FILE = prevFile
    rmSync(dir, { recursive: true, force: true })
  }
})

// ── TASK-3 补口：`agent/inbox/spliced` 通道 ─────────────────────────────────
// 插桩原先只挂在 `classifySurfaceEvent` 上，而那是 surface 事件的分类点；
// spliced 通道的 `data.inserted` 里装的是消息对象，不是事件，线上活采集
// 整条漏掉这个通道（5a 报告 §5.2 的未做项）。
//
// 补的时候必须解决一个坑：同一条消息会先出现在 spliced 通道（宿主插进
// inbox），随后又以 `user/message` 出现一次 —— 实测按 id 的匹配率 99.22%。
// 不做跨通道去重，"重复注入浪费量"这个指标会直接虚高一倍。

function splicedEvent(seq: number, inserted: unknown[]) {
  return {
    seq,
    time: '',
    type: 'agent/inbox/spliced',
    data: { target: 'next-turn', start: 0, inserted },
  } as never
}

function fakeSession(events: unknown[], id = 'test-session') {
  return { id, snapshotEvents: () => events } as never
}

function userTurnEvent(seq: number, id: string, text: string) {
  return {
    seq,
    time: '',
    type: 'user/message',
    data: { id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } },
  } as never
}

test('TASK-3 补口：spliced 通道插入的消息被记一行，字段口径与 surface 通道一致', () => {
  withTraceFile((file) => {
    traceSessionEvents(
      fakeSession([
        splicedEvent(7, [
          {
            id: 'm-1',
            role: 'user',
            content: [{ type: 'text', text: '真实用户输入' }],
            source: { kind: 'user' },
          },
        ]),
      ]),
    )
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean)
    assert.equal(lines.length, 1, '一条插入消息记一行')
    const line = JSON.parse(lines[0]!) as Record<string, unknown>
    for (const key of ['ts', 'seq', 'class', 'source', 'chars', 'fp120', 'trigger']) {
      assert.ok(key in line, `字段缺失: ${key}`)
    }
    assert.equal(line.seq, 7, 'seq 记承载它的事件 seq')
    assert.equal(line.class, 'real')
    assert.equal(line.source, 'user')
    assert.equal(line.chars, '真实用户输入'.length)
    assert.equal(line.fp120, '真实用户输入')
    assert.equal(line.trigger, 'unknown')
  })
})

test('TASK-3 补口：跨通道互斥 —— 同一条消息在两个通道各出现一次，只记一行', () => {
  withTraceFile((file) => {
    const text = '同一条消息'
    // 先走 spliced 通道
    traceSessionEvents(
      fakeSession([
        splicedEvent(7, [
          { id: 'same-id', role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } },
        ]),
      ]),
    )
    // 再走 surface 通道：同一个消息 id
    traceSessionEvents(fakeSession([userTurnEvent(9, 'same-id', text)]))
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean)
    assert.equal(lines.length, 1, '同一条消息不得记两遍 —— 否则浪费量虚高一倍')
  })
})

test('TASK-3 补口：surface 通道先记过之后，spliced 通道同样不重复记', () => {
  withTraceFile((file) => {
    const text = '同一条消息'
    traceSessionEvents(fakeSession([userTurnEvent(9, 'same-id-2', text)]))
    traceSessionEvents(
      fakeSession([
        splicedEvent(7, [
          {
            id: 'same-id-2',
            role: 'user',
            content: [{ type: 'text', text }],
            source: { kind: 'user' },
          },
        ]),
      ]),
    )
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean)
    assert.equal(lines.length, 1, '谁先被扫到谁记，后来的那条跳过')
  })
})

test('TASK-3 补口：不同 id 的两条消息各记一行，互不影响', () => {
  withTraceFile((file) => {
    traceSessionEvents(
      fakeSession([
        splicedEvent(7, [
          { id: 'a', role: 'user', content: [{ type: 'text', text: '甲' }], source: { kind: 'user' } },
        ]),
        splicedEvent(8, [
          { id: 'b', role: 'user', content: [{ type: 'text', text: '乙' }], source: { kind: 'user' } },
        ]),
      ]),
    )
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean)
    assert.equal(lines.length, 2)
  })
})

test('TASK-3 补口：只有删除没有插入的 spliced 事件不产生任何行', () => {
  withTraceFile((file) => {
    traceSessionEvents(
      fakeSession([
        {
          seq: 6,
          time: '',
          type: 'agent/inbox/spliced',
          data: { target: 'next-turn', start: 0, removedCount: 1, inserted: [] },
        } as never,
      ]),
    )
    const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : []
    assert.equal(lines.length, 0, '删除型事件没有内容，不该记')
  })
})

test('TASK-3 补口：spliced 消息的分类与 surface 通道同一套口径', () => {
  assert.equal(classifyInjectedMessage({ source: { kind: 'user' }, content: [] }), 'real')
  assert.equal(
    classifyInjectedMessage({ source: { kind: 'plugin', plugin: 'dsh-cot-anchor' }, content: [] }),
    'instruction',
  )
  assert.equal(
    classifyInjectedMessage({ source: { kind: 'plugin:dsh-cot-anchor' }, content: [] }),
    'instruction',
  )
  assert.equal(
    classifyInjectedMessage({ source: { kind: 'agent-instructions' }, content: [] }),
    'instruction',
  )
  assert.equal(classifyInjectedMessage({ source: { kind: 'subagent-settled' }, content: [] }), 'real')
  assert.equal(
    classifyInjectedMessage({ content: [{ type: 'text', text: '<available_skills> x' }] }),
    'instruction',
  )
})

test('TASK-3 补口：插桩关闭时 spliced 扫描零副作用', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acp-trace-spliced-off-'))
  const file = join(dir, 'acp-inject-trace.jsonl')
  delete process.env.DSH_ACP_INJECT_TRACE
  process.env.DSH_ACP_INJECT_TRACE_FILE = file
  resetTraceSeen()
  try {
    traceSessionEvents(
      fakeSession([
        splicedEvent(7, [
          { id: 'm-1', role: 'user', content: [{ type: 'text', text: 'x' }], source: { kind: 'user' } },
        ]),
      ]),
    )
    assert.equal(existsSync(file), false, '关闭态不得创建日志文件')
  } finally {
    delete process.env.DSH_ACP_INJECT_TRACE_FILE
    rmSync(dir, { recursive: true, force: true })
  }
})

test('TASK-3 补口：assistant 与 tool 通道主动补扫，不依赖会话是否发生压缩', () => {
  withTraceFile((file) => {
    traceSessionEvents(
      fakeSession([
        {
          seq: 10,
          time: '',
          type: 'assistant/message',
          data: { id: 'a-1', message: { content: [{ type: 'text', text: '助手回复' }] } },
        } as never,
        {
          seq: 11,
          time: '',
          type: 'tool/result',
          data: { id: 't-1', message: { content: [{ type: 'text', text: '工具输出' }] } },
        } as never,
      ]),
    )
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean)
    assert.equal(lines.length, 2, 'assistant 与 tool 各记一行')
    const classes = lines.map((raw) => (JSON.parse(raw) as { class: string }).class)
    assert.deepEqual(classes, ['real', 'real'])
  })
})

test('TASK-3 补口：宿主每步都扫，但同一条消息只记一行', () => {
  withTraceFile((file) => {
    const session = fakeSession([
      userTurnEvent(3, 'u-1', '用户说的话'),
      splicedEvent(7, [
        {
          id: 'm-1',
          role: 'user',
          content: [{ type: 'text', text: '插入的话' }],
          source: { kind: 'user' },
        },
      ]),
    ])
    traceSessionEvents(session)
    traceSessionEvents(session)
    traceSessionEvents(session)
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean)
    assert.equal(lines.length, 2, '扫三次也只记两条')
  })
})

test('TASK-3 补口：不同会话的相同 seq 各记一行（去重键必须按会话隔开）', () => {
  withTraceFile((file) => {
    // seq 是会话内序号，不同会话必然重号。早先的去重键只有 type#seq，
    // 于是后一个会话的大量事件被误判成"已记过"而跳过（实测 20 个会话
    // 少记了 5820 行）。
    traceSessionEvents(fakeSession([userEvent(3, '会话甲的话')], 'session-a'))
    traceSessionEvents(fakeSession([userEvent(3, '会话乙的话')], 'session-b'))
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean)
    assert.equal(lines.length, 2, '不同会话的同一 seq 必须各记一行')
    const texts = lines.map((raw) => (JSON.parse(raw) as { fp120: string }).fp120)
    assert.deepEqual(texts, ['会话甲的话', '会话乙的话'])
  })
})

// ── SEEN_CAP 触顶回归（2026-10-28 修复）────────────────────────────────────
// 旧版在去重表触顶时整表清空（`seenKeys.clear()` / `seenMessageIds.clear()`），
// 而宿主每步都全量重扫一遍会话日志 —— 清空之后下一步就把全部历史重新分类、
// 重新写一遍行。修复后：
//   - 事件级去重改水位线（每会话一条，不随事件数膨胀，根本不进这张上限）；
//   - 仍受 SEEN_CAP 约束的两张表（消息 id、非数值 seq 兜底键）触顶时
//     FIFO 逐出最老的 EVICT_BATCH 条，绝不整表清空。

/** 读回全部日志行（文件还不存在 = 一行都没写）。 */
function traceLines(file: string): Array<Record<string, unknown>> {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((raw) => JSON.parse(raw) as Record<string, unknown>)
}

test('SEEN_CAP 触顶：消息 id 表 FIFO 逐出最老一批，绝不整表清空', () => {
  withTraceFile((file) => {
    // 空内容消息：id 进去重表、但空文本不写行 —— 用它快速灌满整张表。
    for (let i = 0; i <= SEEN_CAP; i += 1) {
      traceInjectedMessage({ id: `m${i}`, content: [] }, 'real', i)
    }
    // 触顶发生在塞第 SEEN_CAP+1 个 id 时：最老的 EVICT_BATCH 条被整批逐出。
    assert.equal(messageAlreadyTraced('m0'), false, '最老一条被逐出')
    assert.equal(messageAlreadyTraced(`m${EVICT_BATCH - 1}`), false, '逐出批的最后一条也被逐出')
    assert.equal(messageAlreadyTraced(`m${EVICT_BATCH}`), true, '逐出批之外的健在')
    assert.equal(messageAlreadyTraced('m12345'), true, '中段健在 —— 整表清空会是 false')
    assert.equal(messageAlreadyTraced(`m${SEEN_CAP}`), true, '最新一条健在')
    // 健在的 id 重见照旧跳过；被逐出的最老一条重见会重记一次（有界泄漏，
    // 上限 EVICT_BATCH 条，换来的是绝不整表清空）；全新 id 照常记。
    traceInjectedMessage({ id: 'm12345', content: [{ type: 'text', text: '健在重见' }] }, 'real', 1)
    assert.equal(traceLines(file).length, 0, '健在的 id 重扫不得重记')
    traceInjectedMessage({ id: 'm0', content: [{ type: 'text', text: '逐出重见' }] }, 'real', 2)
    traceInjectedMessage({ id: 'm-new', content: [{ type: 'text', text: '全新消息' }] }, 'real', 3)
    assert.deepEqual(
      traceLines(file).map((row) => row.fp120),
      ['逐出重见', '全新消息'],
    )
  })
})

test('SEEN_CAP 触顶：非数值 seq 兜底键同样 FIFO 逐出，不整表清空', () => {
  withTraceFile(() => {
    // 空文本事件：兜底键进去重表、但不写行。非数值 seq 比不了水位线，
    // 全部走这张键表 —— 它就是旧版 seenKeys 的直系后代。
    for (let i = 0; i <= SEEN_CAP; i += 1) {
      traceSurfaceEvent(userEvent(`k${i}`, ''), 'real')
    }
    assert.equal(eventAlreadyTraced(userEvent('k0', '')), false, '最老一条被逐出')
    assert.equal(eventAlreadyTraced(userEvent(`k${EVICT_BATCH - 1}`, '')), false, '逐出批的最后一条也被逐出')
    assert.equal(eventAlreadyTraced(userEvent(`k${EVICT_BATCH}`, '')), true, '逐出批之外的健在')
    assert.equal(eventAlreadyTraced(userEvent(`k${SEEN_CAP}`, '')), true, '最新一条健在')
  })
})

test('claimSplicedEvent：按水位线认领，非数值 seq 放行交给消息 id 表', () => {
  resetTraceSeen()
  try {
    assert.equal(claimSplicedEvent(7, 'ns-a'), true, '首次认领成功')
    assert.equal(claimSplicedEvent(7, 'ns-a'), false, '重复扫到同一事件，认领失败')
    assert.equal(claimSplicedEvent(6, 'ns-a'), false, '更低 seq 是旧事件，认领失败')
    assert.equal(claimSplicedEvent(8, 'ns-a'), true, '更高 seq 认领成功')
    assert.equal(claimSplicedEvent(8, 'ns-b'), true, '不同会话各有水位线，互不影响')
    assert.equal(claimSplicedEvent('手工事件', 'ns-a'), true, '非数值 seq 比不了大小，放行')
    assert.equal(claimSplicedEvent('手工事件', 'ns-a'), true, '非数值 seq 每次都放行 —— 去重责任在消息 id 表')
  } finally {
    resetTraceSeen()
  }
})

test('claimSplicedEvent：surface@9 先记之后 spliced@7 后到仍认领（两条水位线必须分开）', () => {
  withTraceFile(() => {
    traceSessionEvents(fakeSession([userTurnEvent(9, 'id-x', '先走 surface 的消息')]))
    // 同一会话里两条通道的 seq 是交织的：spliced@7 后到但合法。
    // 两条通道共用一条水位线的话，这里会被 surface@9 挡死。
    assert.equal(claimSplicedEvent(7, 'test-session'), true, 'spliced 水位线独立于 surface')
    assert.equal(claimSplicedEvent(7, 'test-session'), false, '同通道重扫仍然只认一次')
  })
})

test('SEEN_CAP 触顶回归：溢出后重扫不重记，历史事件一行不重', () => {
  withTraceFile((file) => {
    const total = SEEN_CAP + 100
    // 哨兵抽样：全部事件都进去重，但只让铺满整个序号区间的一小撮带文本、
    // 写出行（全带文本要写两万行，实测十几秒）。旧版在第 SEEN_CAP+1 个
    // 事件处整表清空，第二步重扫会把前两万条里的哨兵全部重记；水位线
    // 修复后扫几遍都只有一遍的行数。
    const sentinelSeqs = [1, 2, 4001, 8001, 12001, 16001, total - 1, total]
    const events = Array.from({ length: total }, (_, i) =>
      userEvent(i + 1, sentinelSeqs.includes(i + 1) ? `事件${i + 1}` : ''),
    )
    const session = fakeSession(events)
    traceSessionEvents(session) // 宿主第一步全量扫
    traceSessionEvents(session) // 第二步又全量扫
    assert.deepEqual(
      traceLines(file).map((row) => row.seq),
      sentinelSeqs,
      '每个事件只记一行，扫几遍都一样',
    )
    // 没写行的空文本事件同样在水位线下 —— 不是"没记所以不重"，是真去过重。
    assert.equal(eventAlreadyTraced(userEvent(1, ''), 'test-session'), true, '最老的事件也还在水位线下')
    assert.equal(eventAlreadyTraced(userEvent(15000, ''), 'test-session'), true, '水位线覆盖到没写行的事件')
    assert.equal(eventAlreadyTraced(userEvent(total, ''), 'test-session'), true, '最新的事件同样在水位线下')
  })
})

test('TASK-3 补口：没有 id 的插入消息靠事件级认领去重，重扫不重记', () => {
  withTraceFile((file) => {
    const session = fakeSession([
      splicedEvent(7, [
        { role: 'user', content: [{ type: 'text', text: '无 id 的插入消息' }], source: { kind: 'user' } },
      ]),
    ])
    traceSessionEvents(session)
    traceSessionEvents(session)
    traceSessionEvents(session)
    // 消息 id 表管不到没有 id 的消息 —— 它们全靠 claimSplicedEvent 在事件级
    // 拦住，否则每步重扫都会重记一遍。
    assert.equal(traceLines(file).length, 1, '扫三次也只记一行')
    assert.equal(traceLines(file)[0]!.fp120, '无 id 的插入消息')
  })
})
