// estimate.js — 会话事件剖析 + token 估算（CJK 感知，对齐 acp-kernel 计数口径）
const fs = require('fs');
const path = require('path');

const file = process.argv[2];
const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());

function countTokens(text) {
  if (typeof text !== 'string' || text.length === 0) return 0;
  const cjk = (text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff]/g) || []).length;
  return cjk + Math.ceil((text.length - cjk) / 4);
}

// 抽出 content 块：通用递归找 {type, text} 结构
function collectBlocks(node, out) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const n of node) collectBlocks(n, out);
    return out;
  }
  if (typeof node.text === 'string') out.push(node);
  if (Array.isArray(node.content)) collectBlocks(node.content, out);
  if (Array.isArray(node.inserted)) collectBlocks(node.inserted, out);
  return out;
}

const events = [];
for (const line of lines) {
  let ev;
  try { ev = JSON.parse(line); } catch { continue; }
  const d = ev.data || {};
  const blocks = collectBlocks(d.message || d.inserted || d, []);
  const texts = blocks.filter((b) => b.type === 'text' || b.type === 'reasoning').map((b) => b.text);
  const calls = blocks.filter((b) => b.type === 'tool-call');
  const toolNames = calls.map((c) => c.name).concat(d.toolName ? [d.toolName] : []);
  const args = calls.map((c) => {
    try { return JSON.stringify(JSON.parse(c.arguments || '{}')); } catch { return String(c.arguments || ''); }
  }).join(' | ');
  const text = texts.join('\n');
  events.push({
    seq: ev.seq,
    type: ev.type,
    role: d.message?.role || d.role || '',
    tool: [...new Set(toolNames)].join(','),
    args,
    chars: text.length + args.length,
    tokens: countTokens(text) + countTokens(args),
    text,
  });
}

console.log('=== 会话事件总览 ===');
console.log('文件:', path.basename(file));
console.log('事件总数:', events.length);
const totalTokens = events.reduce((s, e) => s + e.tokens, 0);
console.log('累计估算 tokens(全事件累加):', totalTokens);
console.log('');

const hist = {};
for (const e of events) hist[e.type] = (hist[e.type] || 0) + 1;
console.log('=== type 分布 ===');
Object.entries(hist).sort((a, b) => b[1] - a[1]).forEach(([t, c]) => console.log(String(c).padStart(6), t));
console.log('');

console.log('=== 会话标题 ===');
events.filter((e) => e.type === 'session/title').forEach((e) => console.log('  seq', e.seq, ':', e.text.slice(0, 160)));
console.log('');

console.log('=== 用户提问 (user/message) ===');
events.filter((e) => e.type === 'user/message').forEach((e) => {
  console.log('  seq', String(e.seq).padStart(4), '|', e.tokens + 't |', JSON.stringify(e.text.slice(0, 150)));
});
console.log('');

console.log('=== compaction 事件 ===');
events.filter((e) => e.type.startsWith('compaction/')).forEach((e) => {
  console.log('  seq', String(e.seq).padStart(4), '|', e.type, '|', JSON.stringify(e.text.slice(0, 100)));
});
console.log('');

console.log('=== 最重的 30 个事件（按 token，含工具参数） ===');
[...events].sort((a, b) => b.tokens - a.tokens).slice(0, 30).forEach((e) => {
  console.log(
    String(e.tokens).padStart(6) + 't seq=' + String(e.seq).padStart(4) + ' ' +
    e.type.padEnd(20) + (e.tool ? '[' + e.tool.slice(0, 40) + '] ' : '') +
    JSON.stringify((e.text || e.args).slice(0, 100))
  );
});
