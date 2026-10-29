/**
 * TASK-5 / 改进 3 —— 摘要引用保真门的护栏（warn 交付态）。
 *
 * 守住四件事：
 *   1. warn 模式：丢词只记 warning、压缩照常（AC-5.1 前半）；
 *   2. enforce 模式：丢词抛错且错误串含缺失的句子原文（AC-5.1 后半）；
 *   3. 合规摘要不产生任何保真门 warning（AC-5.2）；
 *   4. `off` 模式整体静默（回滚开关有效）。
 *
 * TASK-7 追加：门只认 `user-turn` / `user-material`（AC-7.2），老数据无标签
 * 时跳过检查（AC-7.3）。**注意方向** —— 保护名单那边无标签是「继续保护」，
 * 与这里相反，见 `tests/provenance-gate.test.ts`。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createCore } from "../src/compress.js";
import { createInitialState } from "../src/state.js";
import { assignRefs } from "../src/refs.js";
import { defaultConfig } from "../src/config.js";
import {
  quoteFidelityViolations,
  quoteTierOf,
  importanceOf,
  quoteKeywordsOf,
  quoteCoverageOf,
} from "../src/compress.js";
import { collectUserVerbatimIds } from "../src/prune.js";
import type { CoreMessage, MessageProvenance } from "../src/types.js";

const LIMIT = 100000;

/** 无来源标签的消息（老数据形态）。assistant 与"测无标签"的用例用它。 */
function msg(
  id: string,
  text: string,
  role: CoreMessage["role"] = "user",
): CoreMessage {
  return { id, role, contentType: "text", text };
}

/**
 * 打了来源标签的 user 消息。缺省 `user-turn`：本文件里除专门测注入来源的用例
 * 外，user 行都是用户本人发言，TASK-7 之后门只认这类，不打标就查不到。
 */
function userTurn(
  id: string,
  text: string,
  provenance: MessageProvenance = "user-turn",
): CoreMessage {
  return { id, role: "user", contentType: "text", text, provenance };
}

/** 带硬约束的短指令（<= 500 字符 → 整条都必须出现在摘要里）。 */
const SHORT_INSTRUCTION = "必须用 pnpm 安装依赖，不要用 npm。";

/** 带硬约束的长指令（> 500 字符 → 按强调句判定）。 */
const LONG_INSTRUCTION =
  "背景说明：这是一个很长的需求描述，目的是把消息长度推过五百字符的门槛。".repeat(4) +
  "必须把产物写到 dist 目录，不要写进 src。" +
  "其余细节按既有约定处理即可。".repeat(6);

/**
 * 宽档长文本（> 500 字符、硬约束稀疏 → 宽档）：同一句中性背景复述多遍凑长度，
 * 关键词集合不膨胀，覆盖率只由摘要质量决定。
 */
const LOOSE_LONG_FILLER =
  "这次排障的经过前面几轮已经写得很清楚了，把经过按时间顺序再铺开一遍方便对照。";
const LOOSE_LONG_TEXT =
  LOOSE_LONG_FILLER.repeat(20) +
  "把导出的日志放到共享盘的 review 目录里，不要放到临时目录。";

/**
 * 约束密集的长消息（> 500 字符、「必须/不要」成排 → D-9D 收回严档）。
 * 原本是宽档用例；2026-10-29 档位规则收紧后落严档，留作档位对照。
 */
const DENSE_LONG_TEXT = [
  "这次排障请把 D:\\logs\\boot.log 的完整内容贴回来，不要只贴最后二十行。",
  "前面几次重启都卡在同一步：日志里能看到 launcher 在 precheck 之后就没有继续往下走，",
  "我怀疑是旧进程没退干净导致的，但还没有验证过。上一次是手动 taskkill 之后才起来的，",
  "那次的日志已经找不到了，所以也没法对照。时间点是 2026-10-18 那批，exit code 报的是 1。",
  "如果你看完日志觉得不是这个原因，也请把你的判断和依据写下来，我好决定下一步是继续往下查",
  "还是换个方向。另外前面几轮的结论我在群里同步过，这里不再重复，你按日志实际内容判断即可。",
  "补充一句：这份日志是全量的，没有做过裁剪，里面的时间戳可能和宿主机差几个时区，注意换算。",
  "另外 launcher 的启动顺序我没有改过，配置也还是上一版留下的，所以先按原样看，",
  "等你把日志结论给我之后再决定要不要动配置。中间那几次失败的间隔都不固定，",
  "最短的一次只隔了两分钟，最长的一次隔了大半天，这个间隔本身我也没有找到规律，",
  "如果日志里能看出和什么定时任务撞上了，麻烦一并指出来，我再决定要不要调开时间。",
  "最后一点：这份材料我只想让你看结论，不需要你把整段日志再复述一遍给我，直接说结论就行。",
].join("\n");

const FILLER = "f".repeat(30000);

/**
 * 布局：前 7 条落在「最近 5 条 + 最近 5000 token」软保护区之外，
 * 于是「能否进范围」只由 userVerbatimKeep 决定，不被软保护区提前拦下。
 * m00001=a0, m00002=u1, m00003=a1, m00004=u2 …
 */
function buildMessages(userText: string): CoreMessage[] {
  return [
    msg("a0", "start", "assistant"),
    userTurn("u1", userText),
    msg("a1", "ok", "assistant"),
    userTurn("u2", userText + "（第二条）"),
    msg("a2", "ok2", "assistant"),
    userTurn("u3", userText + "（第三条）"),
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

/** 压 m00001..m00002（= a0 + u1）。u1 是最老 user，keep=1 时才可被压。 */
function compressFirstPair(userText: string, summary: string, overrides: Partial<ReturnType<typeof defaultConfig>> & {
  compress?: Record<string, unknown>;
} = {}) {
  const messages = buildMessages(userText);
  const config = defaultConfig(LIMIT, {
    userVerbatimKeep: 1,
    ...overrides,
    compress: {
      quoteFidelityMode: "warn",
      // 本组用例聚焦保真门，范围体积下限关掉（否则短指令过不了 5000 字符门槛）。
      minCompressRange: 0,
      ...(overrides.compress ?? {}),
    } as never,
  });
  return createCore().applyCompression({
    ranges: [{ startRef: "m00001", endRef: "m00002", summary }],
    messages,
    state: stateWithRefs(messages),
    config,
  });
}

const SUMMARY_LOSES_QUOTE =
  "The user explained the background of the task and asked the assistant to proceed with the setup work as discussed earlier.";

test("AC-5.1a warn 模式：丢词只记 warning，压缩照常落地", () => {
  const out = compressFirstPair(SHORT_INSTRUCTION, SUMMARY_LOSES_QUOTE);
  assert.equal(out.result.blocksCreated, 1, "warn 不得阻断压缩");
  assert.deepEqual(out.result.errors, [], "warn 不得产生 error");
  const gate = out.result.warnings.filter((line) =>
    line.includes("dropped required user wording"),
  );
  assert.equal(gate.length, 1, "必须留一条保真门 warning");
  assert.match(gate[0]!, /quoteFidelityMode=warn/);
  assert.ok(gate[0]!.includes(SHORT_INSTRUCTION), "warning 里要带缺失的原文");
});

test("AC-5.1b enforce 模式：丢词抛错，错误串含缺失句子原文", () => {
  const out = compressFirstPair(SHORT_INSTRUCTION, SUMMARY_LOSES_QUOTE, {
    compress: { quoteFidelityMode: "enforce" },
  });
  assert.equal(out.result.blocksCreated, 0, "enforce 必须拒绝压缩");
  assert.equal(out.result.errors.length, 1);
  assert.match(out.result.errors[0]!, /dropped required user wording/);
  assert.ok(
    out.result.errors[0]!.includes(SHORT_INSTRUCTION),
    "错误串必须包含缺失的原文，模型才能照着补",
  );
});

test("AC-5.2 摘要原样引用原文 → 不产生误报", () => {
  const summary = `用户明确要求：${SHORT_INSTRUCTION} 其余按既有约定处理，无需额外确认，直接执行即可。`;
  const out = compressFirstPair(SHORT_INSTRUCTION, summary);
  assert.equal(out.result.blocksCreated, 1);
  assert.deepEqual(
    out.result.warnings.filter((line) =>
      line.includes("dropped required user wording"),
    ),
    [],
    "合规摘要不得触发保真门",
  );
});

test("AC-5.2b 长消息：全部强调句都出现即通过（不要求整条原文）", () => {
  const summary =
    "摘要：必须把产物写到 dist 目录，不要写进 src。其余背景从略，任务按计划推进，没有其它变更。";
  const out = compressFirstPair(LONG_INSTRUCTION, summary);
  assert.deepEqual(
    out.result.warnings.filter((line) =>
      line.includes("dropped required user wording"),
    ),
    [],
    "强调句齐全即视为保真",
  );
  assert.equal(out.result.blocksCreated, 1);
});

test("AC-5.2c 长消息：约束句关键词大部分保留不报，整条丢光才报", () => {
  // 2026-10-29 语义收紧：门对约束句改走关键词覆盖率（严档逐句），只留半句时
  // 覆盖率仍在 θ 之上 → 不再报；约束句整条丢光才记 warning。
  const partial =
    "摘要：必须把产物写到 dist 目录。其余背景从略，任务按计划推进，没有其它变更，需求也已确认，可以开始执行。";
  const passed = compressFirstPair(LONG_INSTRUCTION, partial);
  assert.deepEqual(
    passed.result.warnings.filter((line) =>
      line.includes("dropped required user wording"),
    ),
    [],
    "约束句关键词大部分还在 → 不报",
  );
  const dropped = compressFirstPair(LONG_INSTRUCTION, SUMMARY_LOSES_QUOTE);
  const gate = dropped.result.warnings.filter((line) =>
    line.includes("dropped required user wording"),
  );
  assert.equal(gate.length, 1);
  assert.match(gate[0]!, /必须把产物写到 dist 目录，不要写进 src/);
});

test("归一化：全半角、引号、空白差异不影响判定", () => {
  const instruction = "必须使用 “pnpm”  安装，不要用 npm。";
  const summary =
    '用户要求：必须使用 "pnpm" 安装，不要用 npm。 其余照旧，不再重复，按计划执行即可。';
  const out = compressFirstPair(instruction, summary);
  assert.deepEqual(
    out.result.warnings.filter((line) =>
      line.includes("dropped required user wording"),
    ),
    [],
    "只差引号形状/空白量时不得误报",
  );
});

test("off 模式：整体静默（回滚开关有效）", () => {
  const out = compressFirstPair(SHORT_INSTRUCTION, SUMMARY_LOSES_QUOTE, {
    compress: { quoteFidelityMode: "off" },
  });
  assert.equal(out.result.blocksCreated, 1);
  assert.deepEqual(
    out.result.warnings.filter((line) =>
      line.includes("dropped required user wording"),
    ),
    [],
  );
});

test("长度冲突降级：引用超长时错误串改为强调句 + 首尾片段", () => {
  // 宽档缺失片段 = 整条前 200 字符边缘片段 > maxSummaryLength=120 → 走降级串。
  // （严档缺失片段是短约束句，长度不超限，不会触发降级。）
  const out = compressFirstPair(LOOSE_LONG_TEXT, SUMMARY_LOSES_QUOTE, {
    compress: { quoteFidelityMode: "enforce", maxSummaryLength: 120 },
  });
  assert.equal(out.result.blocksCreated, 0);
  assert.match(out.result.errors[0]!, /middle omitted/);
});

test("纯函数口径：只检查 user 消息；检测不到硬约束的一律不进门（D-9B）", () => {
  const messages: CoreMessage[] = [
    msg("a1", "assistant 说了必须做某事", "assistant"),
    userTurn("u1", "   "),
    userTurn("u2", "普通一句没有标记词。"),
    userTurn("u3", "必须用 pnpm 安装依赖。"),
  ];
  const violations = quoteFidelityViolations(
    messages,
    ["a1", "u1", "u2", "u3"],
    "一条什么都没提的摘要。",
  );
  assert.deepEqual(
    violations.map((violation) => violation.messageId),
    ["u3"],
    "assistant / 空白 / 无硬约束的普通句都不进门；只有带硬约束的那条报",
  );
  assert.deepEqual(violations[0]!.missing, ["必须用 pnpm 安装依赖。"]);
});

// ─────────────────────────────────────────────────────────────────────────────
// TASK-9 —— 两档判定
// ─────────────────────────────────────────────────────────────────────────────

test("AC-9.1 两档：严档要求逐字，宽档只要求关键词覆盖", () => {
  // 严档：短消息（≤ L）一律严档（D-9C），整条必须出现。
  const strictText = "必须用 pnpm 安装依赖，不要用 npm。";
  assert.equal(quoteTierOf(strictText), "strict", "短消息 → 严档");
  assert.equal(
    quoteFidelityViolations(
      [userTurn("u1", strictText)],
      ["u1"],
      "用户要求用 pnpm 安装依赖。",
    ).length,
    1,
    "严档：改写措辞（丢了「不要用 npm」）就要报",
  );

  // 宽档：长消息 + 硬约束稀疏 → 只要求整条的关键词覆盖（允许改写措辞）。
  assert.ok(LOOSE_LONG_TEXT.length > 500, "这条必须真的过了长度门槛，否则测的不是宽档");
  assert.equal(quoteTierOf(LOOSE_LONG_TEXT), "loose", "长 + 约束稀 → 宽档");
  // 对照（D-9D）：约束密集的长消息收回严档。
  assert.ok(DENSE_LONG_TEXT.length > 500, "对照文本也必须过长度门槛");
  assert.equal(quoteTierOf(DENSE_LONG_TEXT), "strict", "长 + 约束密 → 严档（D-9D）");
  assert.equal(
    quoteFidelityViolations(
      [userTurn("u2", LOOSE_LONG_TEXT)],
      ["u2"],
      `${LOOSE_LONG_FILLER.repeat(12)}导出的日志放到共享盘的 review 目录，临时目录不用。`,
    ).length,
    0,
    "宽档：关键 token 大部分还在 → 不报",
  );
  assert.equal(
    quoteFidelityViolations(
      [userTurn("u2", LOOSE_LONG_TEXT)],
      ["u2"],
      "本段是关于排障经过的讨论，已按计划处理完毕，细节从略。",
    ).length,
    1,
    "宽档：关键 token 丢干净 → 报",
  );
});

test("AC-9.4 长材料不查整条逐字：保住外面那句说明 + 材料标识即可", () => {
  const material =
    "帮我把这份日志里失败的那一段摘出来，不要整段贴回去。\n" +
    "2026-10-18T07:22:39.789Z INFO  launcher: precheck start\n" +
    "2026-10-18T07:22:40.120Z WARN  launcher: old process not running\n" +
    "2026-10-18T07:22:42.310Z ERROR CORE: failed to create instance\n" +
    "2026-10-18T07:22:42.311Z ERROR CORE: unsupported core manual connector URL\n" +
    "2026-10-18T07:22:43.000Z INFO  launcher: cleanup done\n" +
    "2026-10-18T07:22:43.001Z INFO  launcher: exit code 1\n" +
    "2026-10-18T07:22:43.002Z INFO  launcher: removing stale pid file\n" +
    "2026-10-18T07:22:43.010Z INFO  launcher: stale pid file removed\n" +
    "2026-10-18T07:22:43.011Z INFO  launcher: waiting for next attempt\n" +
    "2026-10-18T07:22:43.012Z INFO  launcher: backoff set to 30s\n" +
    "2026-10-18T07:22:43.013Z INFO  launcher: shutdown complete\n";
  const message = userTurn("m1", material, "user-material");
  // 摘要只提了外面那句说明和材料标识，正文一句没留 —— 这算通过。
  const okSummary =
    "用户让把日志里失败的那一段摘出来，不要整段贴回去；涉及 launcher 的 precheck 与 exit code 1。";
  assert.equal(
    quoteFidelityViolations([message], ["m1"], okSummary).length,
    0,
    "长材料：不要求正文逐字，保住外面那句 + 能指认材料即通过",
  );
  // 外面那句说明丢干净 → 报。
  assert.equal(
    quoteFidelityViolations(
      [message],
      ["m1"],
      "本段是 launcher 的日志输出，已按计划处理完毕。",
    ).length,
    1,
    "长材料：外面那句说明丢了要报",
  );
});

test("AC-9.0 打分与覆盖率是纯字符串运算（无外部依赖）", () => {
  const text = "必须用 pnpm 安装依赖，不要用 npm。";
  const score = importanceOf(text);
  assert.ok(Number.isFinite(score) && score >= 0 && score <= 1, "importance 值域 [0,1]");
  assert.ok(quoteKeywordsOf(text).size > 0);
  assert.equal(quoteCoverageOf(new Set(["必须"]), new Set(["必须"])), 1);
  assert.equal(quoteCoverageOf(new Set(["必须"]), new Set()), 0);
  assert.equal(quoteCoverageOf(new Set(), new Set()), 1, "空关键词集视为 1（没有要保的）");
});

// ─────────────────────────────────────────────────────────────────────────────
// TASK-7 —— 来源收窄
// ─────────────────────────────────────────────────────────────────────────────

test("AC-7.2 保真门只认 user-turn / user-material：宿主注入行不进门", () => {
  const injected: MessageProvenance[] = [
    "host-policy",
    "host-content",
    "engine-metadata",
    "checkpoint",
    "relay",
  ];
  const messages: CoreMessage[] = injected.map((provenance, index) =>
    userTurn(`x${index}`, SHORT_INSTRUCTION, provenance),
  );
  const violations = quoteFidelityViolations(
    messages,
    messages.map((message) => message.id),
    SUMMARY_LOSES_QUOTE,
  );
  assert.deepEqual(
    violations,
    [],
    "AGENTS.md / 技能目录 / 运行时上下文 / 检查点 / 子代理转述都不是用户原话，不得产生违规",
  );
});

test("AC-7.3 老数据无来源标签：保真门跳过检查（fail-open）", () => {
  const messages: CoreMessage[] = [msg("u1", SHORT_INSTRUCTION)];
  const violations = quoteFidelityViolations(messages, ["u1"], SUMMARY_LOSES_QUOTE);
  assert.deepEqual(
    violations,
    [],
    "无标签 → 跳过检查。后果是少查一次：无害（不拒绝压缩）且可见（门不报）",
  );
});

test("AC-8.2 用户贴的材料也算用户原话：user-material 进门", () => {
  const messages: CoreMessage[] = [
    userTurn("m1", SHORT_INSTRUCTION, "user-material"),
  ];
  const violations = quoteFidelityViolations(messages, ["m1"], SUMMARY_LOSES_QUOTE);
  assert.equal(violations.length, 1, "材料外面那句用户说明丢了要报");
});

test("AC-7.5 / RL-4 保护名单：无标签继续保护，注入来源不保护", () => {
  const messages: CoreMessage[] = [
    msg("plain", "无标签的老消息"),
    userTurn("turn", "用户发言"),
    userTurn("mat", "用户材料", "user-material"),
    userTurn("policy", "AGENTS.md 注入", "host-policy"),
    userTurn("cp", "压缩检查点", "checkpoint"),
    msg("asst", "助手说的话", "assistant"),
  ];
  const ids = collectUserVerbatimIds(messages, 0);
  assert.deepEqual(
    [...ids].sort(),
    ["mat", "plain", "turn"],
    "无标签的老数据必须继续受保护（省掉这个分支 = 静默违反 RL-4）",
  );
});
