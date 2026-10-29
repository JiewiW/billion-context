import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createCore,
  defaultConfig,
  defaultCountTokens,
  type CoreMessage,
  type SessionState,
} from "../src/index.js";

function msg(
  id: string,
  text: string,
  overrides: Partial<CoreMessage> = {},
): CoreMessage {
  return {
    id,
    role: "user",
    contentType: "text",
    text,
    ...overrides,
  };
}

function toolCall(
  id: string,
  callId: string,
  toolName: string,
  args: string,
): CoreMessage {
  return {
    id,
    role: "assistant",
    contentType: "tool-call",
    toolName,
    toolCallId: callId,
    text: args,
  };
}

function toolResult(id: string, callId: string, text: string): CoreMessage {
  return {
    id,
    role: "tool",
    contentType: "tool-result",
    toolCallId: callId,
    text,
  };
}

function setupRefs(
  messages: CoreMessage[],
  state: SessionState,
  config: ReturnType<typeof defaultConfig>,
): SessionState {
  const core = createCore();
  const result = core.processTurn({
    messages,
    state,
    config,
    tokenCount: 0,
    countTokens: defaultCountTokens,
  });
  return result.state;
}

const longText = "x".repeat(6000);
const validSummary = "x".repeat(60);

test("Bug 1: protected tool messages are filtered (no summary inflation)", () => {
  // Was: "maxSummaryLength enforced after appending protected content" — that
  // append-and-recheck behavior is gone. Protected messages are dropped from
  // the compressed set; the summary is exactly what the author wrote, so a
  // large protected tool output can never inflate/reject the summary.
  const core = createCore();
  // 本用例不验 user 语义（验的是保护消息被剔除后摘要不被撑大），占位消息给
  // assistant：role=user 会被 userVerbatimKeep 原文保护钉住，落在压缩范围里
  // 会直接抛错、块建不出来。
  const messages: CoreMessage[] = [
    msg("a", longText, { role: "assistant" }),
    toolCall("b", "call1", "skill", '{"action":"read"}'),
    toolResult("c", "call1", "y".repeat(50000)),
    msg("d", longText, { role: "assistant" }),
  ];
  const config = defaultConfig(200000, {
    protectedTools: ["skill"],
    compress: {
      minCompressRange: 0,
      maxSummaryLength: 100,
      minSummaryLength: 0,
    },
    preserveRecentMessages: 0,
    preserveRecentTokens: 0,
  });
  let state = setupRefs(
    messages,
    {
      blocks: [],
      prune: { byMessageId: {}, activeBlockIds: [] },
      messageRefs: { byRaw: {}, byRef: {} },
      nudge: {
        lastPerMessageNudgeTokens: 0,
        lastNudgeShownTokens: 0,
        pendingNudgeTurn: null,
        baselineTokens: 0,
      },
      stats: { totalTokensCompressed: 0 },
      compressionTiming: {},
    },
    config,
  );

  const result = core.applyCompression({
    ranges: [{ startRef: "m00001", endRef: "m00003", summary: "short" }],
    messages,
    state,
    config,
    countTokens: defaultCountTokens,
  });

  assert.equal(
    result.result.blocksCreated,
    1,
    "compression succeeds — no length error",
  );
  assert.equal(result.result.errors.length, 0, "no errors");
  const block = result.state.blocks[0]!;
  assert.equal(block.summary, "short", "summary is exactly the author's text");
  assert.ok(
    !block.directMessageIds.includes("b"),
    "protected skill call excluded",
  );
  assert.ok(
    !block.directMessageIds.includes("c"),
    "protected skill result excluded",
  );
  assert.ok(block.directMessageIds.includes("a"), "regular msg compressed");
  assert.ok(block.directMessageIds.includes("d"), "regular msg compressed");
});

test("Bug 2: orphaned tool-call — protected call outside range, result inside", () => {
  const core = createCore();
  // 本用例不验 user 语义（验的是孤儿的受保护调用不被算进块），占位消息给
  // assistant 以保证下方注释里的 ref 编号（b=m00001, c, d）仍然成立。
  const messages: CoreMessage[] = [
    toolCall("a", "call1", "skill", '{"action":"git"}'),
    toolResult("b", "call1", "secret output"),
    msg("c", longText, { role: "assistant" }),
    msg("d", longText, { role: "assistant" }),
  ];
  const config = defaultConfig(200000, {
    protectedTools: ["skill"],
    compress: { minCompressRange: 0, maxSummaryLength: 0, minSummaryLength: 0 },
    preserveRecentMessages: 0,
    preserveRecentTokens: 0,
  });
  let state = setupRefs(
    messages,
    {
      blocks: [],
      prune: { byMessageId: {}, activeBlockIds: [] },
      messageRefs: { byRaw: {}, byRef: {} },
      nudge: {
        lastPerMessageNudgeTokens: 0,
        lastNudgeShownTokens: 0,
        pendingNudgeTurn: null,
        baselineTokens: 0,
      },
      stats: { totalTokensCompressed: 0 },
      compressionTiming: {},
    },
    config,
  );

  // 'a' (protected skill call) is BLOCKED, so refs are: b=m00001, c=m00002, d=m00003
  // Compress m00001->m00003 covers b(result), c, d — b's call 'a' is outside range
  const result = core.applyCompression({
    ranges: [{ startRef: "m00001", endRef: "m00003", summary: validSummary }],
    messages,
    state,
    config,
    countTokens: defaultCountTokens,
  });

  assert.equal(result.result.blocksCreated, 1);
  const block = result.state.blocks[0]!;
  // b (the orphaned result of protected call 'a') should NOT be in directMessageIds
  assert.ok(!block.directMessageIds.includes("b"));
});

test("Bug 3: defaultConfig deep-merges nested config objects", () => {
  const config = defaultConfig(200000, {
    compress: { minSummaryLength: 100 },
  });
  // minSummaryLength overridden
  assert.equal(config.compress.minSummaryLength, 100);
  // Other compress fields preserved (not undefined)
  assert.equal(config.compress.minCompressRange, 5000);
  assert.equal(config.compress.maxSummaryLength, 20000);
});

test("Bug 4: assignRefsNode marks wildcard-matched tools as BLOCKED", () => {
  const core = createCore();
  const messages: CoreMessage[] = [
    // 本用例只验 assignRefsNode 把命中的工具标成 BLOCKED，不验 user 语义；
    // 占位消息给 assistant 以免受保护后退成 BLOCKED、挤掉 mNNNNN 编号。
    msg("a", "hello", { role: "assistant" }),
    toolCall("b", "call1", "skill-git-master", '{"action":"status"}'),
    msg("c", "world", { role: "assistant" }),
  ];
  const config = defaultConfig(200000, {
    protectedTools: ["skill-*"],
  });
  const result = core.processTurn({
    messages,
    state: {
      blocks: [],
      prune: { byMessageId: {}, activeBlockIds: [] },
      messageRefs: { byRaw: {}, byRef: {} },
      nudge: {
        lastPerMessageNudgeTokens: 0,
        lastNudgeShownTokens: 0,
        pendingNudgeTurn: null,
        baselineTokens: 0,
      },
      stats: { totalTokensCompressed: 0 },
      compressionTiming: {},
    },
    config,
    tokenCount: 0,
    countTokens: defaultCountTokens,
  });

  assert.equal(result.state.messageRefs.byRaw["b"], "BLOCKED");
  assert.equal(result.state.messageRefs.byRaw["a"], "m00001");
  assert.equal(result.state.messageRefs.byRaw["c"], "m00002");
});

test("Bug 4: assignRefsNode marks predicate-matched tools as BLOCKED", () => {
  const core = createCore();
  const messages: CoreMessage[] = [
    // 同上一个用例：占位消息给 assistant，保证 BLOCKED 只由工具保护产生，
    // 周围消息的 ref 编号不被 userVerbatimKeep 影响。
    msg("a", "hello", { role: "assistant" }),
    toolCall("b", "call1", "custom-tool", '{"path":"/secret/.env"}'),
    msg("c", "world", { role: "assistant" }),
  ];
  const config = defaultConfig(200000, {
    isToolProtected: (_toolName: string, toolInputText?: string) =>
      !!toolInputText?.includes(".env"),
  });
  const result = core.processTurn({
    messages,
    state: {
      blocks: [],
      prune: { byMessageId: {}, activeBlockIds: [] },
      messageRefs: { byRaw: {}, byRef: {} },
      nudge: {
        lastPerMessageNudgeTokens: 0,
        lastNudgeShownTokens: 0,
        pendingNudgeTurn: null,
        baselineTokens: 0,
      },
      stats: { totalTokensCompressed: 0 },
      compressionTiming: {},
    },
    config,
    tokenCount: 0,
    countTokens: defaultCountTokens,
  });

  assert.equal(result.state.messageRefs.byRaw["b"], "BLOCKED");
  assert.equal(result.state.messageRefs.byRaw["a"], "m00001");
  assert.equal(result.state.messageRefs.byRaw["c"], "m00002");
});
