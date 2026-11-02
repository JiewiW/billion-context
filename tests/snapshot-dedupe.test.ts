/**
 * TASK-4 / 改进 5b —— 运行时上下文快照「只留最新一份」的护栏。
 *
 * 依据：5a 插桩在真实会话上量到快照重复注入 45 份 / 248,674 字符，单份 10,845 字符，
 * 占总重复的 64.1%。快照文本自带 `This snapshot supersedes earlier runtime context`
 * 语义，所以旧的投影行对模型没有增量信息。
 *
 * 边界（这些用例存在的意义就是守住边界）：
 *   - 只折叠 `Current runtime context` 开头的 user 文本行，别的什么都不碰；
 *   - 同指纹保留**最后**一条（最新状态），不是第一条；
 *   - 指纹不同的快照不合并（同通道不同内容也在这一档，宁可少折叠不可误折叠）；
 *   - 全量日志（allLogMessages）绝不去重 —— 内核 T2/T3 蒸馏要能锚到每条历史消息。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { dedupeSupersededSnapshots, surfaceCoreMessages } from '../src/messages.ts'

const SNAPSHOT_HEAD = 'Current runtime context. This snapshot supersedes earlier runtime context.\n'
/**
 * 指纹窗口（120 字符）内的固定填充：HEAD 约 76 字符，这份填充让它越过 120，
 * 于是同一形态的快照变体落进同一个指纹组 —— 与真实会话里 45 份同组的情形一致。
 */
const FILLER = 'It replaces every earlier snapshot; rely on this copy alone. '

/** 真实形态：前 120 字符固定，只有尾部（版本内容）变化 → 同指纹。 */
function snapshotEvent(seq: number, tail: string) {
  return rawUserEvent(seq, `m${seq}`, SNAPSHOT_HEAD + FILLER + tail, { kind: 'runtime-context' })
}

/** 短形态：尾部落在指纹窗口内 → 与别的变体不同指纹。 */
function shortSnapshotEvent(seq: number, tail: string) {
  return rawUserEvent(seq, `s${seq}`, SNAPSHOT_HEAD + tail, { kind: 'runtime-context' })
}

function rawUserEvent(seq: number, id: string, text: string, source: unknown) {
  return {
    seq,
    time: '',
    type: 'user/message',
    data: { id, role: 'user', content: [{ type: 'text', text }], source },
  } as never
}

function userTurnEvent(seq: number, text: string) {
  return rawUserEvent(seq, `u${seq}`, text, { kind: 'user' })
}

test('AC-4.x 同指纹的多份快照只留最后一份，其余消息顺序不变', () => {
  const events = [
    snapshotEvent(1, 'version one'),
    userTurnEvent(2, '你好'),
    snapshotEvent(3, 'version two'),
    snapshotEvent(5, 'version three'),
  ]
  const messages = surfaceCoreMessages(events)
  assert.deepEqual(
    messages.map((message) => message.id),
    ['2', '5'],
    '三份快照折成一份（最后一条）+ 用户消息位置不变',
  )
})

test('指纹不同的快照不合并（宁可少折叠，不可误折叠）', () => {
  const messages = surfaceCoreMessages([
    shortSnapshotEvent(1, 'alpha'),
    shortSnapshotEvent(2, 'beta'),
  ])
  assert.deepEqual(messages.map((message) => message.id), ['1', '2'])
})

test('非快照消息一律不动（人类原话、assistant、tool 输出）', () => {
  const events = [
    userTurnEvent(1, 'Current runtime context is a phrase I typed myself, not a snapshot'),
    {
      seq: 2,
      time: '',
      type: 'assistant/message',
      data: { id: 'a2', message: { content: [{ type: 'text', text: 'assistant text' }] } },
    } as never,
    {
      seq: 3,
      time: '',
      type: 'tool/result',
      data: { id: 't3', message: { content: [{ type: 'text', text: 'tool out' }] } },
    } as never,
  ]
  assert.equal(surfaceCoreMessages(events).length, 3, '没有任何消息被折叠')
})

test('无快照时原样投影，且返回新数组（调用方可安全排序）', () => {
  const events = [userTurnEvent(1, 'a'), userTurnEvent(2, 'b')]
  const projected = surfaceCoreMessages(events)
  assert.deepEqual(projected.map((message) => message.id), ['1', '2'])
  const copy = dedupeSupersededSnapshots(projected)
  assert.deepEqual(copy, projected)
  assert.notEqual(copy, projected, '返回新数组，避免共享引用')
})

test('快照形态只认 user + text：tool 输出里的同文不参与折叠', () => {
  const toolSnapshot = {
    seq: 9,
    time: '',
    type: 'tool/result',
    data: {
      id: 't9',
      message: { content: [{ type: 'text', text: SNAPSHOT_HEAD + FILLER + 'tool payload' }] },
    },
  } as never
  const messages = dedupeSupersededSnapshots(
    surfaceCoreMessages([userTurnEvent(1, 'q'), toolSnapshot]),
  )
  assert.deepEqual(messages.map((message) => message.id), ['1', '9'])
})
