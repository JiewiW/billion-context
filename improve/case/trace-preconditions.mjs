/**
 * 补 TASK-3 前的两个前提验证（决定去重表怎么设计）。
 *
 * 前提 1：同一个消息 id 会不会出现在**多个** `user/message` 事件里？
 *   - 会 → 共享的 id 去重表会让第 2..N 条被误跳过（漏记）。
 *   - 不会 → 共享去重表安全，"先到先记、另一条跳过"就是正确的跨通道互斥。
 *
 * 前提 2：`user/message` 事件的 `data.id` 字段在真实会话里存在吗？
 *   - 不存在 → 跨通道互斥只能靠指纹，精度下降。
 *
 * 顺带量一下 spliced 事件的 seq 是否会进 `surface.nodes`（即它是不是 surface 事件）。
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readSessionEvents } from './session-read.mjs';

const root = process.argv[2] ?? join(process.env.HOME ?? '', '.dsh', 'sessions');
const topN = Number(process.argv[3] ?? 20);

function pickSessions(rootDir, count) {
  const out = [];
  for (const ws of readdirSync(rootDir, { withFileTypes: true })) {
    if (!ws.isDirectory()) continue;
    const wsDir = join(rootDir, ws.name);
    for (const sid of readdirSync(wsDir, { withFileTypes: true })) {
      if (!sid.isDirectory()) continue;
      const file = join(wsDir, sid.name, 'session.v4.jsonl.zstd');
      try {
        out.push({ file, size: statSync(file).size });
      } catch {
        /* 无 v4 文件 */
      }
    }
  }
  return out.sort((a, b) => b.size - a.size).slice(0, count);
}

let userEvents = 0;
let userWithId = 0;
let userWithoutId = 0;
let splicedEvents = 0;
let splicedWithSeq = 0;
/** 出现过 ≥2 次的消息 id（前提 1 的判据） */
const idCounts = new Map();
/** 同一 id 的多条 user/message 事件是否文本一致 */
const idTextVariants = new Map();
/** spliced 的 inserted 消息 id 是否都能在 user/message 里找到对应 id */
const userIds = new Set();
const splicedIds = new Map();

for (const session of pickSessions(root, topN)) {
  const { events } = readSessionEvents(session.file);
  // ⚠️ 两遍扫：spliced 事件的 seq 比它对应的 user/message 小，先扫完 user/message
  //    才能拿到完整的 id 集合（边走边填会让 spliced 永远匹配不上）。
  for (const event of events) {
    if (event.type !== 'user/message') continue;
    userEvents += 1;
    const data = event.data ?? {};
    const id = typeof data.id === 'string' ? data.id : '';
    if (id === '') {
      userWithoutId += 1;
      continue;
    }
    userWithId += 1;
    userIds.add(id);
    idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
    const text = JSON.stringify(data.content ?? null);
    if (!idTextVariants.has(id)) idTextVariants.set(id, new Set());
    idTextVariants.get(id).add(text);
  }
  for (const event of events) {
    if (event.type !== 'agent/inbox/spliced') continue;
    splicedEvents += 1;
    if (typeof event.seq === 'number') splicedWithSeq += 1;
    const inserted = event.data?.inserted;
    if (!Array.isArray(inserted)) continue;
    for (const message of inserted) {
      const id = message && typeof message.id === 'string' ? message.id : '';
      if (id === '') continue;
      const key = `${id}`;
      const stats = splicedIds.get(key) ?? { spliced: 0, matched: 0 };
      stats.spliced += 1;
      if (userIds.has(key)) stats.matched += 1;
      splicedIds.set(key, stats);
    }
  }
}

const repeatedIds = [...idCounts.entries()].filter(([, count]) => count > 1);
const variantIds = repeatedIds.filter(([id]) => (idTextVariants.get(id)?.size ?? 0) > 1);
let splicedTotal = 0;
let splicedMatched = 0;
for (const stats of splicedIds.values()) {
  splicedTotal += stats.spliced;
  splicedMatched += stats.matched;
}

console.log(JSON.stringify({
  sessions: pickSessions(root, topN).length,
  userEvents,
  userWithId,
  userWithoutId,
  splicedEvents,
  splicedWithSeq,
  前提1_重复出现的消息id数: repeatedIds.length,
  前提1_其中文本不一致的: variantIds.length,
  前提1_样例: repeatedIds.slice(0, 5).map(([id, count]) => ({ id: id.slice(0, 8), count })),
  前提2_userMessage有id的比例: userEvents === 0 ? 0 : +(userWithId / userEvents).toFixed(4),
  spliced插入消息_有id的条数: splicedTotal,
  spliced插入消息_id能在userMessage找到的: splicedMatched,
  splicedId匹配率: splicedTotal === 0 ? 0 : +(splicedMatched / splicedTotal).toFixed(4),
}, null, 2));
