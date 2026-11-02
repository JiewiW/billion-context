/**
 * TASK-11 采样池体检：全机 user-turn 消息按长度分四档，每档各有多少条。
 *
 * 复用 provenance-coverage-probe.mjs 的 analyzeSession / walkSessions，
 * 不另写一套来源判定（RL-11 同口径原则）。
 * 用途：判断设计文档 §4.5 的"每档抽 ≥15 条"在全机样本上够不够，
 * 以及 >2000 字符那一档有多少条可用来标定 4.3 的长度阈值 L。
 */
import { analyzeSession, walkSessions } from './provenance-coverage-probe.mjs';

const BUCKETS = [
  { name: 'A_le120', max: 120 },
  { name: 'B_120_500', min: 120, max: 500 },
  { name: 'C_500_2000', min: 500, max: 2000 },
  { name: 'D_gt2000', min: 2000 },
];

function bucketOf(chars) {
  for (const b of BUCKETS) {
    const okMin = b.min === undefined || chars > b.min;
    const okMax = b.max === undefined || chars <= b.max;
    if (okMin && okMax) return b.name;
  }
  return 'unknown';
}

const sessions = walkSessions(process.argv[2] ?? '<HOME>/.dsh/sessions');
const pool = [];

for (const s of sessions) {
  let rows;
  try {
    rows = analyzeSession(s.file).userRows;
  } catch {
    continue;
  }
  for (const row of rows) {
    if (row.provenance !== 'user-turn') continue;
    if (!row.realUserTurn) continue;
    pool.push({ session: s.sessionId, workspace: s.workspace, seq: row.seq, chars: row.chars });
  }
}

const byBucket = {};
const byWorkspace = {};
for (const row of pool) {
  const b = bucketOf(row.chars);
  byBucket[b] = (byBucket[b] ?? 0) + 1;
  byWorkspace[row.workspace] = (byWorkspace[row.workspace] ?? 0) + 1;
}

console.log(JSON.stringify({
  sessionsScanned: sessions.length,
  userTurnTotal: pool.length,
  charsTotal: pool.reduce((n, r) => n + r.chars, 0),
  byBucket,
  byWorkspaceCount: Object.keys(byWorkspace).length,
}, null, 2));
