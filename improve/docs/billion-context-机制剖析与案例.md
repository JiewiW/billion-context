# billion-context（ACP）上下文压缩机制剖析 —— 基于 acp-kernel 源码与一次真实 DSH 会话

> 交付日期：2026-10-25
> 研究对象：`billion-context` 家族（上下文压缩 / 上下文剪枝）
> 证据来源：GitHub 原始仓库源码 + 本机一次真实 DSH 会话（`session-063661eb`，2026-10-22）
> 说明：本文所有机制结论均可回溯到具体源码文件；凡日志未能证实的推断，均已标注「**未确认**」。

---

## 0. 先校准对象：它到底是什么，代码在哪

"billion-context" 不是一个单一仓库，而是一个**家族**。搜下来是三条线：

| 仓库 | Star | 角色 | 状态 |
|---|---|---|---|
| `ranxianglei/billion-context` | 2596 | **官方统一版**，同时支持 pi / OpenCode / Claude Code 等二十余宿主 | 活跃，作者推荐用它 |
| `ranxianglei/billion-context-pi` | 261 | 原始 Pi 适配版 | 历史版本 |
| `Tyan66666/billion-context-dsh` | 162 | DeepSeek Harness（DSH）适配版 —— **你本地装的就是这条** | **已停止维护**，README 顶部明确让你改用官方版 |
| `ranxianglei/acp-kernel` | 41 | **压缩内核本身**，零运行时依赖，ACP = Active Context Pruning | 单一事实源 |

**关键结构关系是理解全部机制的前提**：

```
billion-context-dsh（适配器，薄）
   └─ 复用 acp-kernel（内核，纯函数，零 I/O）
        └─ 宿主注入 countTokens + 消息列表；流失的数据一律由适配器负责

billion-context（官方统一版）= 同一套 acp-kernel + 更宽的宿主适配层
```

所以**你遇到的问题，绝大部分不在 DSH 适配层，而在内核的通用设计取舍里** —— 而官方统一版沿用同一内核，意味着其中大部分取舍换过去依然存在。这点很重要，先说在前面。

本机核对结果：

- `D:\dsh\node_modules\billion-context*`：**已不存在**，确认卸载干净；
- `~/.dsh/profiles/*/cordis.patch.yml`：无 `compaction-acp` 挂载行，无 ACP 残留；
- `~/.dsh/` 下无 `acp` / `billion` 命名文件。

但意外收获：**找到了一条仍在插件挂载状态下跑出来的会话**（详见第 3 节），所以本文的案例不是推演，是**现场证据**。已克隆源码到本机供你改设计时对照：

```
D:\dsh\_bc-src\bcdsh\   ← Tyan66666/billion-context-dsh（含 src/*.ts）
D:\dsh\_bc-src\bcpi\    ← ranxianglei/billion-context-pi
D:\dsh\_bc-src\acpk\    ← ranxianglei/acp-kernel（核心，20.5k 行）
```

---

## 1. 原理概述

### 1.1 一句话心智模型：它不是 zip

`acpk/DESIGN.md` 第 1 节开宗明义：

> **zip** 自己算出压缩结果（bytes → bytes）；
> **acp-kernel** 的**摘要文本由外部（LLM）产出并作为参数传入**。内核只决定*何时*压缩、*压缩哪个区间*、维护*状态*、应用*决策*、剪枝、支持解压/检索。**它从不调用模型。**

这是整套设计里最核心的一条，也解释了后面绝大部分行为：

- 内核因此能做成一个**零状态的纯函数库**（`state` 是每次调用的入参和出参，持久化由宿主负责）；
- **压缩质量的上限完全取决于模型写摘要的能力**，内核无从纠偏 —— 写砸了就是永久错；
- 「有没有漏掉关键信息」这个问题，**内核侧几乎无法回答**，它没有第二双眼睛。

### 1.2 分层

```
┌──────────────────────────────────────────────────┐
│ CORE（纯 TS，零宿主依赖，MIT）                     │
│   无状态、无 I/O：state 是入参也是出参             │
│   processTurn / applyCompression / resolveBoundaries │
│   decompress / search / status / decideNudge      │
└───────────────┬──────────────────────────────────┘
                │ 纯函数调用
┌───────────────┴──────────────────────────────────┐
│ ADAPTER（薄，每宿主一份）                          │
│   每回合把消息喂进内核 / 自己持久化 state           │
│   把 NudgeDecision 渲染成宿主消息格式              │
│   注册工具 / 命令 / 生命周期钩子                   │
└──────────────────────────────────────────────────┘
```

### 1.3 每回合流水线（真实节点顺序）

`acpk/src/compress.ts:795` 的 `buildNodes()`，顺序如下，**每一回合都跑**：

```
reconcile-live-ids → assign-refs → sync-blocks → prune → ccr-store
→ absorb-hide → crush → absorb-prompt → filter → hide-compress-calls
→ recommend → nudge-inject → emergency-truncate → render-refs
```

注意 **prune 是每回合重建可见视图**，不是压缩时才做。这点常被误解。

### 1.4 触发时机与条件

**它不是一个硬性上下文上限。** 默认配置（`acpk/src/config.ts:7`）：

| 参数 | 默认值 | 含义 |
|---|---|---|
| `modelContextLimit` | 自适应探测（兜底 128000） | 模型真实窗口 |
| `nudge.minContextLimitPct` | **0.45** | 低于此占用率**根本不提醒** —— 这是 nudge 的阈值门 |
| `nudge.maxContextLimitPct` | 0.75 | 注释写明「currently advisory」 |
| `nudge.growthRatio / growthFloor / growthCap` | 0.05 / 50000 / 50000 | **增量门**：自上次压缩起新长出的 token 够多才提醒 |
| `nudge.minGrowthFloor / minGrowthRatio` | 20000 / 0.45 | 最小收益地板：省得太少就不值得动 |
| `nudge.emergencyThresholdPct` | **0.95** | 高压档，此时忽略 tier 优先级、直接选 pending 最大的层 |
| `truncate.threshold` | 0.95（+`terminalEscapeAfter: 3`） | **最后安全阀**：紧急工具输出截断 |
| `compress.minCompressRange` | **5000 字符** | 小于此值 apply 侧直接拒绝 |
| `compress.minSummaryLength / maxSummaryLength` | 50 / 20000 | 摘要长度闸门 |
| `promotionThreshold` | **5** | 区块存活 5 回合后 young→old，触发合并 |

**触发链路**（`compress.ts:1692 decideNudge`）：

1. 每回合算 `usage = tokenCount / modelContextLimit`；
2. `usage < 0.45` → 不提醒（`recommend` 仍会算出可压区间，但不出声）；
3. `usage ≥ 0.45` 且**自上次基线新增 ≥ growthFloor** → 才注入 nudge；
4. 有个「首见质量豁免」（`#194`）：初次吞入大段历史时基线直接锚定为当前值，避免"一次性涨了很多"被误判成持续增长；
5. `≥ 0.95` 走高压分支；`truncate.threshold=0.95` 且**没有任何一层能回收最小收益，并且紧急截断也没省下东西**，连续 3 次 → 报 `terminalEscape`（放弃治疗信号）。

一句话：**ACP 的默认姿态是「只建议，不强令」**。唯一的例外是宿主上报的**确认超窗**，此时引擎会自己抢救一次（对应 DSH 适配层的 `maxOverflowRetries`）。

### 1.5 分级策略：三级阶梯 + 只合并不丢弃

区块类型 `CompressionBlock`（`DESIGN.md §3`）：

```ts
{
  blockId: "b0"/"b1"...,
  tier: 1 | 2 | 3,
  topic?: string,              // 模型给的话题标签
  summary: string,             // ★ 模型亲写
  directMessageIds / effectiveMessageIds,   // 直接覆盖 / 有效覆盖（含嵌套）
  directBlockIds: [],          // 嵌套吞掉的区块（这就是层级）
  createdAt, survivedCount,
  generation: "young" | "old",
  active: boolean
}
```

三级爬升：

| 层 | 输入 | 尺寸目标 | 保留什么 |
|---|---|---|---|
| **T1 原始改写** | 真实对话原文 | 由模型按 "HOW TO COMPRESS" 规则定 | 路径+行号、签名、报错原文、决策+原因、约束、精确值、带 ref 的用户原话、未完目标 |
| **T2 蒸馏** | 若干 T1 摘要 | **50–150 tok / 源区块** | 只留决策与原因、最终结果、教训、约束、架构决策、未完目标；**丢**精确行号、diff、完整签名、构建/评审过程 |
| **T3 超压缩** | 若干 T2 摘要 | **30–60 tok / 源区块** | ¹运输出/KG、²未完工作、³架构决策、⁴硬约束；1–3 条事实/区块，纯索引 |

触发 T2/T3 的闸门是**区块计数**（`tiers.tier2Trigger=1000`、`tier3Trigger=2000`），配合 young→old 晋级。注意：**没有 GC**（注释明确写着 age-based deactivation 曾被移除，因为它导致上游记忆丢失）。

### 1.6 压缩后保留的信息形态

- **可见视图**：每回合 `prune` 重建 —— 被 active 区块覆盖的消息整体移除，在区块最早覆盖位置插入一条 `acp_summary_bN`（正文是 `[Compressed conversation section]` + 摘要 + ref 区间）。
- **首个用户消息永不被 prune**（`DESIGN.md §8.1`）：即使被压缩范围覆盖，也会**摘要 + 首条用户原文并存**。这是为了兼容「对话必须从 user 起」的严格 provider。副作用：初心 often 是任务描述，很长，压缩比因此打折扣。
- **原文不丢**：原文仍在 append-only 会话日志里，`decompress(blockId)` 可还原，`search_context(query)` 可在块内检索。
- **图片转存**（`image-compress`）：inline 图片折叠成 `[image: png 1285x1250 · m00343]`，像素可通过 `decompress({imageRef})` 取回。

---

## 2. 判据详解：三类 step 到底怎么分

这是你问的重点。答案是：**判定分三层，真正做语义判断的那一层不是规则引擎，而是模型自己 —— 规则以 prompt 文本的形式存在。**

```
层 1  内核硬判据（白名单/黑名单，不可协商，模型无权改）
层 2  推荐层（算出"哪里可压"，告诉模型选，模型仍有最终决定权）
层 3  语义层（模型按 prompt 里的 KEEP/DROP 规则亲写摘要 —— 真正的分级在这里）
```

### 2.1 层 1：内核硬判据（`src/protected.ts`，模型无法推翻）

| 判据 | 代码位置 | 行为 |
|---|---|---|
| `ALWAYS_PROTECTED_TOOLS = ["compress", "acp_rule"]` | `protected.ts:10` | 永不可压。理由：compress 调用自带摘要，压掉它就断了 decompress/search 的锚 |
| `protectedTools`（配置，支持 `xxx*` 后缀通配 + 大小写不敏感） | `protected.ts:109` | 如配 `skill` 则技能内容永留 |
| `isToolProtected(name, text)` 回调 | `protected.ts:113` | 宿主自定义 predicate |
| `protectedLatestTools` | `protected.ts:171` | **只保最后一次**（适合 `todo_write` 这类累积快照工具，旧的同名调用照压） |
| `NEVER_PRESERVE_RECENT_TOOLS = ["decompress","search_context","read","bash"]` | `protected.ts:31` | 这四类结果**不占"最近保护窗口"名额**，方便立刻再压 |
| `preserveRecentMessages=5` + `preserveRecentTokens=5000` + **最后一条用户消息** | `recommend.ts:104/111/132` | 尾部软保护带 |
| `hasMediaPayload`（图片/附件 base64） | `protected.ts:230` | 永不可压 —— 折叠后字节彻底消失，且内核无服务端存档 |
| `minCompressRange=5000` 字符 | `config.ts:26` | 区间太小 apply 侧直接拒 |
| **回合完整性 INV1/INV2** | `turn-integrity.ts:138` | ①留着 assistant tool-call 就必须留它的 reasoning 段；②tool-call 与 tool-result 必须同生共死。违反则整条 turn 撤回（避免出现 provider 拒收的残缺请求） |

> 注意一个**盲点**：`protected-tools` 的**硬排除在内核里故意没实现** —— `DESIGN.md §4` 写明 `protectedGaps` 「reserved（currently always []）」，README 把它列为 Known limitation。也就是说**保护是通过"不推荐给模型"实现的，而不是真禁止**：模型要是硬压，内核并不会拦。

### 2.2 层 2：推荐层（`src/recommend.ts` + `src/segment.ts`）

先剔掉：已折叠/合成摘要/被保护/媒体/最近窗口；剩下的连续段才是"可压候选"。分段规则（`segment.ts:40`，写得极讲究）：

- **按数组邻接**，绝不用 ref 算术（宿主的 surface-replace 会在 ref 图上留洞）；
- 数组物理断裂 → 必分段；
- **用户消息 → 新开一段，但仅当当前段已有 ≥3 条**（否则用户一问一答会把每段切得太碎）。

再用 `mergeRangesToThreshold` 把相邻小区间并到 ≥5000 字符，避免推荐出 apply 侧必然拒绝的区间（issue #847 的修复）。

**这一层只是「给模型一张菜单」，选什么、怎么写摘要，还是模型拍板。**

### 2.3 层 3：语义层 —— 真正回答你的 (a)/(b)/(c)

规则以**纯文本常量**的形式写在 `src/compression-rules.ts`（注释里写明是从 context-compress-algorithms 逐字 COPY 过来、并经数月生产调过的）。下面把你的三类问题对进去。

#### (a) 已完全过时、可整段丢弃的局部子提示

**规则原文（DROP 段）**：

- `Verbose logs (build/test/npm output) once you have captured the error line or the result.`
- `Duplicate file reads once the needed content is recorded.`
- `Consumed exploration — search hits, agent return values, successful tool outputs — once you have extracted the facts you need.`
- `Back-and-forth discussion and self-corrections once the final position is captured (keep the outcome, drop the journey to it).`
- `Repeated status checks (git status, ls) once state is known.`
- T2/T3 附加： `[OBSOLETE]` / `[SUPERSEDED by PR #NNN]` 标记的内容直接丢，只留标记。

**典型信号**（可从日志/trajectory 直接观测）：

| 信号 | 例子（本会话实到证据） |
|---|---|
| 同一份 runtime-context 快照重复注入 | 本会话出现 7 次，1029–5677 tok/次 |
| 同一文件被 read 多次 | `package.json` 三包各读一次，读完转成结论后原 JSON 即无用 |
| 一次性加载的 skill / system-reminder | `github-git-sync-hardrules` 内容 4778 tok，读完就完成使命 |
| 已成功的探索性工具输出 | `glob` 命中列表、`git tag` 列表、`ls` 输出 |
| 状态检查类 | `git status`、`npm whoami`、`Count ----- 39` |
| 探测失败且已被绕过的路径 | `fatal: not a git repository`、`No files found` |

**兜底要求**（很聪明的一条）：每个被 DROP 的大件必须留**一行内容描述**，而不是位置描述 —— 坏例子 "probe script at /path/x.py"，好例子 "probe_kvnet.py：测 n-gram 基线、生成质量、长程依赖…"。这样日后 `search_context` 能按**相关性**命中，而不是按路径猜。

#### (b) 含关键结论 / 最终产物 / 不可逆副作用，必须完整保留

**规则原文（KEEP VERBATIM 段）**：

- 完整文件路径**带行号**，每次提及都要带目录前缀（`lib/hooks.ts:347`）**——不许缩写成裸文件名**；
- 函数/类/类型签名**和承载逻辑的关键代码行**（注释举例：`kv_keys += define_gate * a_key[i](emb)` 比 "see model_kvnet.py" 有用）；
- 错误消息与堆栈（**逐字** —— 日后要靠字面串去 grep）；
- 报告/分析的关键细节，包括**比较数字和机制**（要写 "1.76× PPL gap because KV store is static"，不能写 "KVNet 更差"）；
- 决策及其理由（"chose X over Y because Z" —— **because 是承重结构**）；
- 发现的约束（"must support Node 22"、"no new dependencies"）；
- 精确值：版本、配置键、阈值、魔数；
- 用户意图短引用**必须带 ref**（`User said (m00132): "ship it tonight"`）；**没有可验证 ref 就只能转述** —— 这是唯一允许跳出逐字规则的地方（2026-09-06 事故后加的：曾把一个**编造的**"用户原话"存成活指令，导致后续无限复活旧任务）；
- **未完目标（`Open objectives:` 行）** —— 注释称它是「最后一个该丢、第一个该恢复的东西」；
- 用户总目标及其演变（"起初修 bug X → 发现根因后转向重构 Y"）；
- 每个关键动作的目的（假设、问题、动机）；
- **关键锚点的 message ref**（`m00420`）—— 给日后 decompress 跳回原文用。

**不可逆副作用**这一项，规则里**没有专门的工具名单**，它是靠「最终产物」和「决策 / 结果」这两条间接着陆到摘要里的 —— 这是我认为最值得在你改造时加固的一点（见第 4 节）。

**优先级（空间不够时从 1 往下砍）**：
1 用户总目标/意图/硬约束 → 2 决策与理由 → 3 精确技术产物 → 4 结论与关键发现 → 5 教训
（原文特别加了一句："Losing these changes the task itself"）

**典型信号**：`write`/`edit` 落盘成功、`git commit` + `git push --tags`、`gh release create`、`npm pack --dry-run` 的结果数字、注册表状态（404 / already exists / 403）、包含结论表的最终回复、`> TASK AS OF BLOCK` 状态记录。

#### (c) 只是一笔带过的中间探索细节

规则把 (c) 归在 DROP，但**要求保留"教训一行"**：

- `Dead-end exploration — but PRESERVE the lesson in one line: "tried X, failed because Y".`
- T2：`if a block was exploratory with no decision, keep the CONCLUSION in one line ("explored X, not viable because Y"). Do not keep the exploration process.`
- T3：**连教训都丢**，除非「该失败很可能复现且区块 <30 天」；T3 明确自我定位为 "a lookup index, not a knowledge base"。

**信号**：`glob`/`grep` 的命中列表、`ls`/`tree` 输出、多轮往返的自我修正过程、逐渐加码的参数重试、被放弃方案的细节。

---

## 3. 案例解剖：`session-063661eb`（2026-10-22 真实会话）

### 3.1 为什么这条会话是绝佳样本

按你的要求，我用 `~/.dsh/skills/dsh-session-log-extract` 翻找 10-22 及以前的会话。先说明两点如实情况：

1. **10-22 那天第一个候选 `session-7c423028` 是空会话**（解压只有 392 字节、仅含 header + end-seed），弃用；
2. 但第二个候选 **`session-063661eb` 不仅内容丰富，而且是在 billion-context-dsh 挂载状态下跑出来的** —— `request/header`（seq 14）里注册的完整工具表中有：
   `acp_cache` / **`acp_status`** / **`compress`** / **`decompress`** / **`search_context`**。

也就是说：**我们拿到的不是"如果压会怎样"的推演，而是插件真跑、模型真写了摘要、内核真报了省了多少 token 的现场记录。**

会话概况（用 `zstd` 解压得到 1980 个事件、5.2MB 明文 JSONL）：

| 项 | 数值 |
|---|---|
| 任务 | 核验 cot-anchor / step-governor / derive-watcher 三包能否发布到 npm，并实际发布 |
| 模型 | Doubao-Seed-Code（窗口 184000），中途切 hy4-preview / Doubao-Seed-2.1-Turbo / glm-5.3-flash |
| 可见消息数（重构出的 ref 空间） | **634 条**（m00001–m00634） |
| 全事件累计 token 估算 | **404,145**（含大量重复注入的 runtime-context 快照） |
| ACP 工具调用 | **7 次**（3 次成功批量压缩 / 1 次失败 / 1 次解压 / 2 次检索） |
| 宿主自带 compaction | **7 次**（其中多次报错：abort / 超窗 / 429 配额耗尽） |

> token 估算口径与内核一致（`acpk/src/tokenize.ts`）：**CJK 字符 1 token/字，其余 chars/4**。

### 3.2 ACP 真实活动全序列

| seq | 调用 | 结果 |
|---|---|---|
| **347** | `compress` 提交 3 段 | ✅ 成功产出 **b1 / b2**，报 **~32,856 tokens saved**；第 2 段因与第 1 段重叠被跳过（ kernels：earlier range takes precedence） |
| **647** | `compress` 提交 3 段 | ✅ 产出 **b3 / b4 / b5**，报 **~52,456 tokens saved** |
| **1015** | `compress` 提交 1 段 | ❌ **失败**：`every ref is unknown to this session … highest allocated ref=m00006` |
| **1131** | `compress` 提交 3 段 | ✅ 产出 **b6 / b7 / b8**，报 **~75,443 tokens saved** |
| **1155** | `decompress(b7)` | ✅ 还原 **168 条 / 157,979 字符**，写入临时文件让模型自己 `read` |
| **1232** | `search_context("豆包 npm 发布路线…")` | ✅ 命中 **5 个区块** |
| **1238** | `search_context("Staged 暂存发布…")` | ❌ **`No compressed blocks exist yet — nothing to search.`** |

两次失败的原因见 3.5 —— 它们是整套机制最有价值的部分。

### 3.3 逐 step 解剖：`m00001–m00061`（第一次压缩的第一段）

这段就是「三包 npm 发布就绪性评估」，共 **61 条消息、47,467 tok**，被压缩成 **b1（1025 字符 ≈ 370 tok）**。下表按 ref 顺序逐条标注类别与处置：

| ref | 工具/角色 | tok | 类别 | 处置 | 依据 |
|---|---|---|---|---|---|
| m00001 | 用户原始诉求 | 28 | **(b)** | **完整保留+ref**（`用户请求（m00001）…`） | 目标锚点 + Open objectives 必须有 ref |
| m00002 | system-reminder 工作区指令 | 4666 | **(a)** | 整段丢弃 | 一次性注入，读完即焚 |
| m00003 | runtime-context 快照 | 1029 | **(a)** | 整段丢弃 | 每回合重复注入，后一份即取代前一份 |
| m00004 | 后台未完任务提示 | 150 | **(a)** | 丢弃（CPI 非本次任务） | 与当前任务无关 |
| m00005 | system-reminder 技能清单 | 5385 | **(a)** | 整段丢弃 | 目录型内容，用到才查 |
| m00006–09 | 3×glob 探测 | 16+83r / 10 / 4 / 4 | **(c)** | 只留结果一句话 | 属 consumed exploration；2 条 `No files found` 属 dead-end |
| m00010 | pwsh: `fatal: not a git repository` | 23 | **(c)** | 留教训一句（或未留） | dead-end，规则要求留 "tried X, failed because Y" |
| m00011 | runtime-context 快照 | 5677 | **(a)** | 整段丢弃 | 重复注入 |
| m00013–14 | 2×memory_recall | 1653 / 1919 | **(c)** | 结论入库、原文弃 | 已提取所需事实，属 consumed exploration |
| m00015 | runtime-context 快照 | 1029 | **(a)** | 丢弃 | 同上 |
| m00017 | pwsh 列出本地仓库路径 | 138 | **(b)→摘要** | 绝对路径保留 | KEEP VERBATIM 第 1 条：路径 |
| m00019–21 | 3×read package.json | 394/427/407 | **(c)** | 原文弃，关键字段转摘要 | duplicate read once recorded |
| m00022–24 | 3×pwsh git tag + log | 85/110/74 | **(c)** | 版本号进摘要 | 精确值要保，cypher/log 原文不必 |
| m00025 | 语义旅程 summary 注入 | 113 | **(a)** | 丢弃 | 另一系统的陈旧总结，且自带"可能过时"免责声明 |
| m00027–29 | 3×pwsh remote/状态 | 64/66/72 | **(c)** | 合并为"三仓库 clean、remote 正确" | repeated status checks |
| m00031–33 | 3×pwsh tag + GH release | 454/79/474 | **(b)→摘要** | tag 名与 Release 状态进摘要 | 最终产物/不可逆副作用 |
| m00035 | pwsh registry 查：发现 `0.0.0-stage` stub | 266 | **(b)** | **关键发现逐字保留**（含 404 事实） | 影响发布路线的硬事实 |
| m00036–38 | 3×npm pack 输出 | 180/362/169 | **(b) 数字 / (c) 日志** | **数字留（4.2MB/22.9MB/120KB/34KB），清单弃** | KEEP 要求"保留比较数字和机制" |
| m00040–43 | pwsh 内部征地 | 1239/124/80/103 | **(c)** | 丢弃，仅留"含 12.7MB+7.7MB 录音" | 形成结论的证据已入摘要 |
| m00048 | **助手最终评估表** | 1512+726r | **(b)** | 结论改写进摘要 + `TASK AS OF BLOCK` | 最终产物 → 压成结论行，不原样留 |
| m00049 | 用户新指令 | 16 | **(b)** | 作为目标演变保留 | 目标演变属 PRIORITY 1 |
| m00051 | **skill 全文**（github-git-sync-hardrules） | **4778** | **(a)** | 整段丢弃 | 加载后不再需要；若宿主把 skill 配进 protectedTools 则相反 |
| m00052/56 | runtime-context 快照 ×2 | 5020 / 1029 | **(a)** | 丢弃 | 重复注入 |
| m00054–55 | pwsh 身份/npm whoami | 87/57 | **(c)** | 合并为"身份已配、当时 401" | 状态检查 |
| m00058–60 | read + **edit 落盘** | 410/20 | **(b)** | **必须留事实**：package.json 被改、commit c255649 | **不可逆副作用** |

**这一段最重要的发现**：把 m00002/03/05/11/15/52/56 这 7 条重复注入的 runtime-context 快照加起来是 **23,835 tok —— 占该区间总量的 50.2%**。它们是纯粹的重复内容，压缩理论上能白赚一半，而这**恰恰是 DSH 宿主侧每回合重新注入造成的，不是模型"探索"产生的**。这点对你改造很有价值（见 4.3）。

### 3.4 压缩前后对照（真实摘要）

**压缩后（b1，模型亲写，1025 字符）**：

> 用户请求（m00001）核验 github 仓库中 cot-anchor / step-governor / derive-watcher 是否达到 npm 发布状态。记忆检索（memory_recall）返回三者仓库位置 `D:\dsh\dsh-cot-anchor`、`D:\dsh\dsh-derive-watcher`、`D:\dsh\dsh-step-governor`，均为 JiewiW 的 GitHub repo。Git 核验：三仓库都 clean、tag 已推远端（cot-anchor v0.3.0、derive-watcher v0.3.1、step-governor v0.1.3）、GitHub Release 已建。
>
> **关键发现**：derive-watcher 的 package.json files 字段用目录通配 `["lib/", "replay/", "docs/", "test/", ...]`，npm 走 files 字段时 .gitignore 完全失效 → `npm pack --dry-run` 输出 tarball 4.2MB、unpack 22.9MB，含 `replay/transcripts/*.jsonl` 真实会话录音（12.7MB+7.7MB）和全部 12 个 test/*.test.js。cot-anchor 和 step-governor 的 files 字段已用白名单，pack 分别 120KB 和 34KB 干净。
>
> npm 注册表检查：cot-anchor 有 2026-10-05 手动 `publish --staged` 遗留的 dsh-cot-anchor@0.0.0-stage stub（latest tag 指向它，maintainer 同一 jiewi_w）；derive-watcher 和 step-governor 均 404 不存在。derive-watcher package.json 还缺 homepage / bugs 字段。
>
> 结论：step-governor 立即可发，cot-anchor 需处理 stub 后可发，derive-watcher 必须先修 files + homepage/bugs 再发。
> **TASK AS OF BLOCK:** 评估完成，待执行修复。
> **Open objectives:** 把三个包都发布到 npm（m00001）

**对照检查 —— 三类问题的答案是否成立**：

- (a) 重复注入：✅ 一条不剩，符合 DROP。
- (b) 关键物：✅ 三条绝对路径全在；pack 的对比数字全在；`0.0.0-stage` stub 这个影响路线的硬事实在；shasum、commit c255649 在后续块里保留。
- (c) 探索细节：✅ 三个 package.json 的 1200+ tok 原文只浓缩成一句关键发现。
- 额外正确动作：写了 `TASK AS OF BLOCK:`（**历史时态**，避免后续把已完成的评估当活指令重跑）和 `Open objectives:` **带 ref** —— 这两条正是 2026-09-06 事故后加的规则，模型执行到位了。

### 3.5 两个真实失败 —— 最有价值的部分

#### 失败一：ref 空间蒸发（seq 1015）

```
Error: [Compression FAILED: None of the 1 requested range(s) resolved —
 every ref is unknown to this session, failing endpoints: startId=[stale-ref].
 Refs are per-session snapshots, assigned once when a message is first rendered;
 no compress reassigns them. …
 [diagnostics: session highest allocated ref=m00006 …
 unknown ranges in request=1/1, session history=0 compression(s), 0 block(s)]
 Do not probe for valid numbers. Run acp_status, then call the compress tool again
 using only the refs it reports.
```

模型提交的是 `m00350..m00522` 这种**高位 ref**，而此刻最高只分配到 **m00006** —— 意味着**整个 ref 空间被重置过**。内核自己的诊断给出两类可能：换模型/上游导致新 session 从 m00001 重开，或 **native-compaction rebase 同样会重置**。

**未确认点**：我在 seq 640–1020 的事件流里**没有找到 compaction 或明确的 rebase 事件**（只有若干 `turn/start`），所以"究竟是宿主原生压缩还是一次会话重建导致的重基"，**无法从日志证实**。能确认的是结果：**之前所有 ACP 状态和 ref 都作废了**。

#### 失败二：状态整体丢失（seq 1232 → 1238）

seq 1232 还能检索到 **5 个区块**（b7/b4/b2/b5 等，带区间和结论摘要）；**6 秒后的下一个 step**，同一个工具、同一次 turn 的另一次调用返回：

```
[No compressed blocks exist yet — nothing to search.]
```

**注意时序之诡异**：两次调用在同一个 turn（turn 20）的相邻 step，中间没有任何 compaction / rebase / 模型切换事件。而就在 seq 1155，`decompress(b7)` 还成功还原了 168 条内容。

**可能解释（均未在日志中证实）**：
1. 每次工具调用可能由**不同的引擎实例/realm** 处理，而 state 未在该粒度共享；
2. 该 turn 之前经历了用户连续打断（turn 17/18 均 `aborted`），实例重建导致 state 未恢复；
3. 内核的 `persist` 层在宿主 rebase 后判定 state 不可信并重建。

**但无论根因是哪个，可观测的事实是硬的：b1–b8 共 8 个区块在这一刻全部不可检索 —— 累计约 16 万 token 已压缩内容所承载的细节，对模型而言等同于失踪**（虽然会话日志里的原文还在，`decompress` 也仍可能用 blockId 取回）。

---

## 4. 效果与风险

### 4.1 规模效果（真实数据）

| 指标 | 数值 | 说明 |
|---|---|---|
| 会话全量明文 | 5.2MB / 1980 事件 | zstd 压缩后 1.75MB |
| 可见消息 | 634 条 | 重构出的 ref 空间 |
| 全事件累计 token | **404,145** | 含重复注入；这就是"原始模样" |
| ACP 三次成功压缩自报收益 | **32,856 + 52,456 + 75,443 ≈ 160,755 tok** | 内核自报，口径可信 |
| 其中单个区间最大压缩比 | m00358–m00526：**236×**（122,037 tok → 1,336 字符摘要） | 我的重构估算，口径同内核 |
| T1 摘要尺寸实测 | 338–2,286 字符（约 113–768 tok） | 落在规则 SIZE TARGET 内 |

**一处必须交代的口径差异**：我按 ref 重算 `m00001–m00061` + `m00140–m00206` 两段原文约 67,650 tok，而内核自报这次只省了 32,856 tok，**差约 2 倍**。可能原因：①内核按**当时实际可见 wire** 结算，部分内容早被前面回合折走；②tool-call / thinking payload 的计入方式与我的重构不同。**因此请以内核自报值为准**，我的重构值仅用于"同口径下看相对比例"（例如"重复注入占 50%"这类结论不受此影响，因为它只在同一口径内做除法）。

### 4.2 风险清单（按严重度排序）

| # | 风险 | 证据 / 机理 | 影响 |
|---|---|---|---|
| **R1** | **两套压缩引擎并存导致 ref 空间不一致** | DSH 自带 `compaction-basic` 与 ACP **同时**存在于同一 realm；本会话日志里 ACP 与 7 次 `compaction/*` 交错；失败一的诊断明文写到 "native-compaction rebase resets them the same way"。`billion-context-dsh` 的安装方式其实就是靠 `cordis.patch.yml` **主动禁用**宿主 `compaction-basic` 来避这个冲突（README 称此步为幂等兜底） | **致命**：ACP 的 ref 是它对世界的唯一坐标系，宿主一动坐标系就全废 |
| **R2** | **state 可获得性脆弱**（②号失败） | 同 turn 相邻 step，5 区块 → 0 区块 | **致命**：已压缩内容集体失踪，且无报错、无提示 |
| **R3** | **解压"回注"会瞬间打满上下文** | seq 1155 单次 `decompress(b7)` 还原 157,979 字符到临时文件，要求模型 `read` | 省下的全部赔回去还倒挂；这是 footgun 而非安全网 |
| **R4** | **摘要质量无下限保障** | 内核从不调模型，摘要对了错了它都不知道。代码注释 `#442` 记录了真实事故：一次多块合并（b22 ⊇ b13）**丢掉了 b13 里记录的一个仍然开放的用户转向**；`#309` 记录了把**编造的用户原话**存成活的 "CURRENT TASK" 导致循环复发 | 高：错误一旦落进摘要就是永久污染 |
| **R5** | **保护是"建议"不是"禁令"** | `protectedGaps` 恒为 `[]`，`DESIGN.md §4` 与 README 均标注 Known limitation | 中高：模型硬压关键工具结果，内核不拦 |
| **R6** | **首用户输入永久占位** | `DESIGN.md §8.1` 契约 | 中：压缩比被程序性压低 |
| **R7** | **换模型 / 宿主改造会重置 ref** | 失败一诊断原文 | 中：本会话就切了 4 个模型/上游 |
| **R8** | **高阶蒸馏几乎不会自动触发**（T2 需 1000 个 T1 区块，T3 需 2000 个 T2 区块） | `config.ts:8` 默认 | 低：意味着多数会话实际只走到 T1，三级阶梯在单会话里基本用不上 |

### 4.3 若要设计改进版：本研究可直接吸收的 5 点

1. **必须与宿主的原生 compaction 二选一。** 这是 R1/R2 的总根。建议在改造版里**彻底接管** `ctx.compaction`，而不是并存；或者退一步：**在每次判定前校验 ref 基线是否仍匹配当前 surface**（用 hash/seq 指纹），不匹配就让相关状态作废，并明确告知模型，而不是返回 "unknown ref" 让它自己蒙。
2. **把 (a) 类重复注入消灭在上游。** 本会话 50% 的 context 是 7 份重复的 runtime-context/skill 清单。这类内容**去重 / 只保留最新一份**，比事后压缩省得多，而且是**无损**的。这是我认为投入产出比最高的一改。
3. **(b) 类里的"不可逆副作用"应该做成硬清单。** 规则里现在没有写/编辑/publish/commit 的明确 KEEP 条款，全靠模型理解。建议把 `write/edit/push/publish/rm` 这一类进 `protectedTools`（或直接要求摘要里必须有 `SIDE EFFECTS:` 段落）。
4. **decompress 必须节流。** 用 `→ head -N` 或强制 `search_context` 先行，禁止整块回注；内核已在回答里这么建议（"Fingerprints show head/tail only … call search_context first"），但这只是建议。
5. **摘要写完后做一次一致性自检。** 花一次廉价的中小型模型调用去核对：①Open objectives 是否全被继承；②所有带 ref 的原话是否真能对上；③有无被写成活指令的历史状态。这直击 R4，且成本可控。

---

## 附录：本文证据文件

| 路径 | 内容 |
|---|---|
| `D:\dsh\_bc-src\acpk\src\compression-rules.ts` | 三层 KEEP/DROP/PRIORITY 规则原文（第 2 节依据） |
| `D:\dsh\_bc-src\acpk\src\protected.ts` | 硬判据：永久保护/最近区/媒体/最新工具（2.1） |
| `D:\dsh\_bc-src\acpk\src\recommend.ts`、`segment.ts` | 可压区间推荐与分段（2.2） |
| `D:\dsh\_bc-src\acpk\src\turn-integrity.ts` | INV1/INV2 原子性（2.1 末行） |
| `D:\dsh\_bc-src\acpk\src\config.ts` | 全部默认阈值（1.4） |
| `D:\dsh\_bc-src\acpk\src\compress.ts:795` | 流水线节点顺序（1.3） |
| `D:\dsh\_bc-src\acpk\DESIGN.md` | 心智模型、首个用户消息 pin 契约 |
| `D:\dsh\_bc-src\case\session-063661eb-*.jsonl` | 本次解剖的原始会话（1980 事件） |
| `D:\dsh\_bc-src\case\full-analysis.txt` | 逐段压缩比 + 全部摘要全文 |
| `D:\dsh\_bc-src\case\{estimate,acp-trace,ref-map,listing}.js` | 分析脚本，口径与内核 tokenize.ts 一致 |
