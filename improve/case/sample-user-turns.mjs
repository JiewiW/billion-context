/**
 * TASK-11 —— 保真门标定样本集（真实会话 + 人工标注）。
 *
 * 两个模式：
 *   node case/sample-user-turns.mjs                      扫描 + 分层抽样 + 写骨架 JSON + 写复核表
 *   node case/sample-user-turns.mjs --finalize <labels>   把人工标注合进骨架，产出最终 fixtures
 *
 * 三条纪律（计划书 §5 TASK-11）：
 *   1. 解会话复用 `session-read.mjs` 的 readSessionEvents（多 zstd 帧，禁止单帧解压）；
 *   2. 来源判定复用 `provenance-coverage-probe.mjs` 的 analyzeSession / walkSessions，
 *      不另写一套（RL-11）；取 `provenance === "user-turn"` 且 `realUserTurn === true`；
 *   3. 真实样本不足时只能扩会话，**禁止构造样本冒充**（AC-11.1）。
 *
 * 抽样是确定性的：mulberry32 固定种子 + 先按工作区分组再轮转，所以同一台机上
 * 重跑得到同一批样本，标注可以复用。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { analyzeSession, walkSessions } from './provenance-coverage-probe.mjs';

const SESSION_ROOT = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2]
  : '<HOME>/.dsh/sessions';

const FIXTURES = new URL('./quote-fidelity-fixtures-20261028.json', import.meta.url);
const REVIEW = new URL('./quote-fidelity-fixtures-review-20261028.md', import.meta.url);

/** 四档长度分档（与 user-turn-pool-probe.mjs 同一套口径：字符数，不是 token）。 */
const BUCKETS = [
  { name: 'A_le120', label: 'A ≤120', min: undefined, max: 120 },
  { name: 'B_120_500', label: 'B 120–500', min: 120, max: 500 },
  { name: 'C_500_2000', label: 'C 500–2000', min: 500, max: 2000 },
  { name: 'D_gt2000', label: 'D >2000', min: 2000, max: undefined },
];

/** 每档抽多少条。计划书要求 ≥15；取 16 是为了每档都留出 1 条余量给复核剔除。 */
const PER_BUCKET = 16;

/** 单条样本存进 JSON 的字符上限。超长的记 `textTruncated`，原文整条仍在会话里。 */
const MAX_TEXT_CHARS = 6000;

const SEED = 20261029;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bucketOf(chars) {
  for (const b of BUCKETS) {
    const okMin = b.min === undefined || chars > b.min;
    const okMax = b.max === undefined || chars <= b.max;
    if (okMin && okMax) return b.name;
  }
  return 'unknown';
}

// ── 自动初判（只是给人工复核的起点，最终标注以人工为准）──────────────────────

const OBLIGATION_MARKERS = [
  '必须', '务必', '一定', '只能', '只需', '不要', '别', '禁止', '不得', '记得',
  '请先', '请先别', '确保', '请注意', '严格', 'must', 'never', "don't", 'do not',
  'only', 'required', 'should', 'make sure',
];

const ACCEPTANCE_MARKERS = [
  '验收', '判据', '完成标准', '通过条件', '达标', '断言', '测试通过', '自检',
  '验收标准', '以…为准', '判据是', 'acceptance', 'criteria', 'assert',
  'verify', 'checklist', 'exit code', ' green',
];

const QUESTION_TAIL = /[？?]\s*$/;
const QUESTION_WORDS = ['吗', '呢', '怎么', '为什么', '如何', '什么', '哪', '是否', '能不能', '可以吗', 'how', 'why', 'what', 'when', 'which'];

/**
 * 情绪标记。**禁止收录单字 '牛'** —— 它会命中「牛顿」「牛市」等无关词，
 * 实测把「重复牛顿第一定律定义。」判成 emotion（S069 的由来）。情绪词一律
 * 收双字以上、歧义小的整词。
 */
const EMOTION_MARKERS = [
  '谢谢', '辛苦', '多谢', '不错', '很好', '牛啊', '牛逼', '牛皮', '哈哈', '抱歉',
  '不好意思', '晕', '服了', '离谱', '绝了', '加油', '我累', '烦死',
  'thanks', 'thank you', 'nice', 'lol',
];

/** 像粘贴材料：多行、有代码/日志/配置的排版特征，且不像是直接对模型说话。 */
function looksLikeMaterial(text) {
  const lines = text.split('\n');
  if (lines.length < 6) return false;
  const codeish = lines.filter((line) =>
    /^\s*([$>#|]|\d+\s|[-*+]\s|\/\/|#|```|import |export |function |const |return |> )/.test(line),
  ).length;
  const longish = lines.filter((line) => line.length > 60).length;
  return codeish >= 3 || longish >= 4;
}

function autoValue3(text) {
  const lowered = text.toLowerCase();
  const hasAcceptance = ACCEPTANCE_MARKERS.some((m) => lowered.includes(m.toLowerCase()));
  const hasObligation = OBLIGATION_MARKERS.some((m) => lowered.includes(m.toLowerCase()));
  if (hasAcceptance) return 'acceptance';
  if (hasObligation) return 'instruction';
  return 'none';
}

function autoType(text) {
  const trimmed = text.trim();
  const lowered = trimmed.toLowerCase();
  // 提问：句末问号，或**短句**里的疑问词。长文本里出现「什么/怎么」几乎都是
  // 叙述的一部分（实测把整份任务书判成 question），所以疑问词只在短句生效。
  if (QUESTION_TAIL.test(trimmed)) return 'question';
  if (trimmed.length <= 200 && QUESTION_WORDS.some((w) => lowered.includes(w))) return 'question';
  if (trimmed.length <= 400 && EMOTION_MARKERS.some((m) => lowered.includes(m.toLowerCase()))) return 'emotion';
  if (looksLikeMaterial(trimmed) || trimmed.length > 2000) return 'material';
  return 'process';
}

// ── 扫描 + 抽样 ────────────────────────────────────────────────────────────

function buildPool() {
  const sessions = walkSessions(SESSION_ROOT);
  const pool = [];
  let scanFailures = 0;
  for (const s of sessions) {
    let rows;
    try {
      rows = analyzeSession(s.file, { withText: true }).userRows;
    } catch {
      scanFailures += 1;
      continue;
    }
    for (const row of rows) {
      if (row.provenance !== 'user-turn') continue;
      if (!row.realUserTurn) continue;
      pool.push({
        sessionId: s.sessionId,
        workspace: s.workspace,
        seq: row.seq,
        chars: row.chars,
        text: row.text,
      });
    }
  }
  return { sessions, pool, scanFailures };
}

/** 分档 → 组内按工作区分组 → 种子洗牌 → 工作区轮转取满 PER_BUCKET 条。 */
function stratifiedSample(pool) {
  const byBucket = new Map();
  for (const b of BUCKETS) byBucket.set(b.name, []);
  for (const row of pool) {
    const name = bucketOf(row.chars);
    if (!byBucket.has(name)) byBucket.set(name, []);
    byBucket.get(name).push(row);
  }

  const picked = [];
  for (const b of BUCKETS) {
    const rows = byBucket.get(b.name) ?? [];
    const byWorkspace = new Map();
    for (const row of rows) {
      if (!byWorkspace.has(row.workspace)) byWorkspace.set(row.workspace, []);
      byWorkspace.get(row.workspace).push(row);
    }
    const workspaceNames = [...byWorkspace.keys()].sort();
    const shuffled = new Map();
    workspaceNames.forEach((name, index) => {
      const list = [...byWorkspace.get(name)];
      const rand = mulberry32(SEED + index * 7919 + b.name.length);
      for (let i = list.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rand() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
      shuffled.set(name, { list, cursor: 0 });
    });

    const taken = [];
    let guard = 0;
    while (taken.length < PER_BUCKET && guard < PER_BUCKET * 200) {
      guard += 1;
      let progressed = false;
      for (const name of workspaceNames) {
        if (taken.length >= PER_BUCKET) break;
        const entry = shuffled.get(name);
        if (entry.cursor >= entry.list.length) continue;
        taken.push(entry.list[entry.cursor]);
        entry.cursor += 1;
        progressed = true;
      }
      if (!progressed) break;
    }
    taken.forEach((row, index) => {
      picked.push({ ...row, bucket: b.name, bucketLabel: b.label, rankInBucket: index + 1 });
    });
  }
  return { byBucket, picked };
}

/**
 * 类型补全：分层抽样按池子的自然分布走，而本机 user-turn 池子被测试脚本的
 * 指令行主导，`question` / `emotion` 两类抽不到几条（实测各 1 条）。这两类
 * 是 TASK-9 判定「宽档」的主要来源，样本太少就没法定阈值，所以在**剩余池子**
 * 里按类型各补 TOP_UP_PER_TYPE 条真实消息。
 *
 * 两点纪律：① 补的是真消息，不是编的；② 只用来**定位候选**，类型仍由人工复核
 * 最终裁定（`autoType` 判错的候选会被人工改成正确类型）。前 64 条不受影响 ——
 * 补全只从已抽中的行之外挑选。
 */
const TOP_UP_TYPES = ['question', 'emotion'];
const TOP_UP_PER_TYPE = 4;

function topUpByType(pool, picked) {
  const used = new Set(picked.map((row) => `${row.sessionId}:${row.seq}`));
  const extras = [];
  for (const target of TOP_UP_TYPES) {
    const candidates = pool
      .filter((row) => !used.has(`${row.sessionId}:${row.seq}`))
      .filter((row) => autoType(row.text) === target)
      // 短的优先：复核成本可控，且短句里类型更容易判准。
      .sort((a, b) => a.chars - b.chars || (a.sessionId < b.sessionId ? -1 : 1));
    for (const row of candidates.slice(0, TOP_UP_PER_TYPE)) {
      used.add(`${row.sessionId}:${row.seq}`);
      extras.push({ ...row, bucket: bucketOf(row.chars), bucketLabel: `补 ${target}`, selection: 'type-topup' });
    }
  }
  return extras;
}

// ── 主流程 ─────────────────────────────────────────────────────────────────

function runScan() {
  const { sessions, pool, scanFailures } = buildPool();
  const { byBucket, picked } = stratifiedSample(pool);
  const extras = topUpByType(pool, picked);
  const all = [...picked, ...extras];

  const samples = all.map((row, index) => {
    const truncated = row.text.length > MAX_TEXT_CHARS;
    return {
      id: `S${String(index + 1).padStart(3, '0')}`,
      origin: 'real',
      bucket: row.bucket,
      bucketLabel: row.bucketLabel,
      selection: row.selection ?? 'stratified',
      workspace: row.workspace,
      sessionId: row.sessionId,
      seq: row.seq,
      chars: row.chars,
      text: truncated ? row.text.slice(0, MAX_TEXT_CHARS) : row.text,
      textTruncated: truncated,
      // 人工标注位：复核前为 null，复核后由 --finalize 填入。
      value3: null,
      type: null,
      autoValue3: autoValue3(row.text),
      autoType: autoType(row.text),
      note: '',
    };
  });

  const workspaces = [...new Set(samples.map((s) => s.workspace))];
  const payload = {
    meta: {
      generatedAt: new Date().toISOString(),
      generator: 'case/sample-user-turns.mjs',
      sessionRoot: SESSION_ROOT,
      sessionsScanned: sessions.length,
      sessionsFailed: scanFailures,
      poolTotal: pool.length,
      poolByBucket: Object.fromEntries([...byBucket].map(([k, v]) => [k, v.length])),
      perBucket: PER_BUCKET,
      seed: SEED,
      stratifiedCount: picked.length,
      topUpCount: extras.length,
      topUpPerType: TOP_UP_PER_TYPE,
      workspacesCovered: workspaces.length,
      buckets: BUCKETS.map((b) => ({ name: b.name, label: b.label })),
      labeling: {
        value3: ['instruction', 'acceptance', 'none'],
        types: ['process', 'question', 'emotion', 'material'],
        method: '规则初判（autoValue3/autoType）+ 人工逐条复核覆盖（value3/type）',
        reviewedAt: null,
      },
    },
    samples,
    missFixtures: [],
    longLists: [],
  };
  writeFileSync(FIXTURES, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  writeFileSync(REVIEW, renderReview(payload), 'utf8');

  console.log(JSON.stringify({
    mode: 'scan',
    sessionsScanned: sessions.length,
    sessionsFailed: scanFailures,
    poolTotal: pool.length,
    poolByBucket: Object.fromEntries([...byBucket].map(([k, v]) => [k, v.length])),
    sampled: samples.length,
    stratifiedCount: picked.length,
    topUpCount: extras.length,
    workspacesCovered: workspaces.length,
    fixturesFile: FIXTURES.pathname,
    reviewFile: REVIEW.pathname,
  }, null, 2));
}

function renderReview(payload) {
  const lines = [];
  lines.push('# TASK-11 样本复核表（人工标注用）');
  lines.push('');
  lines.push(`生成：${payload.meta.generatedAt}`);
  lines.push(`池子：${payload.meta.poolTotal} 条 user-turn（会话 ${payload.meta.sessionsScanned} 个，失败 ${payload.meta.sessionsFailed}）`);
  lines.push(`抽样：每档 ${payload.meta.perBucket} 条 × 4 档 = ${payload.samples.length} 条，覆盖 ${payload.meta.workspacesCovered} 个工作区`);
  lines.push('');
  lines.push('标注口径：');
  lines.push('- `value3` 三值：`instruction` 指令（有硬约束，丢了会偏离）/ `acceptance` 验收标准（完成判据）/ `none` 没有（丢了无害）');
  lines.push('- `type` 四类型：`process` 过程句 / `question` 提问 / `emotion` 情绪 / `material` 材料（粘贴的日志/代码/文档）');
  lines.push('');
  lines.push('| id | 档 | 工作区 | 字符 | 自动三值 | 自动类型 | 人工三值 | 人工类型 | 备注 |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const s of payload.samples) {
    lines.push(`| ${s.id} | ${s.bucketLabel} | ${s.workspace} | ${s.chars} | ${s.autoValue3} | ${s.autoType} |  |  |  |`);
  }
  lines.push('');
  lines.push('## 原文（逐条复核用）');
  lines.push('');
  for (const s of payload.samples) {
    lines.push(`### ${s.id} · ${s.bucketLabel} · ${s.chars} 字符 · 自动(${s.autoValue3}/${s.autoType})`);
    lines.push('');
    lines.push('```text');
    lines.push(s.text.length > 1200 ? `${s.text.slice(0, 1200)}\n…（复核表截断，完整原文见 fixtures JSON）` : s.text);
    lines.push('```');
    lines.push('');
  }
  return lines.join('\n');
}

function runFinalize(labelsPath) {
  const payload = JSON.parse(readFileSync(FIXTURES, 'utf8'));
  const authored = JSON.parse(readFileSync(labelsPath, 'utf8'));
  const labels = authored.labels ?? {};
  let missing = 0;
  let overridden = 0;
  for (const sample of payload.samples) {
    const entry = labels[sample.id];
    if (!entry || !entry.value3 || !entry.type) {
      missing += 1;
      continue;
    }
    if (sample.autoValue3 !== entry.value3 || sample.autoType !== entry.type) overridden += 1;
    sample.value3 = entry.value3;
    sample.type = entry.type;
    sample.note = entry.note ?? '';
  }
  payload.missFixtures = authored.missFixtures ?? [];
  payload.longLists = authored.longLists ?? [];
  payload.meta.labeling.reviewedAt = new Date().toISOString();
  payload.meta.labeling.autoOverridden = overridden;
  payload.meta.labeling.unlabeled = missing;
  payload.meta.labeling.missFixtureCount = payload.missFixtures.length;
  payload.meta.labeling.longListCount = payload.longLists.length;
  writeFileSync(FIXTURES, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  const byValue3 = {};
  const byType = {};
  for (const s of payload.samples) {
    if (s.value3) byValue3[s.value3] = (byValue3[s.value3] ?? 0) + 1;
    if (s.type) byType[s.type] = (byType[s.type] ?? 0) + 1;
  }
  console.log(JSON.stringify({
    mode: 'finalize',
    samples: payload.samples.length,
    unlabeled: missing,
    autoOverridden: overridden,
    byValue3,
    byType,
    missFixtures: payload.missFixtures.length,
    longLists: payload.longLists.length,
  }, null, 2));
}

function main() {
  const flag = process.argv.find((a) => a === '--finalize');
  if (flag) {
    const idx = process.argv.indexOf(flag);
    const target = process.argv[idx + 1];
    if (!target) throw new Error('--finalize 需要一个标注文件路径');
    runFinalize(target);
    return;
  }
  runScan();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
