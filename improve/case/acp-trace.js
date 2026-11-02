// acp-trace.js — 抽出会话里全部 ACP 工具活动（真·压缩案例）
const fs = require('fs');
const file = process.argv[2];
const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
const ACP_TOOLS = new Set(['compress', 'decompress', 'search_context', 'acp_status', 'acp_cache', 'absorb']);

const bySeq = new Map();
for (const line of lines) {
  let e; try { e = JSON.parse(line); } catch { continue; }
  bySeq.set(e.seq, e);
}

function argStr(data) {
  try {
    const o = JSON.parse(data.arguments || '{}');
    return JSON.stringify(o);
  } catch { return String(data.arguments || ''); }
}

console.log('=== ACP 工具活动全序列 ===');
let n = 0;
for (const [seq, e] of [...bySeq.entries()].sort((a, b) => a[0] - b[0])) {
  if (e.type === 'tool/call' && ACP_TOOLS.has(e.data?.name)) {
    const args = argStr(e.data);
    console.log('');
    console.log('▶ seq ' + seq + ' CALL ' + e.data.name + '  args=' + args.slice(0, 700));
    // 找配对结果
    const callId = e.data.callId;
    for (const [s2, e2] of bySeq) {
      if (e2.type === 'tool/result' && (e2.data?.message?.toolCallId === callId || e2.data?.toolCallId === callId)) {
        const txt = (e2.data?.message?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
        console.log('  ↳ seq ' + s2 + ' RESULT (' + txt.length + ' 字符):');
        console.log(txt.slice(0, 1200).split('\n').map((l) => '     ' + l).join('\n'));
        if (txt.length > 1200) console.log('     ...[截断，共 ' + txt.length + ' 字符]');
        break;
      }
    }
    n++;
  }
}
console.log('');
console.log('=== ACP 工具调用总数: ' + n + ' ===');
