/**
 * TASK-3 遗留补测 —— `agent/inbox/spliced` 通道的覆盖缺口到底有多大。
 *
 * 背景：插桩挂在 `bcdsh/src/messages.ts` 的 `classifySurfaceEvent` 上，它只对
 * `user/message` 这类 **surface 事件** 生效。而 `agent/inbox/spliced` 事件
 * 的 `data.inserted` 里装的是**消息对象**（`{id, role, content, source}`），
 * 不是 surface 事件，永远不会经过那个分类器 —— 线上活采集会整条漏掉。
 *
 * 本脚本回答三个问题（全部只靠真实会话数据）：
 *   ① spliced 通道有多少消息、多少字符；按 source.kind 怎么分布；
 *   ② 这些消息里，有多少后来也以 `user/message` 出现（重叠）、
 *      有多少**只**在 spliced 出现（独有）—— 独有的才是插桩现在漏掉的；
 *   ③ 独有条目是不是"真内容"（进模型上下文）还是"输入框中间态"（用户打了又删）。
 *
 * 判重口径与 `case/replay-trace.ts` 同源：先按消息 id，再按前 120 字符指纹
 * （fp120），指纹不归一化空白。
 *
 * 用法：node case/spliced-channel-coverage.mjs [会话目录] [取几个会话]
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readSessionEvents } from './session-read.mjs';

const FP_CHARS = 120;
const TEXT_TYPES = new Set(['text']);

/** 取会话目录下体积最大的 N 个 v4 会话文件。 */
function pickSessions(root, topN) {
  const out = [];
  for (const ws of readdirSync(root, { withFileTypes: true })) {
    if (!ws.isDirectory()) continue;
    const wsDir = join(root, ws.name);
    for (const sid of readdirSync(wsDir, { withFileTypes: true })) {
      if (!sid.isDirectory()) continue;
      const file = join(wsDir, sid.name, 'session.v4.jsonl.zstd');
      try {
        out.push({ file, size: statSync(file).size, ws: ws.name });
      } catch {
        /* 该会话没有 v4 文件 */
      }
    }
  }
  return out.sort((a, b) => b.size - a.size).slice(0, topN);
}

/** 文本块的字符拼接；与 `messages.extractText` 同语义（字符串原样 + text 块累加）。 */
function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  let out = '';
  for (const part of content) {
    if (part === null || typeof part !== 'object') continue;
    if (TEXT_TYPES.has(part.type) && typeof part.text === 'string') out += part.text;
  }
  return out;
}

/** source 的可读标签：`plugin:<name>` / 直接 kind / none。 */
function sourceLabel(source) {
  if (source === null || typeof source !== 'object') return 'none';
  if (source.kind === 'plugin' && typeof source.plugin === 'string' && source.plugin) {
    return 'plugin:' + source.plugin;
  }
  if (typeof source.kind === 'string' && source.kind.length > 0) return source.kind;
  return 'unknown';
}

/** 一条 spliced 插入消息的归一化形状。 */
function normalizeInserted(message) {
  if (message === null || typeof message !== 'object') return null;
  const text = textOf(message.content);
  if (text.length === 0) return null;
  return {
    id: typeof message.id === 'string' ? message.id : '',
    role: typeof message.role === 'string' ? message.role : 'unknown',
    source: sourceLabel(message.source),
    text,
    fp: text.slice(0, FP_CHARS),
  };
}

function analyze(file) {
  const { events } = readSessionEvents(file);

  // ① 先收 user/message 的 id 与指纹 —— 用来判"重叠"（同一条消息被记了两次）。
  const userIds = new Set();
  const userFps = new Set();
  let userMessageCount = 0;
  for (const event of events) {
    if (event.type !== 'user/message') continue;
    userMessageCount += 1;
    const data = event.data ?? {};
    if (typeof data.id === 'string' && data.id) userIds.add(data.id);
    const text = textOf(data.content);
    if (text.length > 0) userFps.add(text.slice(0, FP_CHARS));
  }

  // ② 再收 spliced 通道。
  let splicedEvents = 0;
  let splicedEmpty = 0; // inserted 为空、只有 removedCount 的"删除/替换"型事件
  let splicedInserted = 0;
  let insertedNoText = 0;
  const bySource = new Map(); // sourceLabel -> {条数, 字符}
  const overlap = []; // 之后也以 user/message 出现
  const unique = []; // 只在 spliced 出现 —— 这就是插桩现在漏掉的
  for (const event of events) {
    if (event.type !== 'agent/inbox/spliced') continue;
    splicedEvents += 1;
    const inserted = event.data?.inserted;
    if (!Array.isArray(inserted) || inserted.length === 0) {
      splicedEmpty += 1;
      continue;
    }
    for (const message of inserted) {
      splicedInserted += 1;
      const normalized = normalizeInserted(message);
      if (normalized === null) {
        insertedNoText += 1;
        continue;
      }
      const stats = bySource.get(normalized.source) ?? { count: 0, chars: 0 };
      stats.count += 1;
      stats.chars += normalized.text.length;
      bySource.set(normalized.source, stats);
      const seen =
        (normalized.id !== '' && userIds.has(normalized.id)) || userFps.has(normalized.fp);
      if (seen) overlap.push(normalized);
      else unique.push(normalized);
    }
  }

  return {
    file,
    userMessageCount,
    splicedEvents,
    splicedEmpty,
    splicedInserted,
    insertedNoText,
    bySource: Object.fromEntries(
      [...bySource.entries()].sort((a, b) => b[1].chars - a[1].chars),
    ),
    overlap: {
      count: overlap.length,
      chars: overlap.reduce((sum, item) => sum + item.text.length, 0),
      bySource: countBy(overlap, 'source'),
    },
    unique: {
      count: unique.length,
      chars: unique.reduce((sum, item) => sum + item.text.length, 0),
      bySource: countBy(unique, 'source'),
      samples: unique
        .slice()
        .sort((a, b) => b.text.length - a.text.length)
        .slice(0, 5)
        .map((item) => ({
          source: item.source,
          role: item.role,
          chars: item.text.length,
          head: item.text.slice(0, 70).replace(/\s+/g, ' '),
        })),
    },
  };
}

function countBy(list, key) {
  const out = {};
  for (const item of list) {
    const name = item[key];
    const stats = out[name] ?? { count: 0, chars: 0 };
    stats.count += 1;
    stats.chars += item.text.length;
    out[name] = stats;
  }
  return out;
}

const root = process.argv[2] ?? join(process.env.HOME ?? '', '.dsh', 'sessions');
const topN = Number(process.argv[3] ?? 20);
const sessions = pickSessions(root, topN);

const results = sessions.map((session) => analyze(session.file));

const sum = (fn) => results.reduce((acc, item) => acc + fn(item), 0);
const mergeSources = (key) => {
  const merged = {};
  for (const result of results) {
    for (const [name, stats] of Object.entries(result[key].bySource)) {
      const target = merged[name] ?? { count: 0, chars: 0 };
      target.count += stats.count;
      target.chars += stats.chars;
      merged[name] = target;
    }
  }
  return Object.fromEntries(Object.entries(merged).sort((a, b) => b[1].chars - a[1].chars));
};

const totalUnique = sum((r) => r.unique.count);
const totalUniqueChars = sum((r) => r.unique.chars);
const totalOverlap = sum((r) => r.overlap.count);
const totalOverlapChars = sum((r) => r.overlap.chars);

const report = {
  generatedAt: new Date().toISOString(),
  sessionsRoot: root,
  sessionsAnalyzed: results.length,
  totals: {
    userMessages: sum((r) => r.userMessageCount),
    splicedEvents: sum((r) => r.splicedEvents),
    splicedEmptyEvents: sum((r) => r.splicedEmpty),
    splicedInsertedMessages: sum((r) => r.splicedInserted),
    insertedWithoutText: sum((r) => r.insertedNoText),
    overlapWithUserMessage: {
      count: totalOverlap,
      chars: totalOverlapChars,
      bySource: mergeSources('overlap'),
    },
    uniqueToSpliced: {
      count: totalUnique,
      chars: totalUniqueChars,
      bySource: mergeSources('unique'),
    },
  },
  perSession: results.map((r) => ({
    session: r.file.split(/[\\/]/).slice(-2)[0],
    userMessages: r.userMessageCount,
    splicedEvents: r.splicedEvents,
    splicedEmptyEvents: r.splicedEmpty,
    splicedInserted: r.splicedInserted,
    overlap: r.overlap.count,
    unique: r.unique.count,
    uniqueChars: r.unique.chars,
  })),
  uniqueSamples: results
    .flatMap((r) => r.unique.samples.map((s) => ({ session: r.file.split(/[\\/]/).slice(-2)[0], ...s })))
    .slice(0, 20),
};

console.log(JSON.stringify(report, null, 2));
