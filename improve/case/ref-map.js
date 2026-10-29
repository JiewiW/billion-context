// ref-map.js — 重构 mNNNNN 引用 ↔ 消息映射，并核算每次 compress 的真实压缩比
const fs = require('fs');
const file = process.argv[2];
const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
const events = [];
for (const line of lines) {
  let e; try { e = JSON.parse(line); } catch { continue; }
  events.push(e);
}
events.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));

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
  if (Array.isArray(node.inserted)) blocks(node.inserted, out);
  return out;
}

// ref 分配：按 seq 序给"可见消息"发号（排除纯元数据事件）
const MSG_TYPES = new Set(['user/message', 'assistant/message', 'tool/result', 'tool/use', 'developer/message']);
const refToInfo = new Map();
let next = 1;
for (const e of events) {
  if (!MSG_TYPES.has(e.type)) continue;
  // spliced 注入已经被 user/message 记过，跳过
  const bs = blocks(e.data?.message || e.data, []);
  const text = bs.filter((b) => b.type === 'text' || b.type === 'reasoning').map((b) => b.text).join('\n');
  const args = bs.filter((b) => b.type === 'tool-call').map((b) => String(b.arguments || '')).join(' ');
  const ref = 'm' + String(next).padStart(5, '0');
  refToInfo.set(ref, {
    ref, seq: e.seq, type: e.type, tokens: countTokens(text) + countTokens(args), chars: text.length + args.length,
    preview: (text || args).slice(0, 80),
  });
  next++;
}
console.log('=== ref 空间重建 ===');
console.log('可见消息数(=最高 ref):', next - 1, '→ m' + String(next - 1).padStart(5, '0'));
console.log('');

function rangeInfo(startRef, endRef) {
  if (typeof startRef !== 'string' || typeof endRef !== 'string') return null;
  const s = Number(startRef.replace(/^m0*/, ''));
  const t = Number(endRef.replace(/^m0*/, ''));
  if (!Number.isFinite(s) || !Number.isFinite(t)) return null;
  let tokens = 0, chars = 0, count = 0;
  const types = {};
  for (let i = s; i <= t; i++) {
    const ref = 'm' + String(i).padStart(5, '0');
    const info = refToInfo.get(ref);
    if (!info) continue;
    tokens += info.tokens; chars += info.chars; count++;
    types[info.type] = (types[info.type] || 0) + 1;
  }
  return { tokens, chars, count, types };
}

console.log('=== 每次 compress 的真实代价收益 ===');
for (const e of events) {
  if (!(e.type === 'tool/call' && ['compress'].includes(e.data?.name))) continue;
  let rows = [];
  try { const a = JSON.parse(e.data.arguments); rows = a.content || a.ranges || a; } catch { rows = []; }
  if (typeof rows === 'string') { try { rows = JSON.parse(rows); } catch { rows = []; } }
  if (rows && !Array.isArray(rows) && Array.isArray(rows.ranges)) rows = rows.ranges;
  if (!Array.isArray(rows)) rows = [rows];
  console.log('');
  console.log('▶ seq ' + e.seq + ' compress（' + rows.length + ' 段）');
  let sumTok = 0, sumChar = 0;
  for (const r of rows) {
    const info = rangeInfo(r.startId, r.endId);
    const sumChars = (r.summary || '').length;
    const sumTokens = countTokens(r.summary || '');
    if (!info) { console.log('   ' + r.startId + '..' + r.endId + ' 无法核算（ref 越界/异常）'); continue; }
    sumTok += info.tokens; sumChar += sumChars;
    console.log(
      '   ' + r.startId + '–' + r.endId +
      ' | 原文 ' + info.count + ' 条 / ' + info.tokens + ' tok / ' + info.chars + ' 字符' +
      ' | 摘要 ' + sumTokens + ' tok / ' + sumChars + ' 字符' +
      ' | 压缩比 ' + (info.tokens / Math.max(sumTokens, 1)).toFixed(1) + 'x'
    );
    console.log('       原文构成: ' + JSON.stringify(info.types) + ' | topic=' + (r.topic || ''));
  }
  console.log('   合计: 原文 ' + sumTok + ' tok → 摘要 ' + sumChar + ' 字符');
}
console.log('');

console.log('=== 摘要全文（可展示"压缩后形态"） ===');
for (const e of events) {
  if (!(e.type === 'tool/call' && e.data?.name === 'compress')) continue;
  let rows = [];
  try { const a = JSON.parse(e.data.arguments); rows = a.content || a.ranges || a; } catch { rows = []; }
  if (typeof rows === 'string') { try { rows = JSON.parse(rows); } catch { rows = []; } }
  if (rows && !Array.isArray(rows) && Array.isArray(rows.ranges)) rows = rows.ranges;
  if (!Array.isArray(rows)) rows = [rows];
  for (const r of rows) {
    if (!r.summary) continue;
    console.log('--- ' + r.startId + '–' + r.endId + ' [' + (r.topic || '') + '] 摘要 ' + r.summary.length + ' 字符 ---');
    console.log(r.summary);
    console.log('');
  }
}
