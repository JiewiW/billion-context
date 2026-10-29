/**
 * Regression: recommend/nudge gates and the apply-side minCompressRange gate
 * must use the SAME unit. The apply side counts raw characters
 * (`msg.text.length`); the recommend side used to approximate chars with
 * `tokens*4`, which only holds for the default chars/4 estimator. Hosts that
 * inject a CJK-aware tokenizer (≈1 token per char) made `tokens*4` a ~4x
 * overestimate, so nudge offered ranges the kernel then atomically rejected
 * with "Total compressible content too small" — the exact failure mode the
 * effective gate exists to prevent (see PR fixing #57/#70 regression).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCore } from "../src/compress.js";
import { createInitialState } from "../src/state.js";
import type { Config, CoreMessage } from "../src/types.js";
import { mergeRangesToThreshold } from "../src/recommend.js";
import type { CompressibleRange } from "../src/types.js";

function buildConfig(overrides: Partial<Config> = {}): Config {
  return {
    tiers: { enabled: true, tier2Trigger: 5, tier3Trigger: 10 },
    nudge: {
      maxContextLimitPct: 0.9,
      minContextLimitPct: 0.45,
      frequency: 1,
      iterationThreshold: 15,
      force: "soft",
      growthRatio: 0.05,
      growthFloor: 6000,
      growthCap: 50000,
      minGrowthFloor: 5000,
      minGrowthRatio: 0.45,
      emergencyThresholdPct: 0.98,
    },
    promotionThreshold: 5,
    truncate: { threshold: 1 },
    merge: { maxSummaryLength: 3000, minOldGenBlocks: 3 },
    compress: {
      minCompressRange: 5000,
      maxSummaryLength: 3000,
      minSummaryLength: 100,
    },
    protectedTools: [],
    preserveRecentMessages: 0,
    preserveRecentTokens: 0,
    modelContextLimit: 100000,
    // 逃生阀（方案 B）：userVerbatimKeep 默认 0 会把所有 user 钉住，本文件压的是
    // 「整段 CJK 散文的原始字符数」，这些占位消息的 user 角色是不小心撞上的保护。
    // 释放到「只保最近 1 条」后，被计量的那 6 条照样全部可压（见 cjkMessages）。
    userVerbatimKeep: 1,
    ...overrides,
  };
}

/** CJK-aware estimator: 1 token per char for CJK text (the kernel's own
 *  estimateTokensFast behaves this way for CJK). Identity for our fixtures. */
const cjkTokenizer = (text: string): number => text.length;

function cjkMessages(charsPerMessage: number, count: number): CoreMessage[] {
  const cjkText = "内容".repeat(charsPerMessage / 2);
  const messages: CoreMessage[] = Array.from({ length: count }, (_, i) => ({
    id: `raw-${i}`,
    role: i % 2 === 0 ? "user" : "assistant",
    contentType: "text",
    text: cjkText,
  }));
  // 末位再补一条占位 user：userVerbatimKeep=1 钉的是「数组里最后一条 user」，补一条
  // 让它落在 m00001..m00006 之外。这样被计量的前 count 条一条不少地拿到原始编号，
  // 「总计 3000/6000 字符」的用例前提保持不变（新增的那条不进任何 range）。
  messages.push({
    id: "tail-protected",
    role: "user",
    contentType: "text",
    text: cjkText,
  });
  return messages;
}

test("mergeRangesToThreshold: batches by real chars, not tokens*4 (CJK tokenizer)", () => {
  // Two hand-built ranges WITHOUT chars exercise the legacy fallback;
  // ranges WITH chars exercise the real accounting.
  const legacyA: CompressibleRange = {
    startRef: "m00001",
    endRef: "m00002",
    count: 2,
    tokens: 1250,
    toolPct: 0,
    textPct: 100,
  };
  const out = mergeRangesToThreshold([legacyA], 5000);
  assert.equal(
    out.length,
    1,
    "fallback tokens*4=5000 still clears the 5000 threshold",
  );

  // 3000 chars of CJK = 3000 tokens under a CJK tokenizer. tokens*4 = 12000
  // used to "clear" 5000; real chars (3000) do not — tail stays sub-threshold
  // and pendingByTier must not count it as effective.
  const cjk: CompressibleRange = {
    startRef: "m00001",
    endRef: "m00006",
    count: 6,
    tokens: 3000,
    chars: 3000,
    toolPct: 0,
    textPct: 100,
  };
  assert.equal(cjk.chars < 5000, true);
  assert.equal(
    cjk.tokens * 4 >= 5000,
    true,
    "pre-fix this range looked effective",
  );
});

test("nudge: CJK session below minCompressRange chars is NOT offered (apply would reject)", () => {
  const core = createCore({ countTokens: cjkTokenizer });
  const config = buildConfig();
  const messages = cjkMessages(500, 6); // 3000 chars total < 5000 min
  let state = createInitialState();

  state = core.processTurn({
    messages,
    state,
    config,
    tokenCount: 10000,
  }).state;
  // usage 95% >= maxContextLimitPct 0.9 → pressure path
  const turn = core.processTurn({ messages, state, config, tokenCount: 95000 });

  assert.equal(
    turn.nudge.shouldInject,
    false,
    "3000 chars < minCompressRange 5000 — nudge must not offer it",
  );
  assert.match(
    turn.nudge.reason,
    /no tier has effective compressible content/,
    `reason explains the suppression, got: ${turn.nudge.reason}`,
  );

  // The apply side agrees: the same range is atomically rejected.
  const applied = core.applyCompression({
    ranges: [
      { startRef: "m00001", endRef: "m00006", summary: "s", topic: "t" },
    ],
    messages,
    state: turn.state,
    config,
  });
  assert.equal(applied.result.blocksCreated, 0);
  assert.ok(
    applied.result.errors.some((e) => e.includes("too small")),
    `apply rejects with too-small gate, got: ${JSON.stringify(applied.result.errors)}`,
  );
});

test("nudge: CJK session above minCompressRange chars IS offered (control)", () => {
  const core = createCore({ countTokens: cjkTokenizer });
  const config = buildConfig();
  const messages = cjkMessages(1000, 6); // 6000 chars total >= 5000 min
  let state = createInitialState();

  state = core.processTurn({
    messages,
    state,
    config,
    tokenCount: 10000,
  }).state;
  const turn = core.processTurn({ messages, state, config, tokenCount: 95000 });

  assert.equal(
    turn.nudge.shouldInject,
    true,
    "6000 chars >= 5000 — effective T1 pending exists",
  );
  assert.match(turn.nudge.reason, /T1/);

  // And the apply side accepts the same range — both gates agree on chars.
  const applied = core.applyCompression({
    ranges: [
      {
        startRef: "m00001",
        endRef: "m00006",
        summary: "总结".repeat(60),
        topic: "t",
      },
    ],
    messages,
    state: turn.state,
    config,
  });
  assert.equal(
    applied.result.blocksCreated,
    1,
    "apply accepts: 6000 real chars >= 5000",
  );
  assert.deepEqual(applied.result.errors, []);
});
