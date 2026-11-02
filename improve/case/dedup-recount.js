// 重算 session-063661eb 重复注入指纹聚类（对应计划书 P4 / 审查 F3）
// 口径：消息类事件的每个文本内容块为候选；块长 >= 800 字符；按前 120 字符指纹分组；
//       组内 >= 2 块即计重复；单份 = 组内最大块长；合计 = 组内全部块长之和。
const fs = require("fs");
const SRC = "<DSH>/_bc-src/case/session-063661eb-0bc3-40fb-97b1-79ac199f6406.jsonl";
const MIN_CHARS = 800;
const PREFIX_CHARS = 120;

const lines = fs.readFileSync(SRC, "utf8").split("\n").filter(Boolean);
const blocks = [];
for (const line of lines) {
  let ev;
  try { ev = JSON.parse(line); } catch { continue; }
  const d = ev.data;
  if (!d) continue;
  const msgs = [];
  if (ev.type === "agent/inbox/spliced" && Array.isArray(d.inserted)) msgs.push(...d.inserted);
  else if (d.message) msgs.push(d.message);
  else if (Array.isArray(d.content)) msgs.push({ role: d.role, content: d.content });
  for (const m of msgs) {
    if (!m || !Array.isArray(m.content)) continue;
    for (const part of m.content) {
      if (part && part.type === "text" && typeof part.text === "string") {
        blocks.push({ role: m.role || "?", text: part.text, type: ev.type });
      }
    }
  }
}

const big = blocks.filter((b) => b.text.length >= MIN_CHARS);
const groups = new Map();
for (const b of big) {
  const fp = b.text.slice(0, PREFIX_CHARS);
  if (!groups.has(fp)) groups.set(fp, []);
  groups.get(fp).push(b);
}

const dups = [];
for (const [, members] of groups) {
  if (members.length < 2) continue;
  const sizes = members.map((m) => m.text.length);
  const maxSize = Math.max(...sizes);
  const sum = sizes.reduce((a, c) => a + c, 0);
  const head = members[0].text.slice(0, 60).replace(/\s+/g, " ");
  dups.push({ count: members.length, maxSize, sum, head, roles: [...new Set(members.map((m) => m.role))].join("/") });
}
dups.sort((a, b) => b.sum - a.sum);

const total = dups.reduce((a, d) => a + d.sum, 0);
console.log(`候选文本块总数: ${blocks.length}；>= ${MIN_CHARS} 字符的块: ${big.length}`);
console.log(`重复组（>=2 块）: ${dups.length} 组；重复内容合计: ${total.toLocaleString()} 字符`);
console.log("---- Top 20 ----");
for (const d of dups.slice(0, 20)) {
  console.log(`x${d.count}\t单份(最大) ${d.maxSize}\t合计 ${d.sum}\t[${d.roles}]\t${d.head}`);
}
