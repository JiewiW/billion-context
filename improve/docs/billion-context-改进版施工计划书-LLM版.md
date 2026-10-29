# billion-context 改进版施工计划书（LLM 执行者版）

> **TL;DR**：7 个任务、11 条红线、22 条验收。次序：TASK-0 基线冻结 → TASK-1（改进 2，一行改动）→ TASK-2（改进 1）∥ TASK-3（改进 5a 插桩，可并行）→ TASK-4（改进 5b，数据驱动）→ TASK-5（改进 3，warn 模式）→ TASK-6（切 enforce，仅用户复审后）。每条验收 = 命令 + 退出码/字段级信号（AC-x.y）。先读第 1 节红线再动代码；完工按第 7 节投递交付报告。

**文档定位**：本单条目标注【必须】/【禁止】/【建议】/【暂定】四档模态；未标注模态的段落是信息，不产生动作。

**目录（编号索引）**

-
-
-
-
-
-
-
-
- 附录 A · 事实来源与置信标签

---

## 1. 执行红线（高危前置）

违反任一条的后果量级：回滚能力丧失、生产实例中断、或不可逆错误进入内核。本节必须先于第 4 节读完。

| 编号    | 模态   | 规则                                                                                                  | 违反后果（客观症状）                      |
| ----- | ---- | --------------------------------------------------------------------------------------------------- | ------------------------------- |
| RL-1  | 【禁止】 | TASK-0 基线冻结完成前，不得修改 `acpk` / `bcdsh` 任何源码                                                           | 无 `md5.txt` 可比对，改动无法回滚核对        |
| RL-2  | 【禁止】 | 不得修改第 4 节各任务「落点」字段之外的文件；确需时先在交付报告登记理由再改                                                             | 范围外改动无人验收                       |
| RL-3  | 【禁止】 | 不得顺手修复范围外既有故障：宿主 native compaction 双引擎冲突（`stale-ref`）、protected-tools 硬排除缺失、age-based GC 缺失、纠正类指令标记 | 范围蔓延，回归面失控                      |
| RL-4  | 【禁止】 | 不得把 user 消息静默移出压缩范围；user 消息进压缩范围必须使 `applyCompression` 抛错且错误信息含该消息 id                               | 静默过滤使保护生效却无信号，故障不可归因            |
| RL-5  | 【禁止】 | 未经用户复审 TASK-5 误报率报告并在对话中明确同意，不得把 `quoteFidelityMode` 默认值设为 `enforce`                                | 误报直接阻断合法压缩，用户无预警                |
| RL-6  | 【禁止】 | 不得把 `userVerbatimKeep` 默认值配成 `0` 以外的数                                                               | 默认即方案 A 的语义被破坏                  |
| RL-7  | 【禁止】 | 不得把 `Infinity` 或 `NaN` 写入任何配置值                                                                      | 经 JSON 序列化变 `null`，默认值静默失效      |
| RL-8  | 【必须】 | 同一文件的多处改动串行执行，每处改完 grep 核对落地                                                                        | 并行编辑同一文件会静默互相覆盖（本机实证：回报成功但内容缺失） |
| RL-9  | 【必须】 | 每个被改文件先备份为 `<原名>.bak-before-<改动名>-<YYYYMMDD>`                                                       | 无单文件回滚点                         |
| RL-10 | 【必须】 | 测试只用冷端口 3112，测完即关实例并确认 3112 无 LISTENING；3080 端口的主实例全程不碰                                             | 主实例被杀，用户工作中断                    |
| RL-11 | 【必须】 | 每条 AC 按「命令 + 客观信号」留证；无法执行的 AC 记固定标签「未做动态验证」并写原因                                                     | 无证据的「已通过」无法复核，等同未验证             |



---

## 2. 环境前置

| 编号    | 前置                                                                                                                                                                                                                                                                                | 缺失时的替代                                 |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| ENV-1 | 依赖安装：`_bc-src/acpk` 与 `_bc-src/bcdsh` 当前均**无** `node_modules`（2026-10-26 实测）。跑测试前先在各目录执行 `npm install`（本机有外网，npm registry 可达）                                                                                                                                                     | 安装失败 → 依赖测试的 AC 记「未做动态验证」，只交静态改动       |
| ENV-2 | Node：`C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-6\node.exe`（managed，首选）                                                                                                                                                                                    | 用系统 node `D:\Software\nodejs\node.exe` |
| ENV-3 | 测试命令：acpk `npm test`（= `node --import tsx --test tests/*.test.ts`）；bcdsh `npm test`（= `node --import tsx --test tests/*.test.ts tests/kernel-upstream/*.test.ts`）；两树 `npm run typecheck`。新测试放各树 `tests/` 目录，命名跟同目录 kebab-case 惯例                                                  | 无                                      |
| ENV-4 | 本地 HTTP 探测必须 `curl --noproxy '*' …`（会话环境注入 `127.0.0.1:9046` 代理会把本地请求变 502）                                                                                                                                                                                                        | 改用 node 原生 http（不读代理环境变量）              |
| ENV-5 | DSH 冷端口冒烟：启动器 `C:\Users\Administrator\Desktop\DSH.ps1`，参数 `-WebPort 3112 -PortConflict None -NoBrowser -NoPause -NoSelfCheck`，PowerShell 后台起；token 只在启动日志 `dsh web: http://127.0.0.1:<port>/?token=…`；探活先 `curl --noproxy '*' -c ck.txt "<url>"` 拿 303 cookie，再 `-b ck.txt` 打 API | 启动器不存在 → 冒烟类 AC 记「未做动态验证」              |
| ENV-6 | 把改动后的 bcdsh 产物接入 DSH 实例的安装流程**未确认**（未验证）                                                                                                                                                                                                                                          | 无法接入 → 依赖实例的 AC 记「未做动态验证」并上报；单测层验收不受影响 |

---

## 3. 任务索引与依赖

**顺序语义（先声明后编号）**：TASK-0 严格最先；TASK-1 严格次之；TASK-2 与 TASK-3 次序可互换、可并行（不同源码树）；TASK-4、TASK-5、TASK-6 严格按序。跳过被依赖任务的症状：跳过 TASK-0 则无回滚点；无 TASK-3 报告即做 TASK-4 则策略盲选；TASK-2 未完成即做 TASK-5 则保真门守护的保护语义尚未生效；无用户复审即做 TASK-6 直接违反 RL-5。

| 任务     | 内容                                       | 依赖                 | 并行       | 产出                      |
| ------ | ---------------------------------------- | ------------------ | -------- | ----------------------- |
| TASK-0 | 基线冻结                                     | —                  | —        | `md5.txt` + 测试留底 + 冒烟留底 |
| TASK-1 | 改进 2：摘掉紧急截断的文本候选                         | TASK-0             | 否        | 一行改动                    |
| TASK-2 | 改进 1：user 消息保护 + `userVerbatimKeep` 三层接口 | TASK-0             | 与 TASK-3 | 内核 + 宿主 + 状态三层          |
| TASK-3 | 改进 5a：重复注入插桩                             | 无代码依赖              | 与 TASK-2 | trace jsonl + 5a 报告     |
| TASK-4 | 改进 5b：按数据去重                              | TASK-3 报告          | 否        | 比值下降曲线                  |
| TASK-5 | 改进 3：摘要保真门 warn 模式                       | TASK-2             | 否        | 门代码 + 误报率报告             |
| TASK-6 | 切 enforce                                | TASK-5 报告 + 用户明确同意 | 否        | 默认 enforce              |

---

## 4. 任务详单

### TASK-0 · 基线冻结

- **目标**：建立可回滚基线与测试/冒烟留底。
- **前置**：ENV-1、ENV-2。
- **落点**：无源码改动。
- **拟改**：无。
- **禁止**：本任务不做任何源码修改（RL-1）。
- **验收**：
  - AC-0.1 【必须】逐文件 MD5 存档：PowerShell `Get-FileHash -Algorithm MD5` 遍历两树（排除 `node_modules`），每行 `<hash>  <相对路径>` 写入 `_bc-src/baseline-<YYYYMMDD>/md5.txt`。信号：文件存在且行数 ≥ 两树源文件总数；观测位置：该文件。
  - AC-0.2 【必须】两树各跑 `npm test`。信号：退出码 0；观测：命令回显。跑不过先修 ENV-1，不得跳过。
  - AC-0.3 【必须】冷端口冒烟一次（ENV-5）：启动日志无 `pending (waiting for service:` 且无 `did not activate`；`curl --noproxy '*' -b ck.txt` 请求 `acp_status` 返回 HTTP 200。留存输出到 `_bc-src/baseline-<YYYYMMDD>/acp_status-baseline.txt`；测完关实例（RL-10）。
- **回滚**：无改动。

### TASK-1 · 改进 2：摘掉紧急截断的用户文本候选

- **目标**：紧急硬截断不再把 user/assistant 文本列为候选。
- **前置**：TASK-0 完成。
- **落点**：`acpk/src/compress.ts:1076`（唯一改动点；行号漂移时锚 `includeTextMessages: true` 字符串）。
- **拟改**（before → after）：

```ts
// before
includeTextMessages: true,
// after
// 不再把 user/assistant 散文列为末位候选：95% 用量下切掉用户指令中段
// 不留痕、不带角色豁免，是「压掉了不该压的」最直接路径。
// 代价：末位安全阀只剩工具结果，见 terminalEscapeAfter 连锁反应。
includeTextMessages: false,
```

- **禁止**：不新增配置项（决策 2 已拍板显式 `false`）；不改 `truncate-tools.ts` 函数层（`TruncateOptions.includeTextMessages` 本就是可选字段）。
- **验收**（新测试文件建议 `acpk/tests/emergency-truncate-user-text.test.ts`）：
  - AC-1.1 【必须】构造 usage ≥ 0.95、含一条 2000 token 用户指令且位于倒数第 6 位的消息列表，断言该指令文本逐字节不变。信号：`npm test` 退出码 0 且该用例名出现在回显。
  - AC-1.2 【必须】构造 usage ≥ 0.95 且全部大块均为 user/assistant 文本（无可切工具结果）的消息列表，连续 3 回合调用，断言第 3 回合 `terminalStreak >= terminalEscapeAfter(=3)` 且 effects 含 escape 信号（判定式 `stuck && streak >= escapeAfter`，`compress.ts:1092-1095`），全程 user 文本未被修改。即「仅剩用户文本可切」时走 escape，不静默切用户消息。
  - AC-1.3 【必须】`npm run typecheck` 退出码 0。
- **回滚**：恢复 `includeTextMessages: true` 一行（备份见 RL-9）。

### TASK-2 · 改进 1：user 消息保护 + `userVerbatimKeep` 三层接口

- **目标**：默认方案 A（全部 user 消息原文保留）；`userVerbatimKeep = N (N>0)` 时方案 B（最近 N 条保留，更老的允许进 T3，仍须过 TASK-5 门）。三层接口 = 内核配置键 → 宿主设置暴露 → 状态可观测。
- **前置**：TASK-0；TASK-1 已合入（同文件 `compress.ts`，串行改，RL-8）。
- **落点**：
  1. `acpk/src/types.ts` `Config`（`preserveRecentMessages` 旁，约 398 行）增 `userVerbatimKeep?: number`；
  2. `acpk/src/config.ts` `defaultConfig`（`preserveRecentMessages: 5` 旁，32 行）增 `userVerbatimKeep: 0`；`validateConfig`（81 行起）增整数校验，错误串固定 `userVerbatimKeep must be an integer >= 0`（对齐 117 行 `terminalEscapeAfter` 写法）；
  3. `acpk/src/compress.ts:849-854` `assignRefsNode` 的 `protectedFn` 按 id 集合分流（拟改见下）；
  4. `acpk/src/prune.ts:288`：保留现有「至少一条 user」协议钉（第一条恒钉），另钉受保护 user 集合内全部消息——方案 A = 全部 user；方案 B = 第一条 + 最近 N 条；
  5. `bcdsh/src/settings.ts` 七处：`SETTINGS_KEYS`（40 行，放末位）、`AcpSettings` / `AcpSettingsInput` / `AcpSettingsCompositionEntry` 各增 `userVerbatimKeep?: number`、`SETTING_DEFAULTS` 增 `userVerbatimKeep: 0`（与内核镜像）、`filterSettingsEntry` / `resolveAcpSettings` 透传与 `?? 0` 回退、`AcpSettingsSchema` 增 `z.number().step(1).min(0)`、`AcpPluginConfigSchema` 增 `markVolatile(z.number().step(1).min(0))`、`describeSettingsChange` 增 effect（不需要 `clearWindowCache` / `clearNudgeDedup`，下一 step 生效）+ warning（`0` 改 `>0` 时提示「老 user 消息将可进 T3，引用保真依赖 TASK-5」）；
  6. `acpk/src/report.ts` `renderOverview`（234 行）`CONTEXT BREAKDOWN` 之后增渲染节（采集层零改动，`VisibleMessageInfo.isUser` 现成，142 行）：

```
USER MESSAGE PROTECTION
  userVerbatimKeep=0 (all user messages preserved verbatim)
  user messages: 12 msgs / 3,421 tok (8.4% of visible) — irreducible floor
```

方案 B 下首行改显 `userVerbatimKeep=12 (last 12 preserved; older may enter T3)`；  
7\. 连带复查（只查不修，结论写进交付报告）：`boundaries.ts:344`（跳过 BLOCKED_REF 为期望行为）、`recommend.ts:99,137,159`（同）、`report.ts:148` `pendingGap` 统计口径是否被 BLOCKED_REF 扭曲（R6，发现扭曲则修统计并登记）。

- **拟改**（落点 3，id 集合而非 `indexOf`——`protectedFn` 每条消息各调一次，`indexOf` 会退化 O(n²)）：

```ts
const keep = ctx.config.userVerbatimKeep ?? 0;
const userIndices: number[] = [];
io.messages.forEach((m, i) => { if (m.role === "user") userIndices.push(i); });
const keptUserIds = new Set(
  (keep === 0 ? userIndices : userIndices.slice(-keep)).map((i) => io.messages[i]!.id),
);
const protectedFn = (m: CoreMessage) =>
  hasMediaPayload(m) ||
  // 用户消息保护：保住「先/不要/必须」这类限定强调
  keptUserIds.has(m.id) ||
  (hasProtection
    ? isMessageProtected(m, ctx.config) ||
      (latest ? isMessageLatestProtected(m, latest) : false)
    : false);
```

- **拟改**（落点 2 校验）：

```ts
const keep = config.userVerbatimKeep ?? 0;
if (!Number.isInteger(keep) || keep < 0) {
  errors.push("userVerbatimKeep must be an integer >= 0");
}
```

- **设计口径（单点定义）**：`userVerbatimKeep = 0` ⇔ 方案 A ⇔ 「全部 user 原文保留」；`userVerbatimKeep = N (N>0)` ⇔ 方案 B ⇔ 「逃生阀：最近 N 条」。默认 `0` 而非 `Infinity`：配置值要过宿主 settings 层 JSON 序列化（RL-7）。与 `preserveRecentMessages` 不同轴——后者是 truncate 的位置保护（最后 N 条、不分角色），互不共用数值。逃生阀启用时的建议起点 12【暂定】，修订触发：TASK-5 回归数据。
- **禁止**：RL-4、RL-6、RL-7；改动 `truncate-tools.ts` 的位置保护语义。
- **验收**：
  - AC-2.1 【必须】不配 `userVerbatimKeep`，对任意 user 消息构造压缩范围，断言 `applyCompression` 抛错且错误信息含该消息 id（fail-loud，RL-4）。
  - AC-2.2 【必须】配 `userVerbatimKeep=2`：第 3 老的 user 消息可进压缩范围（不抛），最近 2 条仍抛错。
  - AC-2.3 【必须】`userVerbatimKeep = -1` 与 `1.5` 均被 `validateConfig` 拒绝，错误串 `userVerbatimKeep must be an integer >= 0` 可 grep 命中。
  - AC-2.4 【必须】宿主链：`tests/settings.test.ts` 扩展——`SETTING_DEFAULTS.userVerbatimKeep === 0` 与内核 `defaultConfig` 镜像锁死；`/acp-prune config set userVerbatimKeep 12` 后 `snapshot()` 读回 `12`。
  - AC-2.5 【建议】热生效：运行中改值不重启，下一 step `protectedFn` 行为变化。单测可模拟则断言；只能实例验证则依赖 ENV-6，做不到记「未做动态验证」。
  - AC-2.6 【必须】回归 fixture：从 `_bc-src/case/session-063661eb-0bc3-40fb-97b1-79ac199f6406.jsonl` 取含「先把三个包的npm发布硬性要求准备好」的 user 消息，断言压缩全程该消息原文保留（保护生效）。（摘要不丢强调的断言归 AC-5.1 / AC-5.2。）
  - AC-2.7 【必须】两树 `npm test` 与 `npm run typecheck` 退出码 0。
- **回滚**：逐文件用 RL-9 备份恢复，`md5.txt` 比对确认复原。

### TASK-3 · 改进 5a：重复注入插桩

- **目标**：只插桩不去重。跑满真实会话后回答两问：① 273,017 字符上界中真实浪费（同一份快照被重复注入）占多少；② 重复成因四分类各占多少。
- **前置**：无代码依赖，可与 TASK-2 并行。
- **落点**：挂点 = `bcdsh/src/messages.ts` 的 `SurfaceEventClass` 分类器（522-553 行，全宿主唯一分类点）；新增 `bcdsh/src/inject-trace.ts` 承载日志写入，分类器内只加一行调用。
- **拟改**：JSONL 追加写 `%USERPROFILE%\.dsh\logs\acp-inject-trace.jsonl`，每 surface 事件首次分类时记一行。机器消费格式样例（键名以此为准）：

```json
{"ts":"2026-10-27T10:00:00.000+08:00","seq":1234,"class":"instruction","source":"plugin:@deepseek-ai/dsh-system-prompt","chars":4210,"fp120":"<前120字符>","trigger":"unknown"}
```

- **字段口径（单点定义，§6 引用此处）**：`class` = `real` / `metadata` / `checkpoint` / `instruction` 四值（分类语义见 `messages.ts:527-552` 注释）；`source` = 事件的 kind/plugin 名；`chars` = 文本字符数（§6 量纲口径）；`fp120` = 前 120 字符（与 `_bc-src/case/dedup-recount.js` 的指纹口径同源）；`trigger` = 触发原因，分类点拿不到时填 `"unknown"`——【禁止】编造。
- **禁止**：本任务不做任何去重或删改注入内容；【禁止】把日志写进 `~/.dsh/sessions/` 目录。
- **验收**：
  - AC-3.1 【必须】跑满 ≥ 1 个真实会话后 jsonl 存在且每行可 `JSON.parse`。信号：node 一行校验脚本退出码 0。
  - AC-3.2 【必须】产出 `_bc-src/case/5a-插桩报告-<YYYYMMDD>.md`，含两问的可复算数值（真实浪费占比 + 四分类各自占比，分母口径写明）。
  - AC-3.3 【必须】报告注明插桩口径与 273,017 重算口径的差异声明——两口径（字符 / token、tool / 全角色）不可直接相加。
- **回滚**：删 `inject-trace.ts` 与挂点一行调用；已产日志留存不删。


### TASK-4 · 改进 5b：按数据去重

- **目标**：按 5a 数据施策，给出可复现的「重复注入字符数 / 总会话字符数」比值下降曲线。
- **前置**：AC-3.2 报告文件存在且可读——【禁止】无报告开工。
- **落点**：由策略决定。先按下表选策略，把小方案（复用本单字段模板）登记进交付报告，再实施。
- **策略决策表**（条件互斥穷尽；判据：占比 = 该成因重复字符 / 重复字符总计，绝对口径）：

| 成因占比（来自 5a 报告） | 策略 | 落点候选 |
|---|---|---|
| 运行时上下文快照 ≥ 30% | 内容寻址缓存，只注入增量 | bcdsh 注入链 |
| skill 内容注入 ≥ 30% | 同会话同 skill 只注入一次，后续 `@skill:name` 引用 | bcdsh skill 注入点 |
| 工具输出回显 ≥ 30% | 走内核 CCR（`ccr.ts`，content-cached retrieval，默认 `enabled: false`），不重复内联 | acpk / bcdsh 配置 |
| 多类并列均 ≥ 30% | 先做「运行时上下文快照」行 | 同上 |
| 其余情况（含全部 < 30%） | 不处理，仅在报告记录占比（合法重读兜底行） | 无 |

  30% 阈值【暂定】，修订触发：5a 报告分布极端（单类 ≥ 70%）时按最大类直选。
- **验收**：
  - AC-4.1 【必须】插桩前后同类会话的比值给出下降曲线（数据文件 + 报告表/图），两期同口径。命中「其余情况」行时，完成判据 = 报告含占比数字并声明不处理。
- **回滚**：各策略回滚点在小方案里登记（RL-9 备份纪律同样适用）。

### TASK-5 · 改进 3：摘要引用保真门（warn 模式）

- **目标**：代码层保真门，warn 模式只报不拒。
- **前置**：TASK-2 完成。
- **落点**：`acpk/src/compress.ts` `applySingleRange` 内、`validateCompressionRange`（1409 行）之前；模式开关进 `compress` 配置块（`types.ts` `maxSummaryLength` 旁，358 行附近）。选此处因为 `throw` 会被上层 `catch`（`compress.ts:654`）转成 `rangeError` 压入 `errors` 返回模型——反馈通道现成，模型当回合即知。
- **拟改**：
  - 配置键 `compress.quoteFidelityMode?: 'off' | 'warn' | 'enforce'`，默认 `'warn'`；
  - 门逻辑（规格，逐条保留）：
    1. 取 `filteredIds` 中 `role === "user"` 的消息；
    2. 每条抽「必须出现的句子」：整条 ≤ `QUOTE_FULL_MAX_CHARS = 500`（【暂定】，修订触发：误报率报告）→ 整条必须出现；> 500 → 按中英文句末标点切句，抽含强调标记的句子。标记集（逐字，禁删）：`必须 / 务必 / 一定 / 只能 / 只需 / 先 / 再 / 不要 / 别 / 禁止 / 重点是 / must / never / don't / only / first / required`；
    3. 匹配前归一化：空白折叠、全半角统一、引号统一；
    4. 通过判定式（完整结论式）：归一化后摘要含该消息原文 **或** 含该消息全部强调句 → 通过；否则记误报候选；
    5. `warn` 模式：记日志（含缺失句子原文）不 throw；`enforce` 模式：throw（经 `compress.ts:654` 转 `rangeError` 模型可见）；
  - 长度冲突降级：单条引用将超过 `compress.maxSummaryLength`（20000 字符）时，降级为「引用强调句 + 首尾各 200 字符」。
- **禁止**：warn 模式下 throw；把默认值设为 `enforce`（RL-5）。**同层例外**：RL-5 只约束默认配置值与交付态；单测内部临时设 `enforce` 是必须的测试手段，不算违反。
- **验收**：
  - AC-5.1 【必须】丢失强调句的摘要：warn 模式记日志且不 throw；单测内 `enforce` 模式抛错且错误信息含缺失句子原文。
  - AC-5.2 【必须】合规摘要（原文出现或全部强调句出现）不产生误报日志。
  - AC-5.3 【必须】warn 模式跑真实会话，产出 `_bc-src/case/5-误报率报告-<YYYYMMDD>.md`（交付物，**非门禁**，决策 3）：每条误报的原文/摘要对照 + 误报率数值（= 误报条数 / 观测摘要条数，百分数 1 位小数）+ 观测会话数。【禁止】为报告修饰数据。
- **回滚**：`quoteFidelityMode` 设 `'off'` 整体停用（门代码保留）。

### TASK-6 · 切 enforce

- **目标**：用户复审后把默认值切 `enforce`。
- **前置**：AC-5.3 报告存在 **且** 用户在对话中明确同意——这是唯一触发条件，无自动触发（RL-5）。
- **落点**：`quoteFidelityMode` 默认值 `'warn'` → `'enforce'`（一处）。
- **拟改**：无新代码。
- **禁止**：无用户明确同意即改（RL-5）。
- **验收**：
  - AC-6.1 【必须】默认配置下丢失强调句的摘要被拒（throw + `rangeError` 模型可见）。
  - AC-6.2 【必须】两树 `npm test` 退出码 0。
- **回滚**：默认值改回 `'warn'`。

---

## 5. 症状与报错反向索引

带症状进入时查本表定位，不通读全文。

| 症状 / 报错串 | 定位 |
|---|---|
| `userVerbatimKeep must be an integer >= 0` | AC-2.3 的预期信号（出现 = 校验生效）；非预期出现时查落点 2 |
| 启动日志含 `pending (waiting for service:` 或 `did not activate` | 冒烟失败 → AC-0.3 / ENV-5；先查 `node_modules` 是否装齐（ENV-1） |
| `stale-ref`（seq 1015 同型） | 既有双引擎故障，RL-3 不修；记录进交付报告即可 |
| `corrupt session log` 且侧栏会话全空 | 会话目录混入 `.bak` 副本目录（本机已知故障）；把副本目录**移出** `~/.dsh/sessions/<ws>/` 后重启（【禁止】删除） |
| 用户被要求开新会话（terminalEscape） | TASK-1 的预期连锁（代价），非故障；判定式 `compress.ts:1092-1095` |
| `compress` 报 `rangeError` 且含缺失引用字样 | enforce 生效（TASK-6）；按错误信息补引用后重试 |
| `npm test` 起不来 / `tsx` 缺失 | ENV-1 未完成 |
| 本地 `curl` 返回 502 | 代理劫持 → ENV-4 补 `--noproxy '*'` |
| 文件改动「成功」但内容缺失 | RL-8 并行编辑互覆盖；串行重做并 grep 核对 |

---

## 6. 术语、量纲与命名口径

**同义异名映射**（grep 任一名可定位）：

| 本单用名 | 等价名 | 定义位置 |
|---|---|---|
| TASK-1 / 2 / 3 / 4 / 5+6 | 改进 2 / 1 / 5a / 5b / 3 | 《billion-context-改进版计划书.md》第 2 节《改进项详设》 |
| 方案 A | `userVerbatimKeep = 0`、全部 user 原文保留 | TASK-2 设计口径 |
| 方案 B | 逃生阀、`userVerbatimKeep = N (N>0)` | TASK-2 设计口径 |
| acpk | acp-kernel（`_bc-src/acpk`） | `acpk/package.json` |
| bcdsh | billion-context-dsh、DSH 适配器（`_bc-src/bcdsh`） | `bcdsh/package.json` |
| fp120 | 前 120 字符指纹 | TASK-3 字段口径 |

**术语定义**：`protectedFn` = `assignRefsNode` 的消息保护谓词（`compress.ts:849`）；`BLOCKED_REF` = `refs.ts:76-79` 的阻塞引用通路；CCR = content-cached retrieval（`ccr.ts`）；T1/T2/T3 = 三层蒸馏分级，定义见 `billion-context-机制剖析与案例.md` §1.5（约 444 行，先检索定位再局部读取）。

**量纲口径（单点定义）**：

- 字符数 = JS `string.length`（UTF-16 code unit，含标点与空白）。全文「字符」同此口径。
- token = `ctx.countTokens` 计数。
- 误报率 = 误报条数 / 观测摘要条数 × 100%，保留 1 位小数；比较方向：越低越好；不设门禁（决策 3）。
- 273,017 字符 = tool 角色块重复合计（口径见《billion-context-改进版计划书.md》第 1 节 P4），与 user/assistant 口径的 23,835 token **不可相加**（两处口径不同）。
- TASK-4 的 30% 判据 = 该成因重复字符 / 重复字符总计，绝对口径。

---

## 7. 交付与投递

执行者完工后必须产出：

1. **交付报告** `<DSH>/_bc-src/改进施工-交付报告-<YYYYMMDD>.md`，内容：逐 AC 一行（编号 | 命令 | 退出码/信号 | 证据摘录 或「未做动态验证」+ 原因）、改动文件清单（含 RL-9 备份名）、TASK-4 小方案（若走到）、连带复查结论（落点 7）、遗留问题；
2. **中间产物**：`_bc-src/baseline-<YYYYMMDD>/md5.txt`、`5a-插桩报告`、`5-误报率报告`（各自任务产出路径见任务详单）；
3. **投递动作**：把交付报告写入第 1 条路径，并用 `present_files` 呈现给用户——仅在对话里写文字结论不算投递。

失败路径：任一 AC 无法完成 → 报告对应行记「未做动态验证」+ 原因，【禁止】空泛写「已通过」。

---

## 8. 执行自查清单

逐条答是/否/不适用；答「否」时按锚点跳到对应条目取改法。

- [ ] 1. 是否在动代码前完成 TASK-0 的 MD5 存档、测试与冒烟留底？〔RL-1 / AC-0.1–0.3〕
- [ ] 2. 是否所有改动都在各任务「落点」字段内，范围外改动已登记？〔RL-2〕
- [ ] 3. 是否未触碰 native compaction、GC、protected-tools、第 4 项等范围外事项？〔RL-3〕
- [ ] 4. user 消息进压缩范围时是否抛错并带消息 id，而非静默过滤？〔RL-4 / AC-2.1〕
- [ ] 5. 交付态 `quoteFidelityMode` 默认值是否仍为 `warn`（除非用户已复审同意）？〔RL-5〕
- [ ] 6. `userVerbatimKeep` 默认值是否为 0？〔RL-6〕
- [ ] 7. 配置值中是否有 `Infinity` / `NaN` 混入？〔RL-7〕
- [ ] 8. 同一文件多处改动是否串行完成并逐处 grep 核对？〔RL-8〕
- [ ] 9. 每个被改文件是否有 `.bak-before-<改动名>-<YYYYMMDD>` 备份？〔RL-9〕
- [ ] 10. 3080 主实例是否未动，测试实例是否已关且 3112 无 LISTENING？〔RL-10〕
- [ ] 11. 每条已执行的 AC 是否留了命令 + 退出码/字段证据，未执行的是否用「未做动态验证」标签？〔RL-11〕
- [ ] 12. AC-1.1 的用户指令逐字节不变断言是否通过？〔AC-1.1〕
- [ ] 13. AC-1.2 的 escape 判定式断言是否通过（`stuck && streak >= escapeAfter`）？〔AC-1.2〕
- [ ] 14. `validateConfig` 对 `-1` 与 `1.5` 是否都拒绝且错误串可 grep？〔AC-2.3〕
- [ ] 15. 宿主 `SETTING_DEFAULTS` 是否与内核 `defaultConfig` 镜像且测试锁死？〔AC-2.4〕
- [ ] 16. session-063661eb fixture 的「先」字句是否原文保留？〔AC-2.6〕
- [ ] 17. 5a 日志每行是否可 parse，`trigger` 拿不到时是否填 `unknown` 而非编造？〔AC-3.1〕
- [ ] 18. 5a 报告是否含两问的可复算数值与口径差异声明？〔AC-3.2 / AC-3.3〕
- [ ] 19. TASK-4 是否在 5a 报告存在后才开工，策略是否按决策表选出并登记小方案？〔TASK-4 前置 / 落点〕
- [ ] 20. 误报率报告是否含原文/摘要对照、数值与观测会话数，数据未修饰？〔AC-5.3〕
- [ ] 21. 交付报告是否逐 AC 一行、含备份名与遗留问题，并已用 `present_files` 投递？〔第 7 节〕
- [ ] 22. 兜底核对：逐条比对 RL-1–RL-11、ENV-1–ENV-6、TASK-0–TASK-6、AC-0.1–AC-6.2 全部编号，任一编号未被以上检查点覆盖即补查。〔LDW-R13〕

---

## 附录 A · 事实来源与置信标签

- **实测 2026-10-25（坐标回核）**：`compress.ts:1076 / 1069-1078 / 849-854 / 654 / 1092-1095`、`config.ts:24 / 32 / 81 / 117`、`truncate-tools.ts:14 / 48 / 73 / 88`、`prune.ts:288`、`recommend.ts:123-140 / 159`、`refs.ts:76-79`、`boundaries.ts:344`、`report.ts:142 / 148 / 234`、`types.ts:398`、`settings.ts` 六旋钮机制、`DESIGN.md` §1、`compression-rules.ts` 头部两次事故自陈。
- **实测 2026-10-26**：两树测试脚本与 `tests/` 布局、两树无 `node_modules`、`messages.ts:522-553` `SurfaceEventClass`、`compress.ts:1062-1084` 现场原文、`types.ts:358 / 398`、`config.ts:32 / 117`。
- **未确认（禁作推理前提）**：5,159 定长截断的执行方；5a `trigger` 字段的可靠取数来源；改动产物接入 DSH 实例的安装流程（ENV-6）。
- **行号口径**：以 2026-10-25/26 的 `_bc-src` 快照为准；实施时行号漂移则用各落点给出的字符串/函数名锚点定位。
