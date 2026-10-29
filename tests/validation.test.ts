import { test } from "node:test";
import assert from "node:assert/strict";
import { createCore } from "../src/compress.js";
import { createInitialState } from "../src/state.js";
import { assignRefs } from "../src/refs.js";
import { defaultConfig } from "../src/config.js";
import type { CoreMessage } from "../src/types.js";

function msg(
  id: string,
  text: string,
  role: CoreMessage["role"] = "user",
): CoreMessage {
  return { id, role, contentType: "text", text };
}

function setupRefs(messages: CoreMessage[]) {
  const state = createInitialState();
  state.messageRefs = assignRefs(messages, {
    existing: state.messageRefs,
    nextIndex: 1,
  }).map;
  return state;
}

const longText = "x".repeat(6000);
const validSummary =
  "This is a meaningful summary that captures the key information of the compressed range including paths and decisions.";

test("validation: empty summary is rejected", () => {
  const core = createCore();
  const messages = [msg("a", longText), msg("b", longText)];
  const state = setupRefs(messages);
  const config = defaultConfig(200000, {
    preserveRecentMessages: 0,
    preserveRecentTokens: 0,
  });

  const result = core.applyCompression({
    ranges: [{ startRef: "m00001", endRef: "m00002", summary: "" }],
    messages,
    state,
    config,
  });
  assert.equal(result.result.blocksCreated, 0);
  assert.equal(result.result.errors.length, 1);
  assert.match(result.result.errors[0]!, /empty/i);
});

test("validation: whitespace-only summary is rejected", () => {
  const core = createCore();
  const messages = [msg("a", longText), msg("b", longText)];
  const state = setupRefs(messages);
  const config = defaultConfig(200000, {
    preserveRecentMessages: 0,
    preserveRecentTokens: 0,
  });

  const result = core.applyCompression({
    ranges: [{ startRef: "m00001", endRef: "m00002", summary: "   \n\t  " }],
    messages,
    state,
    config,
  });
  assert.equal(result.result.blocksCreated, 0);
  assert.match(result.result.errors[0]!, /empty/i);
});

test("validation: summary below minSummaryLength is rejected", () => {
  const core = createCore();
  const messages = [msg("a", longText), msg("b", longText)];
  const state = setupRefs(messages);
  const config = defaultConfig(200000, {
    preserveRecentMessages: 0,
    preserveRecentTokens: 0,
    compress: {
      minCompressRange: 0,
      maxSummaryLength: 0,
      minSummaryLength: 100,
    },
  });

  const result = core.applyCompression({
    ranges: [{ startRef: "m00001", endRef: "m00002", summary: "too short" }],
    messages,
    state,
    config,
  });
  assert.equal(result.result.blocksCreated, 0);
  assert.match(result.result.errors[0]!, /too short/i);
});

test("validation: summary above maxSummaryLength is rejected", () => {
  const core = createCore();
  const messages = [msg("a", longText), msg("b", longText)];
  const state = setupRefs(messages);
  const config = defaultConfig(200000, {
    preserveRecentMessages: 0,
    preserveRecentTokens: 0,
    compress: {
      minCompressRange: 0,
      maxSummaryLength: 50,
      minSummaryLength: 0,
    },
  });

  const result = core.applyCompression({
    ranges: [{ startRef: "m00001", endRef: "m00002", summary: validSummary }],
    messages,
    state,
    config,
  });
  assert.equal(result.result.blocksCreated, 0);
  assert.match(result.result.errors[0]!, /too long/i);
});

test("validation: range below minCompressRange is rejected", () => {
  const core = createCore();
  const messages = [msg("a", "short"), msg("b", "text")];
  const state = setupRefs(messages);
  const config = defaultConfig(200000, {
    preserveRecentMessages: 0,
    preserveRecentTokens: 0,
    compress: {
      minCompressRange: 5000,
      maxSummaryLength: 0,
      minSummaryLength: 0,
    },
  });

  const result = core.applyCompression({
    ranges: [{ startRef: "m00001", endRef: "m00002", summary: validSummary }],
    messages,
    state,
    config,
  });
  assert.equal(result.result.blocksCreated, 0);
  assert.match(result.result.errors[0]!, /too small/i);
});

test("validation: batch aggregate — many small ranges pass if total >= minCompressRange", () => {
  const core = createCore();
  const chunk = "x".repeat(1200);
  // 本用例不验 user 语义：5 段范围合起来覆盖整个数组（含最后一条 user），方案 B
  // 的任意 N 都救不了它，故占位消息显式给 assistant 以免受原文保护。
  const messages = [
    msg("a", chunk, "assistant"),
    msg("b", chunk, "assistant"),
    msg("c", chunk, "assistant"),
    msg("d", chunk, "assistant"),
    msg("e", chunk, "assistant"),
  ];
  const state = setupRefs(messages);
  const config = defaultConfig(200000, {
    preserveRecentMessages: 0,
    preserveRecentTokens: 0,
    compress: {
      minCompressRange: 5000,
      maxSummaryLength: 0,
      minSummaryLength: 0,
    },
  });

  // 5 separate ranges, each 1200 chars — individually below 5000 but total 6000
  const result = core.applyCompression({
    ranges: [
      { startRef: "m00001", endRef: "m00001", summary: validSummary },
      { startRef: "m00002", endRef: "m00002", summary: validSummary },
      { startRef: "m00003", endRef: "m00003", summary: validSummary },
      { startRef: "m00004", endRef: "m00004", summary: validSummary },
      { startRef: "m00005", endRef: "m00005", summary: validSummary },
    ],
    messages,
    state,
    config,
  });
  assert.equal(result.result.blocksCreated, 5);
  assert.equal(result.result.errors.length, 0);
});

test("validation: range with zero compressible messages (covered by non-nested block) is rejected", () => {
  const core = createCore();
  const messages = [
    msg("a", longText),
    msg("b", longText),
    msg("c", longText),
    msg("d", longText),
  ];
  let state = setupRefs(messages);
  // 只保留最近 1 条 user 原文：压缩范围 m00001..m00003 不含最后一条 user（d），
  // 缺省 0 会把范围内所有 user 钉死、首段压缩失败，后续断言便无从谈起。
  const config = defaultConfig(200000, {
    preserveRecentMessages: 0,
    preserveRecentTokens: 0,
    userVerbatimKeep: 1,
  });

  const first = core.applyCompression({
    ranges: [{ startRef: "m00001", endRef: "m00003", summary: validSummary }],
    messages,
    state,
    config,
  });
  state = first.state;

  // m00002→m00003 maps to b,c. Block b1 covers a,b,c but its anchor is
  // at index 0 (a), outside range [1,2]. So b1 is NOT nested → consumedBlockCount=0.
  // But b,c are in preExistingCoverage → directMessageIds=[]. Validation fires.
  const second = core.applyCompression({
    ranges: [{ startRef: "m00002", endRef: "m00003", summary: validSummary }],
    messages,
    state,
    config,
  });
  assert.equal(second.result.blocksCreated, 0);
  assert.match(second.result.errors[0]!, /no compressible/i);
});

test("validation: block-boundary compress with 0 direct msgs but consumed blocks is allowed", () => {
  const core = createCore();
  const messages = [msg("a", longText), msg("b", longText), msg("c", longText)];
  let state = setupRefs(messages);
  // 只保留最近 1 条 user 原文：首段范围 m00001..m00002 不含最后一条 user（c），
  // 缺省 0 会让首段因原文保护被拒，t2 也就没有 b1 可蒸馏。
  const config = defaultConfig(200000, {
    preserveRecentMessages: 0,
    preserveRecentTokens: 0,
    userVerbatimKeep: 1,
  });

  const t1 = core.applyCompression({
    ranges: [{ startRef: "m00001", endRef: "m00002", summary: validSummary }],
    messages,
    state,
    config,
  });
  state = t1.state;

  const t2 = core.applyCompression({
    ranges: [{ startRef: "b1", endRef: "b1", summary: validSummary }],
    messages,
    state,
    config,
  });
  assert.equal(t2.result.blocksCreated, 1);
  assert.equal(t2.result.errors.length, 0);
  assert.equal(t2.state.blocks[1]!.tier, 2);
});

test("validation: all checks disabled (0s) allows any input", () => {
  const core = createCore();
  // 本用例不验 user 语义：范围 m00001..m00002 覆盖整个数组（含最后一条 user），
  // 方案 B 的任意 N 都救不了它，故占位消息显式给 assistant 以免受原文保护。
  const messages = [msg("a", "x", "assistant"), msg("b", "y", "assistant")];
  const state = setupRefs(messages);
  const config = defaultConfig(200000, {
    preserveRecentMessages: 0,
    preserveRecentTokens: 0,
    compress: { minCompressRange: 0, maxSummaryLength: 0, minSummaryLength: 0 },
  });

  const result = core.applyCompression({
    ranges: [{ startRef: "m00001", endRef: "m00002", summary: "ok" }],
    messages,
    state,
    config,
  });
  assert.equal(result.result.blocksCreated, 1);
  assert.equal(result.result.errors.length, 0);
});

test("validation: errors are collected per-range in batch compress", () => {
  const core = createCore();
  // 本用例不验 user 语义：第二段范围 m00003..m00004 含最后一条 user（d），方案 B
  // 的任意 N 都救不了它，故占位消息显式给 assistant 以免受原文保护。
  const messages = [
    msg("a", longText, "assistant"),
    msg("b", longText, "assistant"),
    msg("c", longText, "assistant"),
    msg("d", longText, "assistant"),
  ];
  const state = setupRefs(messages);
  const config = defaultConfig(200000, {
    preserveRecentMessages: 0,
    preserveRecentTokens: 0,
  });

  const result = core.applyCompression({
    ranges: [
      { startRef: "m00001", endRef: "m00002", summary: "" },
      { startRef: "m00003", endRef: "m00004", summary: validSummary },
    ],
    messages,
    state,
    config,
  });
  assert.equal(result.result.blocksCreated, 1);
  assert.equal(result.result.errors.length, 1);
  assert.match(result.result.errors[0]!, /empty/i);
});
