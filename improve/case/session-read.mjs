/**
 * 读 DSH v4 会话文件（多 zstd frame 串联，append-only 写入）。
 *
 * 会话文件每次 append 写一个独立 zstd frame，所以 `zstdDecompressSync` 只能解出
 * 第一帧（实测 19MB 文件只解出 187 字节的 session header）。这里按 zstd 的
 * frame magic（28 B5 2F FD）扫描切分，逐帧解压后拼接。
 *
 * 误切保护：magic 也可能作为压缩数据的一部分出现，所以某段解压失败时把它并进
 * 下一段重试；连续合并仍失败则整段跳过并计数，绝不静默产出半截数据。
 */
import { readFileSync } from 'node:fs';
import { zstdDecompressSync } from 'node:zlib';

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

export function readSessionEvents(filePath) {
  const raw = readFileSync(filePath);
  const offsets = [];
  let from = 0;
  for (;;) {
    const at = raw.indexOf(MAGIC, from);
    if (at === -1) break;
    offsets.push(at);
    from = at + MAGIC.length;
  }
  if (offsets.length === 0) throw new Error(`no zstd frame magic in ${filePath}`);

  const parts = [];
  const failures = [];
  let i = 0;
  while (i < offsets.length) {
    let decoded = null;
    let j = i;
    while (j < offsets.length) {
      const end = j + 1 < offsets.length ? offsets[j + 1] : raw.length;
      try {
        decoded = zstdDecompressSync(raw.subarray(offsets[i], end));
        break;
      } catch {
        j += 1;
      }
    }
    if (decoded === null) {
      failures.push(offsets[i]);
      i += 1;
      continue;
    }
    parts.push(decoded);
    i = j + 1;
  }

  const text = Buffer.concat(parts).toString('utf8');
  const events = [];
  let badLines = 0;
  for (const line of text.split('\n')) {
    if (!line) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      badLines += 1;
    }
  }
  return { events, frames: offsets.length, failures, badLines, bytes: text.length };
}
