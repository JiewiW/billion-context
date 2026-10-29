import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCore } from "../src/compress.js";
import { createInitialState } from "../src/state.js";
import { defaultConfig } from "../src/config.js";
import type { CoreMessage } from "../src/types.js";

/**
 * AC-2.6 回归 fixture：真实会话 `session-063661eb` 里那条含
 * 「先把三个包的npm发布硬性要求准备好」的 user 消息。
 *
 * 这条消息就是改进 1 的起因：它是一句硬性要求，被摘要概括掉之后下游就丢了
 * 约束。断言口径：压缩全程原文逐字节保留，且永不进入任何块的覆盖集。
 *
 * 注意：ref 必须由 `processTurn` 自己分配 —— 若用裸 `assignRefs` 预分配，
 * protectedFn 不参与，受保护消息会拿到正常 mNNNNN（本用例第一版就踩了这个坑）。
 */
const CASE_URL = new URL(
  "../../case/session-063661eb-0bc3-40fb-97b1-79ac199f6406.jsonl",
  import.meta.url,
);
const MARKER = "先把三个包的npm发布硬性要求准备好";

const countTokens = (text: string) => Math.ceil(text.length / 3);

/** 从真实会话里取出那条 user 消息的原文（第一个 `user/message` 且含标记）。 */
function loadInstructionFromCase(): string {
  const raw = readFileSync(CASE_URL, "utf8");
  for (const line of raw.split("\n")) {
    if (!line.includes(MARKER)) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const record = event as {
      type?: string;
      data?: { content?: Array<{ type?: string; text?: string }> };
    };
    if (record.type !== "user/message") continue;
    for (const block of record.data?.content ?? []) {
      if (
        block.type === "text" &&
        typeof block.text === "string" &&
        block.text.includes(MARKER)
      ) {
        return block.text;
      }
    }
  }
  throw new Error(`fixture 中找不到含「${MARKER}」的 user 消息`);
}

/** processTurn 会给可见层套 `<acp …>mNNNNN</acp>` 前缀，比内容前先剥掉。 */
function payload(text: string | undefined): string {
  return (text ?? "").replace(/^<acp\b[^>]*>m\d+<\/acp>\n/, "");
}

function msg(
  id: string,
  text: string,
  role: CoreMessage["role"] = "user",
): CoreMessage {
  return { id, role, contentType: "text", text };
}

/** 3000 token 的填充块：把「最近 5000 token」窗口压在末尾一条上。 */
const FILLER = "f".repeat(9000);

function buildMessages(
  instruction: string,
): CoreMessage[] {
  // 指令在 idx 0（远在最近 5 条与最近 5000 token 窗口之外），后面是
  // assistant 回复 + 填充块。这样它「本可被那条范围覆盖」，保护若失效就会
  // 真的被折叠 —— 断言才有区分度。
  return [
    msg("instr", instruction),
    msg("a1", "收到，我先列一遍三个包的发布要求。", "assistant"),
    msg("a2", FILLER, "assistant"),
    msg("a3", FILLER, "assistant"),
    msg("a4", FILLER, "assistant"),
    msg("a5", FILLER, "assistant"),
    msg("a6", FILLER, "assistant"),
    msg("a7", FILLER, "assistant"),
  ];
}

test("AC-2.6 真实会话里的硬性要求：默认配置下原文逐字节保留且永不进块", () => {
  const INSTRUCTION = loadInstructionFromCase();
  assert.ok(INSTRUCTION.includes(MARKER), "取到的消息必须含那句硬性要求");

  const messages = buildMessages(INSTRUCTION);
  const core = createCore({ countTokens });
  const cfg = defaultConfig(100000);
  assert.equal(cfg.userVerbatimKeep, 0, "默认即方案 A");

  // ① 让内核自己分配 ref（protectedFn 参与）
  const turn = core.processTurn({
    messages,
    state: createInitialState(),
    config: cfg,
    tokenCount: 50000,
  });

  // ② 原文逐字节不变
  const survived = turn.messages.find((m) => m.id === "instr");
  assert.ok(survived, "指令消息必须仍在可见层");
  assert.equal(payload(survived.text), INSTRUCTION, "原文逐字节保留");

  // ③ 受保护 → ref 是 BLOCKED，不占 mNNNNN
  assert.equal(
    turn.state.messageRefs.byRaw["instr"],
    "BLOCKED",
    "受保护 user 消息的 ref 必须是 BLOCKED",
  );
  assert.equal(
    Object.values(turn.state.messageRefs.byRaw).filter((r) => r === "m00001")
      .length,
    1,
    "m00001 必须被后面的消息（a1）占住，说明指令没占编号",
  );

  // ④ 压一段「不含指令」的大块：必须成功，且覆盖集里没有指令
  const a1Ref = turn.state.messageRefs.byRaw["a1"]!;
  const a7Ref = turn.state.messageRefs.byRaw["a7"]!;
  const ok = core.applyCompression({
    ranges: [
      { startRef: a1Ref, endRef: a7Ref, summary: "Assistant acknowledged and enumerated the publishing requirements." },
    ],
    messages,
    state: turn.state,
    config: cfg,
  });
  assert.equal(ok.result.blocksCreated, 1, "不含指令的大块应当压得动");
  assert.deepEqual(ok.result.errors, []);
  for (const block of ok.state.blocks) {
    assert.equal(
      block.effectiveMessageIds.includes("instr"),
      false,
      "指令不得出现在任何块的覆盖集",
    );
  }

  // ⑤ 压缩之后指令仍然逐字可见
  const after = turn.messages.find((m) => m.id === "instr")!;
  assert.equal(payload(after.text), INSTRUCTION, "压缩不得改动指令原文");
});

test("AC-2.6b 逃生阀也放不走这条指令（它在最近 N 条之内）", () => {
  const INSTRUCTION = loadInstructionFromCase();
  const messages = buildMessages(INSTRUCTION);
  const core = createCore({ countTokens });
  // keep=12 ≥ 本会话 user 总数（1）→ 指令仍在保护集合内
  const cfg = defaultConfig(100000, { userVerbatimKeep: 12 });

  const turn = core.processTurn({
    messages,
    state: createInitialState(),
    config: cfg,
    tokenCount: 50000,
  });
  assert.equal(
    turn.state.messageRefs.byRaw["instr"],
    "BLOCKED",
    "逃生阀下最近 N 条仍受保护",
  );
  assert.equal(
    payload(turn.messages.find((m) => m.id === "instr")!.text),
    INSTRUCTION,
  );
});
