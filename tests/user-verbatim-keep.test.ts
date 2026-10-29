import { test } from "node:test";
import assert from "node:assert/strict";
import { createCore } from "../src/compress.js";
import { createInitialState } from "../src/state.js";
import { assignRefs } from "../src/refs.js";
import { defaultConfig, validateConfig } from "../src/config.js";
import { buildStatusReport } from "../src/report.js";
import type { CoreMessage } from "../src/types.js";

const LIMIT = 100000;
const countTokens = (text: string) => Math.ceil(text.length / 3);

function msg(
  id: string,
  text: string,
  role: CoreMessage["role"] = "user",
): CoreMessage {
  return { id, role, contentType: "text", text };
}

/** 3000 token 的大块用户指令。 */
const BIG_USER = "u".repeat(9000);
/** 10000 token 的填充块，用来把「最近 tokens 窗口」压在末尾一两条上。 */
const FILLER = "f".repeat(30000);

/**
 * 布局设计：前 7 条（idx 0..6）落在「最近 5 条 + 最近 5000 token」窗口之外，
 * 因此它们的可压缩性只由 userVerbatimKeep 决定，不被 preserveRecentMessages /
 * preserveRecentTokens 的软保护区提前拦下。末尾 5 条是纯 assistant 填充块，
 * 单条即超过 5000 token，保证 token 窗口不向前蔓延。
 *
 *   idx  role       id   说明
 *   0    assistant  a0
 *   1    user       u1   最老的 user
 *   2    assistant  a1
 *   3    user       u2   中间那条 user
 *   4    assistant  a2
 *   5    user       u3   三条里最新的 user（也是全场最近 user）
 *   6    assistant  a3
 *   7..11 assistant a4..a8  填充（最近 5 条保护窗口）
 */
function buildMessages(): CoreMessage[] {
  return [
    msg("a0", "start", "assistant"),
    msg("u1", BIG_USER),
    msg("a1", "ok", "assistant"),
    msg("u2", BIG_USER),
    msg("a2", "ok2", "assistant"),
    msg("u3", BIG_USER),
    msg("a3", "ok3", "assistant"),
    msg("a4", FILLER, "assistant"),
    msg("a5", FILLER, "assistant"),
    msg("a6", FILLER, "assistant"),
    msg("a7", FILLER, "assistant"),
    msg("a8", FILLER, "assistant"),
  ];
}

function stateWithRefs(messages: CoreMessage[]) {
  const state = createInitialState();
  state.messageRefs = assignRefs(messages, {
    existing: state.messageRefs,
    nextIndex: 1,
  }).map;
  return state;
}

const SUMMARY =
  "The assistant started the job and the user then stated a long requirement.";

function compressRange(
  config: ReturnType<typeof defaultConfig>,
  startRef: string,
  endRef: string,
) {
  const messages = buildMessages();
  return createCore().applyCompression({
    ranges: [{ startRef, endRef, summary: SUMMARY }],
    messages,
    state: stateWithRefs(messages),
    config,
  });
}

test("AC-2.1 default config: compressing a user message fails loud and names its id", () => {
  const cfg = defaultConfig(LIMIT);
  assert.equal(cfg.userVerbatimKeep, 0, "默认必须是 0（方案 A，RL-6）");

  // m00001..m00002 = a0(assistant) + u1(user)。u1 在最近 5 条与最近 5000 token
  // 窗口之外，所以拒绝的唯一理由只能来自 userVerbatimKeep。
  const out = compressRange(cfg, "m00001", "m00002");
  assert.equal(out.result.blocksCreated, 0, "不得静默压掉受保护 user 消息");
  assert.equal(out.result.errors.length, 1, "必须留一条可归因的错误（RL-4）");
  assert.match(
    out.result.errors[0]!,
    /Cannot compress user message\(s\) u1/,
    "错误串必须点名具体消息 id",
  );
  assert.match(out.result.errors[0]!, /userVerbatimKeep=0/);
});

test("AC-2.1b 同一条范围里的 assistant 部分也不能掩护 user 消息蒙混过关", () => {
  const cfg = defaultConfig(LIMIT);
  // 范围扩到 a0..a2（跨 u1、u2 两条 user）
  const out = compressRange(cfg, "m00001", "m00004");
  assert.equal(out.result.blocksCreated, 0);
  assert.match(out.result.errors[0]!, /u1/);
  assert.match(out.result.errors[0]!, /u2/);
});

test("AC-2.2 userVerbatimKeep=2 releases the 3rd-oldest user, still guards the last two", () => {
  const cfg = defaultConfig(LIMIT, { userVerbatimKeep: 2 });

  // 第 3 老的 user = u1 → 可进压缩范围，不报错
  const released = compressRange(cfg, "m00001", "m00002");
  assert.equal(
    released.result.blocksCreated,
    1,
    "u1 已被逃生阀释放，应当真的压出块",
  );
  assert.deepEqual(released.result.errors, []);

  // 最近的 2 条 user = u2 / u3 → 仍抛错
  const guarded = compressRange(cfg, "m00003", "m00004");
  assert.equal(guarded.result.blocksCreated, 0);
  assert.match(
    guarded.result.errors[0]!,
    /Cannot compress user message\(s\) u2/,
    "u2 仍在保护集合内，错误要点名它",
  );
  assert.match(guarded.result.errors[0]!, /userVerbatimKeep=2/);

  // u3 是三条里最新的 user，同时也是全场最近 user：它同时命中「user 原文保护」
  // 与「最近 user」软保护区。单独成范围时必须整段拒绝，不产出块。
  const newest = compressRange(cfg, "m00006", "m00006");
  assert.equal(newest.result.blocksCreated, 0, "最新的 user 单独成范围必须被拒");
  assert.equal(newest.result.errors.length, 1, "拒绝必须留信号，不能静默");
});

test("AC-2.2b 不变量：任何受保护 user 消息都不得进入块的 effectiveMessageIds", () => {
  // 跨两种方案、多组范围地扫一遍：受保护 user 要么让整段被拒，要么被排除出范围
  // （伴随 warning），但绝不允许出现在块的覆盖集里。
  const cases: Array<{ keep: number; start: string; end: string }> = [
    { keep: 0, start: "m00001", end: "m00006" },
    { keep: 1, start: "m00001", end: "m00006" },
    { keep: 2, start: "m00003", end: "m00006" },
    { keep: 2, start: "m00005", end: "m00006" },
  ];

  for (const { keep, start, end } of cases) {
    const messages = buildMessages();
    const out = createCore().applyCompression({
      ranges: [{ startRef: start, endRef: end, summary: SUMMARY }],
      messages,
      state: stateWithRefs(messages),
      config: defaultConfig(LIMIT, { userVerbatimKeep: keep }),
    });
    const protectedUserIds = messages
      .filter((m) => m.role === "user")
      .map((m) => m.id)
      .slice(keep === 0 ? 0 : -keep);
    const folded = new Set(
      out.state.blocks.flatMap((b) => b.effectiveMessageIds),
    );
    for (const id of protectedUserIds) {
      assert.equal(
        folded.has(id),
        false,
        `keep=${keep} 范围 ${start}..${end}：受保护 user ${id} 不得被折叠`,
      );
    }
    // 只要发生部分排除，就必须有 warning 说明（RL-4：不得静默）
    if (out.result.blocksCreated > 0) {
      assert.ok(
        out.result.warnings.length > 0,
        `keep=${keep} 范围 ${start}..${end}：部分排除必须给出 warning`,
      );
    }
  }
});

test("AC-2.3 validateConfig rejects -1 and 1.5 with the pinned error string", () => {
  const ERR = "userVerbatimKeep must be an integer >= 0";

  const negative = validateConfig(
    defaultConfig(LIMIT, { userVerbatimKeep: -1 }),
  );
  assert.ok(
    negative.some((e) => e === ERR),
    `-1 必须被拒绝且错误串固定；实际：${JSON.stringify(negative)}`,
  );

  const fractional = validateConfig(
    defaultConfig(LIMIT, { userVerbatimKeep: 1.5 }),
  );
  assert.ok(
    fractional.some((e) => e === ERR),
    `1.5 必须被拒绝且错误串固定；实际：${JSON.stringify(fractional)}`,
  );

  // 反向哨兵：合法值不得被误报
  assert.equal(
    validateConfig(defaultConfig(LIMIT, { userVerbatimKeep: 0 })).some((e) =>
      e.includes("userVerbatimKeep"),
    ),
    false,
  );
  assert.equal(
    validateConfig(defaultConfig(LIMIT, { userVerbatimKeep: 12 })).some((e) =>
      e.includes("userVerbatimKeep"),
    ),
    false,
  );
});

test("report renders the USER MESSAGE PROTECTION section for both schemes", () => {
  const messages = buildMessages();
  const state = stateWithRefs(messages);

  const schemeA = buildStatusReport(state, messages, countTokens, {
    userVerbatimKeep: 0,
  });
  assert.match(schemeA, /USER MESSAGE PROTECTION/);
  assert.match(
    schemeA,
    /userVerbatimKeep=0 \(all user messages preserved verbatim\)/,
  );
  assert.match(schemeA, /user messages: 3 msgs \/ .+ tok \(.+% of visible\)/);

  const schemeB = buildStatusReport(state, messages, countTokens, {
    userVerbatimKeep: 12,
  });
  assert.match(
    schemeB,
    /userVerbatimKeep=12 \(last 12 preserved; older may enter T3\)/,
  );

  // 该节必须紧跟 CONTEXT BREAKDOWN 之后（不是文件首行）
  assert.ok(
    schemeA.indexOf("USER MESSAGE PROTECTION") >
      schemeA.indexOf("CONTEXT BREAKDOWN"),
    "保护节应位于 CONTEXT BREAKDOWN 之后",
  );

  // 不传该选项时不出这一节（宿主未升级时报告保持原样）
  const legacy = buildStatusReport(state, messages, countTokens, {});
  assert.doesNotMatch(legacy, /USER MESSAGE PROTECTION/);
});
