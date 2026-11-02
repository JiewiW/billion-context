// listing.js — 按 ref 顺序列出会话前 N 条的 step 明细（含工具名）
const fs = require('fs');
const file = process.argv[2];
const from = Number(process.argv[3] || 1);
const to = Number(process.argv[4] || 61);
const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
const events = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
  .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));

const callNameByToolCallId = new Map();
for (const e of events) {
  if (e.type === 'tool/call' && e.data?.callId) callNameByToolCallId.set(e.data.callId, e.data.name);
}
function countTokens(text) {
  if (typeof text !== 'string' || text.length === 0) return 0;
  const cjk = (text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff]/g) || []).length;
  return cjk + Math.ceil((text.length - cjk) / 4);
}
function blocks(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { for (const n of node) blocks(n, out); return out; }
  if (typeof node.text === 'string') out.push(node);
  if (Array.isArray(node.content)) blocks(node.content, out);
  return out;
}
const MSG_TYPES = new Set(['user/message', 'assistant/message', 'tool/result', 'developer/message']);
const rows = [];
let n = 1;
for (const e of events) {
  if (!MSG_TYPES.has(e.type)) continue;
  const ref = 'm' + String(n).padStart(5, '0');
  const d = e.data || {};
  const bs = blocks(d.message || d.content || d, []);
  const texts = bs.filter((b) => b.type === 'text').map((b) => b.text);
  const reason = bs.filter((b) => b.type === 'reasoning').map((b) => b.text).join(' ');
  const calls = bs.filter((b) => b.type === 'tool-call');
  let tool = '';
  if (e.type === 'tool/result') {
    const id = d.message?.toolCallId || d.message?.source?.callId;
    tool = callNameByToolCallId.get(id) || '';
  } else if (calls.length) tool = calls.map((c) => c.name).join(',');
  const text = texts.join('\n');
  const argsStr = calls.map((c) => String(c.arguments || '')).join(' | ');
  if (n >= from && n <= to) {
    rows.push({ ref, seq: e.seq, type: e.type, tool, tok: countTokens(text) + countTokens(argsStr), reasonTok: countTokens(reason), text: (text || argsStr).replace(/\s+/g, ' ') });
  }
  n++;
}
console.log('ref  ' + 'seq'.padEnd(5) + ' 类型'.padEnd(20) + 'tok'.padStart(6) + '  工具           内容摘要');
for (const r of rows) {
  const label = r.type === 'user/message' ? '[用户]' : r.type === 'assistant/message' ? '[助手]' : r.type === 'tool/result' ? '[工具结果]' : '[系统]';
  console.log(
    r.ref + ' ' + String(r.seq).padEnd(5) + ' ' + label.padEnd(12) + String(r.tok).padStart(6) +
    (r.reasonTok ? '+' + r.reasonTok + 'r' : '   ') + ' ' + (r.tool || '').padEnd(14) + r.text.slice(0, 105)
  );
}
console.log('');
console.log('本区间合计 tok:', rows.reduce((s, r) => s + r.tok + r.reasonTok, 0), '| 消息数:', rows.length);
