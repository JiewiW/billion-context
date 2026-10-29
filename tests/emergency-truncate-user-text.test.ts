import { test } from "node:test";
import assert from "node:assert/strict";
import { createCore } from "../src/compress.js";
import { createInitialState } from "../src/state.js";
import { defaultConfig } from "../src/config.js";
import type { CoreMessage } from "../src/types.js";

/** 英语散文约 3 字符/token —— 让「2000 token 指令」落到一个真实的长度上。 */
const countTokens = (text: string) => Math.ceil(text.length / 3);

const LIMIT = 100000;
const TRUNCATION_MARKER = "[truncated for context space]";

function msg(
  id: string,
  text: string,
  role: CoreMessage["role"] = "user",
  type: CoreMessage["contentType"] = "text",
): CoreMessage {
  return { id, role, contentType: type, text };
}

/** processTurn 会在可见层给消息套上 `<acp tokens=… >mNNNNN</acp>` 标记。
 *  那是内核的标准包装，不是内容改动；比内容时先剥掉它。 */
function payload(text: string | undefined): string {
  return (text ?? "").replace(/^<acp\b[^>]*>m\d+<\/acp>\n/, "");
}

/** 一条 2000 token 的用户指令：含「先 / 不要 / 必须 / first / don't / required」
 *  这类强调标记，正是紧急截断切中段会丢掉的内容。 */
const INSTRUCTION_SEED =
  "First read the three manifests, then reconcile the lockfile — do not skip the integrity check, it is required. ";
function buildInstruction(): string {
  let out = "";
  while (out.length < 6000) out += INSTRUCTION_SEED;
  return out.slice(0, 6000);
}

test("AC-1.1 emergency-truncate leaves a 2000-token user instruction byte-identical", () => {
  const INSTRUCTION = buildInstruction();
  // 2000 token（6000 字符 / 3），且长度 > keepPrefix+keepSuffix(4000)，
  // 否则它会因「太小不值得切」被跳过，测不出回归。
  assert.equal(countTokens(INSTRUCTION), 2000);

  const core = createCore({ countTokens });
  const cfg = defaultConfig(LIMIT);
  const messages: CoreMessage[] = [
    // 系统提示撑到 95% 用量；系统角色永不进候选，指令就是唯一的文本候选。
    msg("sys", "S".repeat(285000), "system"),
    msg("u1", "noted"),
    msg("instr", INSTRUCTION), // 倒数第 6 位（index 2 = len-6）
    msg("p1", "a"),
    msg("p2", "b"),
    msg("p3", "c"),
    msg("p4", "d"),
    msg("p5", "e"),
  ];
  assert.equal(messages.length, 8);
  assert.equal(messages.indexOf(messages[2]!), 8 - 6, "位置：倒数第 6");

  // 落在保护窗口（末 5 条）之外，否则它本来就不会被切。
  const protectedIndex = messages.length - cfg.preserveRecentMessages;
  assert.ok(2 < protectedIndex, "instruction sits outside the protected tail");

  const tokenCount = countTokens("S".repeat(285000)) + 2000 + 5;
  assert.ok(tokenCount / LIMIT >= 0.95, "构造的 usage >= 95%");

  const result = core.processTurn({
    messages,
    state: createInitialState(),
    config: cfg,
    tokenCount,
  });

  const after = result.messages.find((m) => m.id === "instr")!;
  assert.equal(payload(after.text), INSTRUCTION, "逐字节不变");
  assert.ok(
    !result.messages.some((m) => m.text?.includes(TRUNCATION_MARKER)),
    "紧急截断不得留下任何截断痕迹",
  );
  // 反向哨兵：文本候选被摘掉后，truncationSkipped 会说明「无可截内容」。
  assert.match(
    result.truncationSkipped ?? "",
    /found no truncatable content/,
    "未截断时须给出零候选诊断，而非静默",
  );
});

test("AC-1.2 only user/assistant text remains -> terminal escape, text untouched", () => {
  const BIG_USER = "U".repeat(30000);
  const BIG_ASSISTANT = "A".repeat(30000);

  // 全部大块都是 user/assistant 文本（外加一条永不进候选的系统提示）：
  // 无可切工具结果。消息总数 <= preserveRecentMessages(5)，保护窗口覆盖全体，
  // 于是既无可截内容、也无可压缩内容 —— 正是 escape 判定式的输入。
  const messages: CoreMessage[] = [
    msg("sys", "S".repeat(255000), "system"),
    msg("big-u", BIG_USER),
    msg("big-a", BIG_ASSISTANT, "assistant"),
    msg("u2", "more"),
    msg("u3", "last"),
  ];
  const tokenCount =
    countTokens("S".repeat(255000)) +
    countTokens(BIG_USER) +
    countTokens(BIG_ASSISTANT) +
    8;

  const core = createCore({ countTokens });
  const cfg = defaultConfig(LIMIT);
  assert.equal(cfg.truncate.terminalEscapeAfter, 3);
  assert.ok(tokenCount / LIMIT >= 0.95, "构造的 usage >= 95%");
  assert.equal(
    messages.length - cfg.preserveRecentMessages,
    0,
    "保护窗口覆盖全体 -> 无可截亦无可压",
  );

  let state = createInitialState();
  const streaks: number[] = [];
  let escapeFired = false;
  for (let turn = 1; turn <= 3; turn++) {
    const r = core.processTurn({ messages, state, config: cfg, tokenCount });
    // 全程 user/assistant 文本未被修改
    assert.equal(
      payload(r.messages.find((m) => m.id === "big-u")!.text),
      BIG_USER,
      `turn ${turn}: user text untouched`,
    );
    assert.equal(
      payload(r.messages.find((m) => m.id === "big-a")!.text),
      BIG_ASSISTANT,
      `turn ${turn}: assistant text untouched`,
    );
    streaks.push(r.state.terminalStreak);
    if (turn < 3) {
      assert.equal(
        r.terminalEscape,
        undefined,
        `turn ${turn}: escape must not fire early`,
      );
    } else {
      assert.ok(r.terminalEscape, "turn 3: escape fires");
      escapeFired = true;
    }
    state = r.state;
  }

  assert.deepEqual(streaks, [1, 2, 3], "streak 逐回合累加");
  assert.ok(escapeFired);
  assert.ok(state.terminalStreak >= 3, "terminalStreak >= terminalEscapeAfter");
});
