/**
 * D1 统计：真实会话里，每条 user 消息能不能被可靠地判出来源。
 *
 * 复刻 `bcdsh/src/messages.ts` 的 classifySurfaceEvent / isRealUserTurn 判定
 * （常量表逐条照抄，不新增规则），然后映射成设计文档 §3.2 的 provenance 七值，
 * 回答两个问题：
 *
 *   1. 有多少条 user 消息**判不出来源**（provenance === undefined）
 *      —— 这是 D1「不拦」的真实暴露面；
 *   2. 有多少条**旧口径会当成用户原文、实际是注入**（误报来源）
 *      —— 这是改进收益。
 *
 * 判定依据只用 event 上的 source 与文本标记，与运行时代码同源。
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readSessionEvents } from './session-read.mjs';

const METADATA_PLUGINS = new Set(['acp-nudge', 'billion-context']);
const REAL_CONTENT_PLUGINS = new Set(['@deepseek-ai/dsh-system-prompt', 'user-approval', 'tools-ptc']);
const REAL_CONTENT_KINDS = new Set(['runtime-context', 'ptc-mode']);
const AUDITED_RELAY_KINDS = new Set(['subagent-report', 'subagent-settled']);
const HOST_INSTRUCTION_KINDS = new Set(['agent-instructions', 'skill-catalog', 'compact-basic']);

function extractText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue;
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
    else if (block.type === 'image' || block.type === 'file') parts.push(`[${block.type}]`);
    else if (Array.isArray(block.content)) parts.push(extractText(block.content));
  }
  return parts.join('\n');
}

function sourcePluginOf(source) {
  if (source === undefined || typeof source !== 'object') return undefined;
  const kind = source.kind;
  if (kind === 'plugin') {
    return typeof source.plugin === 'string' && source.plugin.length > 0 ? source.plugin : undefined;
  }
  if (typeof kind === 'string' && kind.startsWith('plugin:')) {
    const name = kind.slice('plugin:'.length);
    return name.length > 0 ? name : undefined;
  }
  return undefined;
}

function isCheckpointNode(event) {
  if (event.type !== 'user/message') return false;
  const source = event.data?.source;
  return source?.plugin === 'compact' || source?.kind === 'compact-checkpoint';
}

function isSkillCatalogRow(event, text) {
  if (event.type !== 'user/message') return false;
  const source = event.data?.source;
  if (source?.kind === 'skill-catalog') return true;
  if (sourcePluginOf(source) === 'dsh-tool-skill') return true;
  return text.includes('<available_skills>');
}

/** 照抄 classifySurfaceEventRaw：real / metadata / checkpoint / instruction。 */
function classify(event, text) {
  if (isCheckpointNode(event)) return 'checkpoint';
  if (event.type === 'developer/message') return 'metadata';
  if (event.type !== 'user/message') return 'real';
  const source = event.data?.source;
  if (!source) return isSkillCatalogRow(event, text) ? 'instruction' : 'real';
  const kind = source.kind;
  if (kind === 'user') return isSkillCatalogRow(event, text) ? 'instruction' : 'real';
  const plugin = sourcePluginOf(source);
  if (kind === 'plugin' || plugin !== undefined) {
    if (plugin !== undefined && METADATA_PLUGINS.has(plugin)) return 'metadata';
    if (plugin !== undefined && REAL_CONTENT_PLUGINS.has(plugin)) return 'real';
    return 'instruction';
  }
  if (typeof kind !== 'string') return isSkillCatalogRow(event, text) ? 'instruction' : 'real';
  if (HOST_INSTRUCTION_KINDS.has(kind)) return 'instruction';
  if (REAL_CONTENT_KINDS.has(kind) || AUDITED_RELAY_KINDS.has(kind)) return 'real';
  return 'instruction';
}

/** 照抄 isRealUserTurn：real 里排除宿主内容行与转述行，只剩用户本人。 */
function isRealUserTurn(event, text) {
  if (event.type !== 'user/message') return false;
  if (classify(event, text) !== 'real') return false;
  const source = event.data?.source;
  const plugin = sourcePluginOf(source);
  if (plugin !== undefined && REAL_CONTENT_PLUGINS.has(plugin)) return false;
  const kind = source?.kind;
  if (typeof kind === 'string' && REAL_CONTENT_KINDS.has(kind)) return false;
  return kind !== 'subagent-report' && kind !== 'subagent-settled';
}

/** 设计文档 §3.2 的七值映射。user-material 本轮不判定，留空。 */
function provenanceOf(event, text) {
  const cls = classify(event, text);
  if (cls === 'checkpoint') return 'checkpoint';
  if (cls === 'instruction') return 'host-policy';
  if (cls === 'metadata') return 'engine-metadata';
  const source = event.data?.source;
  const plugin = sourcePluginOf(source);
  if (plugin !== undefined && REAL_CONTENT_PLUGINS.has(plugin)) return 'host-content';
  const kind = source?.kind;
  if (typeof kind === 'string' && REAL_CONTENT_KINDS.has(kind)) return 'host-content';
  if (typeof kind === 'string' && AUDITED_RELAY_KINDS.has(kind)) return 'relay';
  return 'user-turn';
}

/**
 * @param {string} filePath
 * @param {{ withText?: boolean }} [options] `withText` 为真时每行额外带 `text`。
 *   默认关闭：全机 16252 行 / 3500 万字符，只要统计时没必要把全文搬进内存。
 *   TASK-11 采样需要原文，走这个开关，而不是在采样脚本里另写一套 extractText。
 */
export function analyzeSession(filePath, options = {}) {
  const { events, frames, failures, badLines } = readSessionEvents(filePath);
  const withText = options.withText === true;
  const userRows = [];
  for (const event of events) {
    if (event.type !== 'user/message' && event.type !== 'developer/message') continue;
    const text = extractText(event.data?.content ?? event.data?.message?.content);
    if (text.length === 0) continue;
    const provenance = provenanceOf(event, text);
    userRows.push({
      seq: event.seq,
      provenance,
      chars: text.length,
      realUserTurn: isRealUserTurn(event, text),
      // 旧口径：只看 role。这些消息在旧判定里全部算「用户原文」。
      oldWouldTreatAsUser: true,
      ...(withText ? { text } : {}),
    });
  }
  return { events: events.length, userRows, frames, failures: failures.length, badLines };
}

/** 按体积从大到小列出所有 v4 会话文件。 */
export function walkSessions(root) {
  const out = [];
  for (const ws of readdirSync(root, { withFileTypes: true })) {
    if (!ws.isDirectory()) continue;
    const wsDir = join(root, ws.name);
    for (const sid of readdirSync(wsDir, { withFileTypes: true })) {
      if (!sid.isDirectory()) continue;
      const file = join(wsDir, sid.name, 'session.v4.jsonl.zstd');
      try {
        out.push({ file, size: statSync(file).size, workspace: ws.name, sessionId: sid.name });
      } catch {
        // 该会话没有 v4 文件（v3 / 半升级 / 已归档），跳过
      }
    }
  }
  return out.sort((a, b) => b.size - a.size);
}

/** 命令行入口：只在被直接执行时跑，被 import 时不跑。 */
function main() {
  const root = process.argv[2];
  const topN = Number(process.argv[3] ?? 8);
  const sessions = walkSessions(root).slice(0, topN);

  const totals = new Map();
  let rowTotal = 0;
  let charTotal = 0;
  let oldTrueHitTotal = 0; // 旧口径当成用户、实际不是用户本人
  let gatedTotal = 0; // 落进旧门判据的：role=user 且 ≤500 字符
  let gatedBadTotal = 0; // 其中不该算用户原文的（= 旧口径的误报分子）

  const perSession = [];
  for (const s of sessions) {
    const r = analyzeSession(s.file);
    const byProv = new Map();
    let oldTrueHit = 0;
    let gated = 0;
    let gatedBad = 0;
    for (const row of r.userRows) {
      byProv.set(row.provenance, (byProv.get(row.provenance) ?? 0) + 1);
      totals.set(row.provenance, (totals.get(row.provenance) ?? 0) + 1);
      rowTotal += 1;
      charTotal += row.chars;
      const notUser = row.provenance !== 'user-turn';
      if (notUser) oldTrueHit += 1;
      if (row.chars <= 500) {
        gated += 1;
        if (notUser) gatedBad += 1;
      }
    }
    oldTrueHitTotal += oldTrueHit;
    gatedTotal += gated;
    gatedBadTotal += gatedBad;
    perSession.push({
      session: s.file.split(/[\\/]/).slice(-2)[0],
      mb: +(s.size / 1048576).toFixed(1),
      frames: r.frames,
      failures: r.failures,
      rows: r.userRows.length,
      byProv: Object.fromEntries(byProv),
      oldWronglyUser: oldTrueHit,
      gatedRows: gated,
      gatedWrong: gatedBad,
    });
  }

  console.log(JSON.stringify({
    sessions: perSession,
    totals: {
      sessions: sessions.length,
      rows: rowTotal,
      chars: charTotal,
      byProvenance: Object.fromEntries(totals),
      unknownProvenance: totals.get(undefined) ?? 0,
      oldWronglyUser: oldTrueHitTotal,
      oldWronglyUserPct: rowTotal ? +((oldTrueHitTotal / rowTotal) * 100).toFixed(1) : 0,
      gatedRows: gatedTotal,
      gatedWrong: gatedBadTotal,
      gatedWrongPct: gatedTotal ? +((gatedBadTotal / gatedTotal) * 100).toFixed(1) : 0,
    },
  }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
