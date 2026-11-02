# billion-context 改进版计划书

> **TL;DR**：本文覆盖机制剖析结论 5 项中的第 1、2、3、5 项（第 4 项单独立项）。施工次序：改进 2（一行改动，先摘低垂果实）→ 并行改进 5 步骤 5a 插桩 → 改进 1（用户消息保护，方案 A 默认 + B 逃生阀）→ 按插桩数据做改进 5 步骤 5b → 最后做改进 3（摘要保真门，先 warning 后硬门）。三个决策点已于 2026-10-25 确认（第 7 节《决策记录》），改进 1 的用户接口详细设计见该节。
>
> 配套文档：`billion-context-机制剖析与案例.md`（机制与案例证据；分级策略见其 §1.5、触发时机 §1.4、三类判定 §2、真实案例 §3。444 行，先检索定位再局部读取）
> 源码基线：`_bc-src/acpk`（acp-kernel）+ `_bc-src/bcdsh`（DSH 适配器）
> 本文只覆盖机制剖析结论中的第 1、2、3、5 项；第 4 项（纠正类指令单独标记）留待本计划落地后单独立项。

## 目录

0. 文档定位 —— 本文是什么、不是什么
1. 问题清单（已确认根因）—— P1–P4
2. 改进项详设 —— 改进 1/2/3/5 的落点、拟改、代价、验收
3. 施工顺序与依赖 —— 阶段 0–6
4. 验收总标准 —— 功能 / 回归 / 冒烟 / 可观测
5. 风险与未决问题 —— R1–R6
6. 明确不做的事
7. 决策记录（2026-10-25 已确认）—— 含改进 1 用户接口详细设计索引

---

## 0. 文档定位

这是一份**施工前计划书**，用途是让改进项在动代码之前先对齐三件事：改哪里、改完付什么代价、怎么算验收通过。

每一项都标注了**代码坐标**（文件 + 行号 + 函数名），未标注坐标的结论一律标记为「未确认」，不臆造。

---

## 1. 问题清单（已确认根因）

### P1 · 用户消息在内核中几乎不受保护

保护用户消息的位置全内核只有三处，每一处都窄到不解决问题：

| # | 坐标 | 实际保护范围 |
|---|---|---|
| 1 | `prune.ts:288`（`rebuildMessages`） | **只钉第一条** user 消息。注释自陈目的是满足「对话必须至少含一条 user」的协议要求，不是保信息 |
| 2 | `recommend.ts:123-140`（`computeProtectedRefs` Rule 3） | **只钉最后一条** user 消息，代码里一个 `break` 找到即停 |
| 3 | `truncate-tools.ts:48` | 紧急截断只保护**最后 5 条消息**，且**完全不看 role** |

除此之外，**没有任何规则规定 `role === "user"` 的消息不可被压缩**。`buildCompressibleRanges`（`recommend.ts:159`）对 user 角色没有任何豁免，`isUser` 只用于分段与统计。

DSH 适配器侧进一步放大该问题：`bcdsh/src` 全目录 grep `protectedTools` / `isToolProtected` / `protectedLatestTools` **零命中**，适配器一个都没配；`bcdsh/src/presets.ts:25` 还特意注明 `protectedLastMessages` 连一等配置旋钮都算不上，只能走 `coreOverrides`。

### P2 · 紧急硬截断切用户文本，且不留痕迹

`compress.ts:1069-1078`（`emergencyTruncateNode`）在上下文用量 ≥ `truncate.threshold`（默认 **0.95**）时调用 `truncateLargeToolOutputs`，调用处**硬编码** `includeTextMessages: true`。

`truncate-tools.ts:73-82` 据此把 user 与 assistant 的 text 消息纳入候选，唯一**位置**保护是 `protectedIndex = messages.length - preserveRecentMessages`（默认 5）。另有一层**顺序**保护：text 候选是 last-resort，仅当工具结果切完仍达不到目标量时才启用（`truncate-tools.ts:11-13` 注释自陈）——但只要工具结果切完仍超限，user 文本照样进候选，长指令的命运不变。叠加 `minOutputTokens: 1000`、`keepPrefixChars/keepSuffixChars: 2000`，实际效果是：

> 任何 ≥ 1000 token 的用户指令，只要不在最后 5 条内，**中段被直接挖掉**，只留头 2000 + 尾 2000 字符，中间插入 `[truncated for context space]`。

三个特性使它比摘要路径更危险：

1. **字符串切割，不是摘要**——不存在「模型理解错了」的辩解空间；
2. **消息仍在可见位置**，只是中段消失，**模型无法得知自己刚被删了一段**，于是若无其事继续（用户视角即「自说自话」）；
3. **长指令死得最惨**——「先…再…」「不要…」「必须…」这类限定强调在长指令里没有任何位置保护。

`includeTextMessages: true` 写在调用处而非配置里，**宿主无法关闭**。

### P3 · 摘要引用保真只停留在文本层

内核从不调模型，摘要文字由模型自产（`DESIGN.md §1`）。「必须原文引用用户指令」这条规则位于 `compression-rules.ts` 的 KEEP VERBATIM 清单，属纯文本提示，是**劝说模型**而非代码强制。

该文件头部自陈两次生产事故，均指向此处：

- **2026-09-06 引用保真修订**：模型**编造**用户原话 `user verbatim '合并了 下一个'` 并作为活着的 CURRENT TASK 存证，导致循环复发（session `01a071dc`，块 b60/b61）；
- **2026-09-26 开放目标前置修订**：多块合并 `b22 ⊇ b13` 丢掉一个仍处于开放状态的用户转向。

两次补的都是文本规则，未上代码层。

### P4 · 上游存在大量重复注入（第 5 项目标）

实测 session-063661eb（2026-10-22，1980 事件，ACP 实际在跑）。

**统计口径（2026-10-25 重算后固化，可复现）**：

- 候选：会话全量事件中消息类事件（user / assistant / tool-result / system / inbox-spliced）content 数组的每个 text part；
- 本口径只统计 `role === "tool"` 的块——user / assistant 角色的重复注入规模另见配套文档 §3.3（重构可见消息空间内 7 份 runtime-context 快照合计 23,835 tok，占该区间 50.2%），两处口径不同，不可直接相加；
- 门槛：块长 ≥ 800 字符；指纹：前 120 字符；
- 成组：组内 ≥ 2 块即计重复；
- 表格列含义：**单份字符 = 组内首次出现块的长度；合计字符 = 组内全部块长之和**（同一指纹的各份长度可能不同，故合计 ≠ 次数 × 单份）；
- 重算脚本：`_bc-src/case/dedup-recount.js`（原插桩脚本未存档，本脚本按上述口径重算并复现下文全部数字）。

**重复内容合计 273,017 字符 = 全部 11 个重复组之和。** Top 9 组（按合计降序）：

| 次数 | 单份字符 | 合计字符 | 内容 |
|---|---|---|---|
| ×2 | 49,931 | 55,090 | node_modules 目录列举 |
| ×2 | 37,215 | 42,374 | npm 发布流程文档 |
| ×2 | 33,884 | 39,043 | 文件列举 |
| ×2 | 31,189 | 36,348 | grep 250/514 匹配结果 |
| ×4 | 12,427 | 35,172 | `<skill_content name="github-git-sync-hardrules">` |
| ×2 | 22,529 | 27,688 | fetched awesome-dsh-plugin README |
| ×2 | 9,409 | 14,568 | `<skill_content name="dsh-plugin-dev-hardrules">` |
| ×7 | 1,753 | 7,850 | npm 首页抓取 |
| ×6 | 1,194 | 7,435 | npm stderr notice（6 份长 1,194–1,267 不等） |

未列入表的 2 组：npm tokens 设置页 ×2（首份 2,135，合计 4,101）、package.json ×2（首份 1,787，合计 3,348）。265,568 + 4,101 + 3,348 = 273,017。

**重算新发现（已证实，影响 5b 策略）**：多组的重复副本不是完整副本，而是同一内容的**定长截断重显**——node_modules 列举、npm 发布文档、文件列举、grep 结果、awesome README、dsh-plugin-dev-hardrules 六组的第二份均为 5,159 字符；github-git-sync-hardrules 组 4 份中第 3、4 份亦为 5,159。已验证大块同时包含 5,159 小块的头 3,000 字符与尾 300 字符（保头尾、切中段）。**截断的执行方未确认**（宿主上下文裁剪或工具输出重渲染均有可能），但可确认这不是分析误差。含义：宿主重注同一工具结果时叠加了截断，去重收益比「省整份」小，但重复注入事实不变。

**如实声明**：273,017 是**重复内容上界，不等于全是浪费**。同一文件在不同时间点被合法重读会产生相同指纹；上表的定长截断重显也占一部分。要区分「宿主把同一份快照反复注入」与「模型合法地重复读取」，必须在注入点插桩后才能定论——这正是改进 5 步骤 5a 的任务。

---

## 2. 改进项详设

### 改进 2（对应原第 2 项）· 摘掉紧急截断的用户文本候选

**优先级：最高（一行改动，先摘低垂果实）**

**落点**

- `acpk/src/compress.ts:1076` —— 显式传 `includeTextMessages: false`（决策 2 已拍板；配置项路线不采用——为一个已证等价的一次性决定新增宿主配置面不划算）

`TruncateOptions.includeTextMessages`（`truncate-tools.ts:14`）本就是可选字段，函数层无需改动。

**拟改（最小版）**

```ts
// acpk/src/compress.ts  emergencyTruncateNode.run
const trunc = truncateLargeToolOutputs(io.messages, ctx.tokenCount, ctx.config, ctx.countTokens, {
  protectRecentMessages: ctx.config.preserveRecentMessages,
  // 不再把 user/assistant 散文列为末位候选：95% 用量下切掉用户指令中段
  // 不留痕、不带角色豁免，是「压掉了不该压的」最直接的一条路径。
  // 代价是末位安全阀只剩工具结果，见 terminalEscapeAfter 的连锁反应。
  includeTextMessages: false,
});
```

**三种写法等价（2026-10-25 已核实，决策 2 据此拍板）**：`truncate-tools.ts:73` 为 `options.includeTextMessages ? … : []`——省略该字段时 text 候选即为空数组。故「删除该行」「显式传 `false`」「新增配置项默认 `false`」功能等价。**已拍板采用显式 `false`**（见第 7 节决策 2）：读代码即知意图，不依赖读者推断函数默认值；配置项路线留档不采用。

**必须写进代价说明的连锁反应**

紧急截断从此只能切工具结果（原先 user/assistant 文本是 last-resort 候选，仅当工具结果切完达不到目标量时才启用，见 `truncate-tools.ts:11-13`；本改动将该末位手段一并摘掉）。若工具结果切完仍达不到 `truncate.threshold * 0.9` 的目标（`truncate-tools.ts:88` 的 `targetTokens`），`terminalEscapeAfter: 3`（`config.ts:24`）会连续 3 回合判定「无可压缩内容且截断无收益」，随后向宿主发 `terminalEscape` 信号，提示开会话。

这是一个**诚实但难受**的取舍：宁可明确告诉用户「压缩已到头，请开新会话」，也不要偷偷把用户的指令切成两半。

**验收**

- 单测：构造 usage ≥ 0.95、含一条 2000 token 用户指令且位于倒数第 6 位的消息列表，断言该指令文本逐字节不变；
- 单测：构造 usage ≥ 0.95 且全部大块均为 user/assistant 文本（无可切工具结果）的消息列表，连续 3 回合调用，断言第 3 回合 `terminalStreak` 达到 `terminalEscapeAfter` 且 effects 含 escape 信号（判定式见 `compress.ts:1092-1095`：`stuck && streak >= escapeAfter`），且全程无任何 user 消息文本被修改——即「仅剩用户文本可切」时必须走 escape，不得静默切用户消息。

---

### 改进 5（对应原第 5 项）· 上游重复注入去重

**优先级：高（纯赚、零误判，但与内核不同源）**

**性质说明**：这不是内核改动，是宿主（DSH 插件）侧改动，与改进 1/2/不同源代码树，可并行推进。

**步骤 5a · 插桩（先做，不做优化）**

在宿主注入点记录每次注入的：内容指纹、字符数、时间戳、触发原因。跑满一个真实会话后回答两个问题：

1. 273,017 字符中，真实浪费（同一份快照被重复注入）占多少；
2. 重复的成因是哪一类——运行时上下文快照、skill 内容注入、工具输出回显，还是模型合法重读。

**步骤 5b · 按成因施策**（策略待 5a 数据定，先列候选）

| 成因 | 候选策略 |
|---|---|
| 运行时上下文快照 | 内容寻址缓存，只注入增量；或注入引用 + 按需展开 |
| skill 内容注入 | 同一会话内同 skill 只注入一次，后续用 `@skill:name` 引用 |
| 工具输出回显 | 交给内核 CCR（content-cached retrieval：超大工具结果到达即存入 per-session MessageContentStore，可见处留占位符，模型经 retrieve 工具按需取回；`ccr.ts`，默认 `enabled: false`）而非重复内联 |
| 模型合法重读（兜底行） | 不处理，仅记录占比——这是上界与真实浪费的差额来源 |

**验收**：插桩前后对比同一类会话的「重复注入字符数 / 总会话字符数」比值，给出可复现的下降曲线。

---

### 改进 1（对应原第 1 项）· 用户消息无条件原文保留

**优先级：中（改保护语义；方案已定：A 默认 + B 逃生阀，见下文与第 7 节决策 1）**

**落点**

1. `acpk/src/compress.ts:849-854`（`assignRefsNode` 的 `protectedFn`）—— 增加 user 角色，使其走 `refs.ts:76-79` 现成的 `BLOCKED_REF` 通路（媒体消息已在用）；
2. `acpk/src/prune.ts:288` —— 由「只钉第一条」改为「钉全部受保护的 user 消息」：方案 A 下为全部，方案 B 下为第一条（满足协议「至少一条 user」）+ 最近 N 条。

**拟改（落点 1）**

```ts
// 决策 1（2026-10-25）：userVerbatimKeep 省略或为 0 → 全部 user 消息 BLOCKED（方案 A，默认）；
// 设为 N>0 → 仅最近 N 条 BLOCKED（方案 B 逃生阀，更老的允许进 T3，仍须过改进 3 保真门）。
// 用 id 集合而非 indexOf：protectedFn 每条消息各调一次，indexOf 会退化为 O(n²)。
const keep = ctx.config.userVerbatimKeep ?? 0;
const userIndices: number[] = [];
io.messages.forEach((m, i) => {
  if (m.role === "user") userIndices.push(i);
});
const keptUserIds = new Set(
  (keep === 0 ? userIndices : userIndices.slice(-keep)).map(
    (i) => io.messages[i]!.id,
  ),
);
const protectedFn = (m: CoreMessage) =>
  hasMediaPayload(m) ||
  // 用户消息永不折叠：保住「先/不要/必须」这类限定强调，
  // 它们正是压缩丢失后模型「自说自话」的根源。
  keptUserIds.has(m.id) ||
  (hasProtection
    ? isMessageProtected(m, ctx.config) ||
      (latest ? isMessageLatestProtected(m, latest) : false)
    : false);
```

**设计决策（2026-10-25 已确认，见第 7 节决策 1）：默认方案 A，方案 B 作为可调逃生阀**

严格「所有 user 消息永不压缩」会让不可压缩底限随会话增长而上升，长会话可能更早撞到 `emergencyThresholdPct`。两个方案：

- **方案 A（全禁）**：所有 user 消息永久原文保留。简单、零误判、语义最干净。代价是底限上升。
- **方案 B（分级）**：最近 `userVerbatimKeep` 条 user 消息原文保留，更老的允许进 T3 超压缩，但**必须**通过改进 3 的引用保真门。

**已确认：默认 A，`userVerbatimKeep` 作为可调逃生阀**（初值 12，待回归数据校准），并在 `acp_status` 暴露用户消息 token 占用，让底限上升对用户可见而不是隐形的。接口详细设计如下。

### 用户接口详细设计（决策 1 落地）

接口分三层：**内核配置键 → 宿主设置暴露 → 状态可观测**。每一层都复用现有机制，不新造通道。

#### 接口 1 · 内核配置键 `userVerbatimKeep`（acpk）

| 项 | 值 |
|---|---|
| 配置键 | `userVerbatimKeep`（顶层，与 `preserveRecentMessages` 平级） |
| 类型 / 校验 | 整数 ≥ 0；负数或非整数 → `validateConfig` 报 `userVerbatimKeep must be an integer >= 0`（对齐 `truncate.terminalEscapeAfter` 的校验写法，`config.ts:112-118`） |
| 默认值 | `0` = **方案 A**：全部 user 消息原文保留 |
| `N > 0` | **方案 B**：最近 N 条 user 消息原文保留，更老的允许进 T3（仍须过改进 3 保真门） |

**为什么默认值取 `0` 而不是 `Infinity`**：配置值会被宿主 settings 层序列化（profile patch / JSON），`Infinity` 进 JSON 即坏；且 `0 = 一条都不许压` 在 `/acp-prune config` 列表里比 `Infinity` 好解释。`0` 同时让「默认即方案 A」成立——不配任何东西就是全禁。

**与 `preserveRecentMessages` 的关系**：两者不同轴——后者是 truncate 的位置保护（最后 N 条、不分角色），前者是 user 消息的压缩豁免，互不影响，不共用数值。

**落点**

| 文件 | 改动 |
|---|---|
| `acpk/src/types.ts` | `Config` 增 `userVerbatimKeep?: number` |
| `acpk/src/config.ts` | `defaultConfig` 增默认值 `0`（置于 `preserveRecentMessages: 5` 旁，第 32 行附近）；`validateConfig` 增整数校验 |
| `acpk/src/compress.ts:849` | `protectedFn` 按配置分流（拟改见上） |
| `acpk/src/prune.ts:288` | 钉全部受保护 user 消息（方案 A = 全部；方案 B = 第一条 + 最近 N 条） |

#### 接口 2 · 宿主设置暴露（bcdsh，复用六旋钮模式）

宿主侧**一个文件搞定**：`bcdsh/src/settings.ts`，完全照现有六个旋钮（`modelContextLimit` / `autoNudge` 等）的模式加字段：

| # | 位置 | 改动 |
|---|---|---|
| 1 | `SETTINGS_KEYS`（第 40 行） | 数组增 `'userVerbatimKeep'`（定义 `/acp-prune config` 的列出顺序，放末位） |
| 2 | `AcpSettings` / `AcpSettingsInput` / `AcpSettingsCompositionEntry` | 三处各增 `userVerbatimKeep?: number` |
| 3 | `SETTING_DEFAULTS` | 增 `userVerbatimKeep: 0`——与内核 `defaultConfig` 的默认值镜像，由 `tests/settings.test.ts` 逐字段比对锁死 |
| 4 | `filterSettingsEntry` / `resolveAcpSettings` | 各增透传与 `?? 0` 回退 |
| 5 | `AcpSettingsSchema` | 增 `z.number().step(1).min(0)` |
| 6 | `AcpPluginConfigSchema` | 增 `markVolatile(z.number().step(1).min(0))`——`.volatile()` 标记使其成为设置表单里可热编辑的行 |
| 7 | `describeSettingsChange` | 增 effect：该项变化**不**需要 `clearWindowCache` / `clearNudgeDedup`（不涉及窗口与 nudge 去重），下一 step 的 `assignRefs` 自然读到新值；新增 warning：值由 `0` 改为 `>0` 时提示「老 user 消息将可进 T3，引用保真依赖改进 3 落地」 |

**用户操作路径（生效链）**：设置 UI 或 `/acp-prune config set userVerbatimKeep 12` → SettingsForms 经 `makeSettingsCommandSurface` 写入 profile patch（带 revision 乐观锁）→ 值落在 volatile ref 上 → `liveSettingsFromRefs`（第 137 行）每 step 重读 → 引擎 config 更新 → `assignRefs` / `prune` **下一 step 生效，无需重启**。`/acp-prune config` 的列出与读写由 `SettingsCommandSurface` 通用承载，无需为单项新写命令。

#### 接口 3 · 状态可观测（acp_status）

`report.ts` 的 `renderOverview`（第 234 行）在 `CONTEXT BREAKDOWN` 段之后增出一节。`VisibleMessageInfo` 已带 `isUser` 字段（`report.ts:142`），**采集层零改动**，只加渲染：

```
USER MESSAGE PROTECTION
  userVerbatimKeep=0 (all user messages preserved verbatim)
  user messages: 12 msgs / 3,421 tok (8.4% of visible) — irreducible floor
```

方案 B 下首行显示 `userVerbatimKeep=12 (last 12 preserved; older may enter T3)`。这同时兑现改进 1「可观测」验收与 R1 风险的可见性要求：底限上升从此有数字，不是隐形的。

#### 接口本身的验收

- **默认行为**：不配 `userVerbatimKeep`，对任意 user 消息构造压缩范围断言抛错（即改进 1 主验收；默认 = 方案 A）；
- **分级行为**：配 `userVerbatimKeep=2` 后，第 3 老的 user 消息可进压缩范围，最近 2 条仍抛错；
- **宿主链**：`/acp-prune config set userVerbatimKeep 12` 写入成功，`snapshot()` 读回 12，下一 step 的 `acp_status` 显示 `userVerbatimKeep=12`；
- **热生效**：运行中改值不重启，下一 step 生效（断言同一会话内改值前后 protectedFn 行为变化）；
- **校验**：`userVerbatimKeep = -1` 被 `validateConfig` 拒绝，错误串可 grep。

**必须复查的连带影响**

| 坐标 | 影响 |
|---|---|
| `boundaries.ts:344` | 跳过 `BLOCKED_REF`，压缩范围边界无法落在 user 消息上——正是期望行为，模型选范围会自然避开 |
| `recommend.ts:99,137` | `computeProtectedRefs` 跳过 `BLOCKED`——无影响，这些消息已被更强地保护 |
| `recommend.ts:159` `buildCompressibleRanges` | 推荐菜单不再广告 user 消息——期望行为 |
| `report.ts:148` | `pendingGap` 统计遇 `BLOCKED_REF` 会重置，需确认统计口径不被扭曲 |
| 宿主 native compaction | 与 ACP 争同一 ref 空间是**既有故障**（session-063661eb seq 1015 `stale-ref`）。本次改动不收窄它，但回归必须覆盖 |

**验收**

- 单测：对任意 user 消息构造压缩范围，断言 `applyCompression` 抛错，且错误信息中含该 user 消息的 id（取 fail-loud：不在范围构造阶段静默过滤——「静默移出」会让保护生效却无人知晓，与改进 3 保真门同一风格）；
- 用 session-063661eb 回归：b1 摘要不得出现「先把三个包的npm发布硬性要求准备好」被改写成「评估完成，待执行修复」这类丢失「先」字的转述；
- 冒烟：按第 4 节《验收总标准》冒烟条执行（冷端口起 DSH，ACP 插件加载正常，`acp_status` 返回 200）。

---

### 改进 3（对应原第 3 项）· 摘要引用保真门（代码层）

**优先级：最低（风险最高，前两项落地并稳定后再做）**

**落点**：`acpk/src/compress.ts` `applySingleRange` 内，`validateCompressionRange`（1409 行）**之前**。

选此处的理由：此处 `throw` 会被上层 `catch`（`compress.ts:654`）转成 `rangeError(spec, message)` 压入 `errors` 返回给模型——**反馈通道已经存在且模型可见**，不需要新增协议，模型当回合即知摘要不达标并可重写重试。

**门逻辑**

1. 从 `filteredIds` 中取出所有 `role === "user"` 的消息；
2. 逐条抽取「必须出现的句子」：
   - 消息 ≤ `QUOTE_FULL_MAX_CHARS`（建议 500）→ 整条必须出现；
   - 消息 > 该值 → 按中英文句末标点切句，抽取含强调标记的句子。标记集：`必须 / 务必 / 一定 / 只能 / 只需 / 先 / 再 / 不要 / 别 / 禁止 / 重点是 / must / never / don't / only / first / required`；
3. 匹配前做归一化：空白折叠、全半角统一、引号统一；
4. 缺哪条就把哪条列进错误信息并 `throw`。

**必须写进风险说明的边界情况**

- **长度冲突**：`compress.maxSummaryLength` 为 20000 字符，一条长指令整条引用可能超限。超限时降级为「引用强调句 + 引用首尾各 200 字符」。
- **误报**：模型对用户指令做了合理解释而非照抄时，门会误拒。缓解：允许「原文出现」或「全部强调句出现」二选一；错误信息中明确说明这是保真门而非内容审查。
- **失败率上升**：这门会显著提高 compress 调用失败率。**建议先以 warning 模式跑一段会话**（只报不拒），统计误报率后再切成硬门。

**验收**

- 单测：对一条丢失强调句的摘要断言抛错，且错误信息中含缺失句子原文；
- 单测：对合规摘要断言不抛错；
- 误报率观测（**交付物，非门禁**——决策 3）：warning 模式下跑真实会话，输出误报率报告（每条误报的原文 / 摘要对照 + 误报率数值 + 观测会话数）。切硬门的时机由用户根据该报告复审决定，**不设数值门禁**：门禁若写死，落地初期根本无法测完，只会催生「为达标而达标」的注水数据。

---

## 3. 施工顺序与依赖

| 阶段 | 内容 | 依赖 | 说明 |
|---|---|---|---|
| 0 | 基线冻结 | — | 由实施者执行：`acpk` / `bcdsh` 全量 MD5 存档至 `_bc-src/baseline-<YYYYMMDD>/md5.txt`（`Get-FileHash -Algorithm MD5`，逐文件一行）；跑 `acpk` 现有测试（`npm test`，预期退出码 0）；按第 4 节冒烟条冷端口起 DSH 一次并留存 `acp_status` 输出 |
| 1 | 改进 2 | 阶段 0 | 一行改动，风险最低 |
| 2 | 改进 5 步骤 5a 插桩 | 无（独立源代码树） | 与阶段 3 可并行 |
| 3 | 改进 1 | 阶段 0；方案已定（A 默认 + B 逃生阀，接口设计见改进 1《用户接口详细设计》） | 改保护语义 |
| 4 | 改进 5 步骤 5b 施策 | 阶段 2 数据 | 策略由插桩结论定 |
| 5 | 改进 3（warning 模式） | 阶段 3 完成 | 先观测误报 |
| 6 | 改进 3（切硬门） | 阶段 5 误报率观测报告 + 用户复审 | 最后一步；无固定数值门禁（决策 3） |

> 顺序语义：阶段号仅作标签，不构成严格执行序；实际次序由「依赖」列与「可并行」说明决定。跳过一个被依赖的阶段会使后续阶段失去输入（如无阶段 2 的插桩数据，阶段 4 只能凭候选表盲试）。

---

## 4. 验收总标准

1. **功能**：上述各改进的单测全部通过；
2. **回归**：session-063661eb 重放，b1 类摘要不再发生用户指令强调信息丢失；
3. **冒烟**：冷端口启动 DSH（既有启动纪律：`-WebPort <port> -PortConflict None -NoBrowser -NoPause -NoSelfCheck`，测完即关、释放端口），断言——启动日志无 `pending (waiting for service:` 与 `did not activate`；`curl --noproxy '*'` 请求 `acp_status` 返回 HTTP 200 且响应体含 ref 统计字段；`compress` / `decompress` 以一次最小范围往返验证（退出码 0 且回读内容一致）；
4. **可观测**：`acp_status` 暴露用户消息 token 占用与重复注入比值，使底限变化对用户可见。

---

## 5. 风险与未决问题

| # | 风险 | 归属 | 状态 |
|---|---|---|---|
| R1 | 改进 1 方案 A 使不可压缩底限上升，长会话更早触发 emergency | 改进 1 | 已定：A 默认 + B 逃生阀（接口见改进 1）；底限上升经 `acp_status` 可见 |
| R2 | 改进 2 使 `terminalEscape` 更易触发，用户会更频繁被要求开会话 | 改进 2 | 随决策 2 一并采纳；需向用户明示 |
| R3 | 改进 3 保真门误报，阻断合法压缩 | 改进 3 | warning 模式观测 + 用户复审切硬门（决策 3，无数值门禁） |
| R4 | 宿主 native compaction 与 ACP 争同一 ref 空间（seq 1015 `stale-ref` 实锤） | 既有 | **本次不修**，回归须覆盖 |
| R5 | 273,017 字符的真实浪费率未定，改进 5 策略可能因此调整 | 改进 5 | 待 5a 插桩数据 |
| R6 | 改进 1 后 `report.ts:148` 的 `pendingGap` 统计口径可能被 `BLOCKED_REF` 扭曲 | 改进 1 | 实施时复查 |

---

## 6. 明确不做的事

- 不动三层分级（T1/T2/T3，定义见配套文档 §1.5）与触发阈值体系（配套文档 §1.4）；
- 不复活 age-based GC（该机制曾因上游记忆丢失被移除，`acpk` 无 GC 是现状）；
- 不实现 protected-tools 硬排除（`boundaries.ts:154` 的 `protectedGaps` 恒为 `[]` 是已知限制，本次只补 user 角色，不扩大范围）；
- 不接管宿主 compaction、不解决双引擎冲突（独立议题，见 R4）；
- 不做第 4 项（纠正类指令单独标记）——待本计划落地后单独立项。

---

## 7. 决策记录（2026-10-25 已确认）

1. **改进 1：默认方案 A + 可调方案 B。** 用户接口已详细设计（见改进 1《用户接口详细设计》）：内核配置键 `userVerbatimKeep`（默认 `0` = 全部 user 消息原文保留；`N>0` = 仅最近 N 条）；宿主经 `bcdsh/src/settings.ts` 六旋钮同款模式暴露（`SETTINGS_KEYS` + `.volatile()` 热生效 + `/acp-prune config` 读写）；`acp_status` 输出当前值与用户消息 token 占用。
2. **改进 2：按建议写法——显式 `includeTextMessages: false`。** 不新增配置项（三写法等价性已实证，见改进 2）。
3. **改进 3：接受「先 warning 后硬门」两段式。** 误报率观测作为交付物（报告），切硬门时机由用户复审决定，**不作为硬性验收门禁**——落地初期无法测全，写死数值只会催生注水数据。
