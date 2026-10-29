/**
 * TASK-7 —— 来源标签的两条相反方向（计划书 §2 高危 1）。
 *
 * 同一个 `provenance === undefined`，两处消费方必须给出**相反**的答案：
 *
 * | 消费方 | 无标签 | 失效后果 | 所以 |
 * |---|---|---|---|
 * | 保真门 `isQuoteFidelitySource` | 跳过检查 | 少查一次，无害且可见 | 放开 |
 * | 保护名单 `isUserVerbatimProvenance` | 继续保护 | 静默丢掉对用户消息的保护 | 收紧 |
 *
 * 判别口诀：先问这层失效是「没查」还是「没保」——前者放开，后者收紧。
 * 这个文件把两条放在一处，是为了让人改其中一边时能立刻看到另一边。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { isQuoteFidelitySource } from "../src/compress.js";
import { collectUserVerbatimIds, isUserVerbatimProvenance, prune } from "../src/prune.js";
import { createInitialState } from "../src/state.js";
import type { CoreMessage, MessageProvenance } from "../src/types.js";

const ALL_PROVENANCES: MessageProvenance[] = [
  "user-turn",
  "user-material",
  "host-policy",
  "host-content",
  "engine-metadata",
  "checkpoint",
  "relay",
];

function user(
  id: string,
  provenance?: MessageProvenance,
  text = "必须用 pnpm 安装依赖，不要用 npm。",
): CoreMessage {
  return provenance === undefined
    ? { id, role: "user", contentType: "text", text }
    : { id, role: "user", contentType: "text", text, provenance };
}

test("方向对照：同一批来源在两处的答案", () => {
  const gateAnswer = new Map(
    ALL_PROVENANCES.map((p) => [p, isQuoteFidelitySource(p)]),
  );
  const protectAnswer = new Map(
    ALL_PROVENANCES.map((p) => [p, isUserVerbatimProvenance(p)]),
  );

  assert.deepEqual(
    Object.fromEntries(gateAnswer),
    {
      "user-turn": true,
      "user-material": true,
      "host-policy": false,
      "host-content": false,
      "engine-metadata": false,
      checkpoint: false,
      relay: false,
    },
    "保真门只查用户本人与用户材料",
  );
  assert.deepEqual(
    Object.fromEntries(protectAnswer),
    {
      "user-turn": true,
      "user-material": true,
      "host-policy": false,
      "host-content": false,
      "engine-metadata": false,
      checkpoint: false,
      relay: false,
    },
    "保护名单同样只保护用户本人与用户材料",
  );
});

test("★方向相反：无标签时保真门放开、保护名单收紧", () => {
  assert.equal(
    isQuoteFidelitySource(undefined),
    false,
    "保真门无标签 → 跳过检查（fail-open）",
  );
  assert.equal(
    isUserVerbatimProvenance(undefined),
    true,
    "保护名单无标签 → 继续保护（RL-4）。省掉这个分支就是静默失效",
  );
  assert.notEqual(
    isQuoteFidelitySource(undefined),
    isUserVerbatimProvenance(undefined),
    "两处必须相反；相等说明有人照抄了另一边",
  );
});

test("AC-7.5 保护名单收窄：注入行不再占用原文保护名额", () => {
  const messages: CoreMessage[] = [
    user("u1"),
    user("u2", "host-policy"),
    user("u3", "host-content"),
    user("u4", "checkpoint"),
    user("u5"),
  ];
  const ids = collectUserVerbatimIds(messages, 0);
  assert.deepEqual([...ids].sort(), ["u1", "u5"]);
});

test("AC-7.5 方案 B：keep=N 只数用户发言，注入行不占名额", () => {
  const messages: CoreMessage[] = [
    user("u1"),
    user("u2", "host-policy"),
    user("u3", "checkpoint"),
    user("u4"),
    user("u5"),
  ];
  // 最近 2 条"用户发言"是 u4/u5；注入行不算，所以 u1 释放进压缩。
  assert.deepEqual([...collectUserVerbatimIds(messages, 2)].sort(), ["u4", "u5"]);
});

test("RL-4 端到端：无标签的 user 消息仍然被 prune 保留", () => {
  const messages: CoreMessage[] = [
    user("u1", undefined, "老数据：没有来源标签的用户消息。"),
    user("u2", "host-policy", "AGENTS.md 注入行。"),
    { id: "a1", role: "assistant", contentType: "text", text: "ok" },
  ];
  const state = createInitialState();
  // 手工造一个覆盖 u1/u2/a1 的块，prune 才有东西可裁。
  state.blocks.push({
    blockId: "b1",
    runId: "r1",
    tier: 1,
    summary: "摘要",
    directMessageIds: ["u1", "u2", "a1"],
    effectiveMessageIds: ["u1", "u2", "a1"],
    directBlockIds: [],
    compressedTokens: 10,
    createdAt: 0,
    survivedCount: 0,
    generation: "young",
    active: true,
  });
  const out = prune(messages, state, { userVerbatimKeep: 0 });
  const keptIds = out.map((message) => message.id);
  assert.ok(
    keptIds.includes("u1"),
    "无标签的 user 消息必须保留在视图里（RL-4）",
  );
  assert.ok(
    !keptIds.includes("u2"),
    "host-policy 注入行不再受原文保护，可以被块摘要取代",
  );
});
