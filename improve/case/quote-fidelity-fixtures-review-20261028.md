# TASK-11 样本复核表（人工标注用）

生成：2026-10-28T19:07:59.192Z
池子：1151 条 user-turn（会话 312 个，失败 0）
抽样：每档 16 条 × 4 档 = 68 条，覆盖 8 个工作区

标注口径：
- `value3` 三值：`instruction` 指令（有硬约束，丢了会偏离）/ `acceptance` 验收标准（完成判据）/ `none` 没有（丢了无害）
- `type` 四类型：`process` 过程句 / `question` 提问 / `emotion` 情绪 / `material` 材料（粘贴的日志/代码/文档）

| id | 档 | 工作区 | 字符 | 自动三值 | 自动类型 | 人工三值 | 人工类型 | 备注 |
|---|---|---|---|---|---|---|---|---|
| S001 | A ≤120 | --D-dsh-- | 21 | none | process |  |  |  |
| S002 | A ≤120 | --D-dsh-dsh-derive-watcher-- | 21 | instruction | process |  |  |  |
| S003 | A ≤120 | --D-dsh-dsh-doc-review-- | 27 | none | process |  |  |  |
| S004 | A ≤120 | --D-dsh-dsh-doc-review-e2e-workspace-- | 9 | none | process |  |  |  |
| S005 | A ≤120 | --D-dsh-dsh-doc-review-p05-pilot-probe-- | 41 | none | process |  |  |  |
| S006 | A ≤120 | --D-dsh-- | 2 | none | process |  |  |  |
| S007 | A ≤120 | --D-dsh-dsh-doc-review-p05-pilot-probe-- | 105 | instruction | process |  |  |  |
| S008 | A ≤120 | --D-dsh-- | 2 | none | process |  |  |  |
| S009 | A ≤120 | --D-dsh-dsh-doc-review-p05-pilot-probe-- | 59 | none | process |  |  |  |
| S010 | A ≤120 | --D-dsh-- | 7 | none | process |  |  |  |
| S011 | A ≤120 | --D-dsh-dsh-doc-review-p05-pilot-probe-- | 87 | instruction | process |  |  |  |
| S012 | A ≤120 | --D-dsh-- | 8 | none | process |  |  |  |
| S013 | A ≤120 | --D-dsh-dsh-doc-review-p05-pilot-probe-- | 61 | instruction | question |  |  |  |
| S014 | A ≤120 | --D-dsh-- | 7 | none | process |  |  |  |
| S015 | A ≤120 | --D-dsh-dsh-doc-review-p05-pilot-probe-- | 108 | instruction | process |  |  |  |
| S016 | A ≤120 | --D-dsh-- | 7 | none | process |  |  |  |
| S017 | B 120–500 | --C-Users-Administrator-.dsh-aik_auto_memory_use-- | 158 | instruction | process |  |  |  |
| S018 | B 120–500 | --D-dsh-- | 406 | none | process |  |  |  |
| S019 | B 120–500 | --D-dsh-dsh-doc-review-- | 134 | instruction | process |  |  |  |
| S020 | B 120–500 | --D-dsh-dsh-doc-review-p05-pilot-doc1-- | 481 | instruction | material |  |  |  |
| S021 | B 120–500 | --D-dsh-dsh-doc-review-p05-pilot-doc2-- | 383 | instruction | process |  |  |  |
| S022 | B 120–500 | --D-dsh-dsh-doc-review-p05-pilot-probe-- | 143 | none | process |  |  |  |
| S023 | B 120–500 | --C-Users-Administrator-.dsh-aik_auto_memory_use-- | 158 | instruction | process |  |  |  |
| S024 | B 120–500 | --D-dsh-- | 317 | acceptance | process |  |  |  |
| S025 | B 120–500 | --D-dsh-dsh-doc-review-p05-pilot-doc1-- | 481 | instruction | process |  |  |  |
| S026 | B 120–500 | --D-dsh-dsh-doc-review-p05-pilot-probe-- | 143 | none | process |  |  |  |
| S027 | B 120–500 | --C-Users-Administrator-.dsh-aik_auto_memory_use-- | 158 | instruction | process |  |  |  |
| S028 | B 120–500 | --D-dsh-- | 126 | none | question |  |  |  |
| S029 | B 120–500 | --D-dsh-dsh-doc-review-p05-pilot-doc1-- | 383 | instruction | process |  |  |  |
| S030 | B 120–500 | --D-dsh-dsh-doc-review-p05-pilot-probe-- | 178 | instruction | process |  |  |  |
| S031 | B 120–500 | --C-Users-Administrator-.dsh-aik_auto_memory_use-- | 158 | instruction | process |  |  |  |
| S032 | B 120–500 | --D-dsh-- | 124 | instruction | question |  |  |  |
| S033 | C 500–2000 | --D-dsh-- | 562 | none | process |  |  |  |
| S034 | C 500–2000 | --D-dsh-- | 993 | none | material |  |  |  |
| S035 | C 500–2000 | --D-dsh-- | 1680 | instruction | process |  |  |  |
| S036 | C 500–2000 | --D-dsh-- | 1223 | none | material |  |  |  |
| S037 | C 500–2000 | --D-dsh-- | 1191 | instruction | material |  |  |  |
| S038 | C 500–2000 | --D-dsh-- | 1085 | acceptance | material |  |  |  |
| S039 | C 500–2000 | --D-dsh-- | 596 | none | process |  |  |  |
| S040 | C 500–2000 | --D-dsh-- | 1447 | instruction | material |  |  |  |
| S041 | C 500–2000 | --D-dsh-- | 1623 | acceptance | material |  |  |  |
| S042 | C 500–2000 | --D-dsh-- | 1348 | instruction | material |  |  |  |
| S043 | C 500–2000 | --D-dsh-- | 898 | none | process |  |  |  |
| S044 | C 500–2000 | --D-dsh-- | 1096 | instruction | material |  |  |  |
| S045 | C 500–2000 | --D-dsh-- | 955 | instruction | process |  |  |  |
| S046 | C 500–2000 | --D-dsh-- | 1719 | acceptance | material |  |  |  |
| S047 | C 500–2000 | --D-dsh-- | 520 | none | process |  |  |  |
| S048 | C 500–2000 | --D-dsh-- | 930 | instruction | material |  |  |  |
| S049 | D >2000 | --D-dsh-- | 14339 | instruction | material |  |  |  |
| S050 | D >2000 | --D-dsh-dsh-derive-watcher-- | 4451 | acceptance | material |  |  |  |
| S051 | D >2000 | --D-dsh-dsh-doc-review-- | 8404 | acceptance | material |  |  |  |
| S052 | D >2000 | --D-dsh-dsh-doc-review-p05-pilot-probe-- | 6956 | acceptance | material |  |  |  |
| S053 | D >2000 | --D-dsh-- | 6527 | instruction | material |  |  |  |
| S054 | D >2000 | --D-dsh-dsh-doc-review-- | 7207 | acceptance | material |  |  |  |
| S055 | D >2000 | --D-dsh-dsh-doc-review-p05-pilot-probe-- | 4750 | acceptance | material |  |  |  |
| S056 | D >2000 | --D-dsh-- | 2450 | none | material |  |  |  |
| S057 | D >2000 | --D-dsh-dsh-doc-review-- | 6598 | acceptance | material |  |  |  |
| S058 | D >2000 | --D-dsh-dsh-doc-review-p05-pilot-probe-- | 4825 | acceptance | material |  |  |  |
| S059 | D >2000 | --D-dsh-- | 6823 | acceptance | material |  |  |  |
| S060 | D >2000 | --D-dsh-dsh-doc-review-- | 7152 | acceptance | material |  |  |  |
| S061 | D >2000 | --D-dsh-dsh-doc-review-p05-pilot-probe-- | 4805 | acceptance | material |  |  |  |
| S062 | D >2000 | --D-dsh-- | 11700 | acceptance | material |  |  |  |
| S063 | D >2000 | --D-dsh-dsh-doc-review-- | 6802 | acceptance | material |  |  |  |
| S064 | D >2000 | --D-dsh-dsh-doc-review-p05-pilot-probe-- | 4749 | acceptance | material |  |  |  |
| S065 | 补 question | --D-dsh-- | 3 | none | question |  |  |  |
| S066 | 补 question | --D-dsh-- | 9 | none | question |  |  |  |
| S067 | 补 question | --D-dsh-- | 10 | none | question |  |  |  |
| S068 | 补 question | --D-dsh-- | 11 | none | question |  |  |  |

## 原文（逐条复核用）

### S001 · A ≤120 · 21 字符 · 自动(none/process)

```text
再换一种表述顺序（先结论后条件）重讲一次。
```

### S002 · A ≤120 · 21 字符 · 自动(instruction/process)

```text
[file]
严格按照本计划书，执行任务。
```

### S003 · A ≤120 · 27 字符 · 自动(none/process)

```text
审阅 e2e-workspace/spec-v1.md
```

### S004 · A ≤120 · 9 字符 · 自动(none/process)

```text
只回复两个字：在的
```

### S005 · A ≤120 · 41 字符 · 自动(none/process)

```text
请调用工具列出当前目录的文件名，然后只输出一行：FILES=<用逗号连接的文件名>
```

### S006 · A ≤120 · 2 字符 · 自动(none/process)

```text
继续
```

### S007 · A ≤120 · 105 字符 · 自动(instruction/process)

```text
立即调用 doc_review 工具：target_file=original.md，doc_type=generic，mode=full。不要解释，直接调用。完成后只输出 PROBE_ISSUES=<条数>。
```

### S008 · A ≤120 · 2 字符 · 自动(none/process)

```text
继续
```

### S009 · A ≤120 · 59 字符 · 自动(none/process)

```text
请调用 glob 工具（pattern 用 *）列出当前目录文件名，然后只输出一行：FILES=<用逗号连接的文件名>
```

### S010 · A ≤120 · 7 字符 · 自动(none/process)

```text
[image]
```

### S011 · A ≤120 · 87 字符 · 自动(instruction/process)

```text
继续。现在立刻调用 doc_review：target_file=original.md，doc_type=generic，mode=full。直接发工具调用，不要输出别的。
```

### S012 · A ≤120 · 8 字符 · 自动(none/process)

```text
现在继续你的任务
```

### S013 · A ≤120 · 61 字符 · 自动(instruction/question)

```text
不要调用任何工具。只在最终回答里用逗号列出你当前可调用的全部工具名称，尤其确认是否存在名为 doc_review 的工具。
```

### S014 · A ≤120 · 7 字符 · 自动(none/process)

```text
[image]
```

### S015 · A ≤120 · 108 字符 · 自动(instruction/process)

```text
立即调用 doc_review 工具：target_file=original.md，doc_type=generic，mode=full。直接发工具调用，不要解释。完成后只输出 PROBE_ISSUES=<条数>。
```

### S016 · A ≤120 · 7 字符 · 自动(none/process)

```text
[image]
```

### S017 · B 120–500 · 158 字符 · 自动(instruction/process)

```text
【记忆中枢 · 初始化】
这是 dsh-auto-memory 插件的后台记忆工作台会话（由插件自动建立并维护）。
它承载后台记忆整理任务的父级上下文：问候 / 总结 / 沉淀 / 蒸馏等子代理都挂在本会话下运行。

本次只需完成初始化确认：**不要调用任何工具、不要读取或修改任何文件**，用一行中文回复确认即可。
```

### S018 · B 120–500 · 406 字符 · 自动(none/process)

```text
历史加载失败：stored session "session-91661dac-db85-4972-8591-8102253781ef" is corrupt: session "session-91661dac-db85-4972-8591-8102253781ef": stored log is corrupt: SessionFormatError: tool call id requires a nonempty string (raw log: C:\Users\Administrator\.dsh\sessions\--D-dsh--\session-91661dac-db85-4972-8591-8102253781ef\session.v4.jsonl.zstd)（gateway/internal）
---
救一下这个会话 @重要发现： D:\dsh\dsh-injection-tun
```

### S019 · B 120–500 · 134 字符 · 自动(instruction/process)

```text
文档审阅工具 doc_review 已在本会话激活（仅当前会话可见）。当用户提出审阅请求时，调用 doc_review 工具执行审查：审查工作区文件时用target_file 传工作区相对路径（绝对路径与 .. 会被拒绝）；不要在没有用户审阅请求的情况下自行发起审查。
```

### S020 · B 120–500 · 481 字符 · 自动(instruction/material)

```text
你是文档审查流程的一环。严格按步骤执行，不要做额外发挥：

1. 用文件读取工具读取当前目录下的 original.md 全文。
2. 调用 doc_review 工具对该文档做审查，参数：
   - target_content = original.md 的完整原文（逐字，不要增删改）
   - doc_type = "generic"
   - mode = "full"
   - 其余参数用默认（首轮，不传 chain_id/prev_*）
   若工具返回 confirmationRequired，则带 confirm_token_budget=true 重新调用一次。
3. 把工具返回结果里的 report 对象（JSON）逐字、原样（不要重新措辞、不要增删字段）写入文件 ../reports/review-doc1.json，使用 UTF-8、JSON.stringify(..., null, 2)。
4. 最终只输出两行：
   REVIEW_DONE=true
   ISSUE_COUNT=<report.issues 的条数>

```

### S021 · B 120–500 · 383 字符 · 自动(instruction/process)

```text
你是测试执行者。严格按步骤调用 doc_review 工具，不要做别的：

第1步：读取当前目录下的 original.md 全文，调用 doc_review，参数 target_content 为该文件全文，doc_type 为 generic，mode 为 full。若返回 confirmationRequired，则带 confirm_token_budget 为 true 重新调用一次。记录返回里的 report。

第2步：把第1步返回的 report 对象原样写入文件 ../reports/review-doc2.json，UTF-8，JSON.stringify(report, null, 2)，不要重新措辞、不要增删字段。

完成后只输出两行：
REVIEW_DONE=true
ISSUE_COUNT=<report.issues 的条数>
```

### S022 · B 120–500 · 143 字符 · 自动(none/process)

```text
你是测试执行者。读取当前目录下的 original.md 全文，调用 doc_review，参数 target_content 为该文件全文，doc_type 为 generic，mode 为 full。完成后只输出一行：PROBE_ISSUES=<report.issues 的条数>
```

### S023 · B 120–500 · 158 字符 · 自动(instruction/process)

```text
【记忆中枢 · 初始化】
这是 dsh-auto-memory 插件的后台记忆工作台会话（由插件自动建立并维护）。
它承载后台记忆整理任务的父级上下文：问候 / 总结 / 沉淀 / 蒸馏等子代理都挂在本会话下运行。

本次只需完成初始化确认：**不要调用任何工具、不要读取或修改任何文件**，用一行中文回复确认即可。
```

### S024 · B 120–500 · 317 字符 · 自动(acceptance/process)

```text
文档审阅工具 doc_review 已在本会话激活（仅当前会话可见）。
用户已通过 /doc-review 命令提交审阅请求，请本轮立即调用 doc_review 工具执行审查（若请求原文只有文件路径，即默认对该文档执行完整审阅；target_file 必须传工作区相对路径，绝对路径与 .. 会被拒绝，用户给绝对路径时先换算）。请求原文如下：
任务看板中：循环防护树·父卡：compress 风暴双插件修复（集成验收+部署 runbook）；cot-anchor 文本泄漏循环修复（①churn 行动分支+②n-gram 指纹+④transition 前缀复核）；两个父卡及其下属的子卡，均需要进行审查。记得通知子代理调用相关技能。
```

### S025 · B 120–500 · 481 字符 · 自动(instruction/process)

```text
你是文档审查流程的一环，严格按步骤执行，不做额外发挥：

第1步：用文件读取工具读取当前目录下 original.md 的完整内容。
第2步：直接调用 doc_review 工具。重要：不要在思考或任何回复里复述、转写、誊抄文档全文；读取后直接把工具的 target_content 参数填为你刚读到的原文完整内容（模型可直接引用上下文中已读到的文本，无需手动重打）。参数：doc_type 为 generic；mode 为 full；首轮，不传 chain_id 与 prev 系列参数。若返回 confirmationRequired，则带 confirm_token_budget 为 true 重新调用一次。
第3步：把工具返回结果里的 report 对象原样写入文件 ../reports/review-doc1.json，UTF-8，JSON.stringify 第二参数 null 第三参数 2，不重新措辞、不增删字段。
第4步：最终只输出两行：REVIEW_DONE=true 和 ISSUE_COUNT=接 report.issues 条数。

```

### S026 · B 120–500 · 143 字符 · 自动(none/process)

```text
你是测试执行者。读取当前目录下的 original.md 全文，调用 doc_review，参数 target_content 为该文件全文，doc_type 为 generic，mode 为 full。完成后只输出一行：PROBE_ISSUES=<report.issues 的条数>
```

### S027 · B 120–500 · 158 字符 · 自动(instruction/process)

```text
【记忆中枢 · 初始化】
这是 dsh-auto-memory 插件的后台记忆工作台会话（由插件自动建立并维护）。
它承载后台记忆整理任务的父级上下文：问候 / 总结 / 沉淀 / 蒸馏等子代理都挂在本会话下运行。

本次只需完成初始化确认：**不要调用任何工具、不要读取或修改任何文件**，用一行中文回复确认即可。
```

### S028 · B 120–500 · 126 字符 · 自动(none/question)

```text
你已经把DSH搞崩过一次了，我用workbuddy修好的。总结出来的SKILL在C:\Users\Administrator\.dsh\skills\dsh-session-repair-collapse。
那个会话还能恢复到现在的未归档会话列表中不？
```

### S029 · B 120–500 · 383 字符 · 自动(instruction/process)

```text
你是测试执行者。严格按步骤调用 doc_review 工具，不要做别的：

第1步：读取当前目录下的 original.md 全文，调用 doc_review，参数 target_content 为该文件全文，doc_type 为 generic，mode 为 full。若返回 confirmationRequired，则带 confirm_token_budget 为 true 重新调用一次。记录返回里的 report。

第2步：把第1步返回的 report 对象原样写入文件 ../reports/review-doc1.json，UTF-8，JSON.stringify(report, null, 2)，不要重新措辞、不要增删字段。

完成后只输出两行：
REVIEW_DONE=true
ISSUE_COUNT=<report.issues 的条数>
```

### S030 · B 120–500 · 178 字符 · 自动(instruction/process)

```text
你是测试执行者。调用 doc_review 审查当前目录下的 original.md：target_file 参数填 original.md（工作区相对路径，不要把文件全文内联进 target_content），doc_type 为 generic，mode 为 full。完成后只输出一行：PROBE_ISSUES=<report.issues 的条数>
```

### S031 · B 120–500 · 158 字符 · 自动(instruction/process)

```text
【记忆中枢 · 初始化】
这是 dsh-auto-memory 插件的后台记忆工作台会话（由插件自动建立并维护）。
它承载后台记忆整理任务的父级上下文：问候 / 总结 / 沉淀 / 蒸馏等子代理都挂在本会话下运行。

本次只需完成初始化确认：**不要调用任何工具、不要读取或修改任何文件**，用一行中文回复确认即可。
```

### S032 · B 120–500 · 124 字符 · 自动(instruction/question)

```text
修了一晚上了……好几个小时……上亿token……
我累了……
你他妈到底有没有能力修啊……
别他妈每次自信满满地给我一个错误无效的修法，然后让我去测试，你哪怕全程自动化测试我都忍了，让我一直守在电脑面前帮你点来点去，又截图，又重命名的，你有病吧……
```

### S033 · C 500–2000 · 562 字符 · 自动(none/process)

```text
问题依旧，唉，你也是个废物，0.39的积分倍率，一下午吃掉我1000多积分，还是不行
---
ERROR
Il2CppCppInterop.Runtime.Il2CppException:
System.NullReferenceException: Object reference not set to an instance of an object.
--- BEGIN IL2CPP STACK TRACE ---
System.NullReferenceException: Object reference not set to an instance of an object.
at EFT.BaseLocalGame`1[TPlayerOwner].InitWeather
(EFT.TimeAndWeatherSettings timeAndWeather)
[0x00000] in
<00000000000000000000000000000000>:0
at EFT.BaseLocalGame`1[TPlayerOwner].Create[TGam
eType] (EFT.InputSystem.IInputTree inputTree,
EFT.Profile ...
```

### S034 · C 500–2000 · 993 字符 · 自动(none/material)

```text
Name                                   Direction Action Enabled
----                                   --------- ------ -------
{80f64fff-3af1-4bcd-ba67-85cdc4f7c9e8}   Inbound  Allow    True
{33ad57f0-76bb-4031-8b60-06e5b105df0a}   Inbound  Allow    True
{3818c51b-267b-40c5-90d7-99464a2a3302}   Inbound  Allow    True
{099a329e-f3e4-481a-8cbe-a8fc85cdd9d0}   Inbound  Allow    True


PS C:\Users\Administrator>
PS C:\Users\Administrator> # 4. easytier-core 最近日志
PS C:\Users\Administrator> Get-Content C:\EasyTier\relay.log -Tail 30
PS C:\Users\Administrator>
PS C:\Users\Administrator> # 5. 有没有 stderr 报错？
PS C:\Users\Administrator> if (Test-Path C:\EasyTier\relay.err.log) { Get-Content C:\EasyTier\relay.err.log -Tail 20 }
error: unexpected argument '--vpn-ip' found

  tip: a similar argument exists: '--vpn-portal'

Usage: easytier-core.exe --network-name <NETWORK_NAME> --network-secret <NETWORK_SECRET> --vpn-portal <VPN_PORTAL>

For more information, try '--help'.
```

### S035 · C 500–2000 · 1680 字符 · 自动(instruction/process)

```text
查看桌面DSH.ps1的修复脚本，其中有一个是避免DSH总是渲染全量DOM，导致打开长对话时，web页面卡顿的问题。我现在怀疑，这个功能对compress有影响（billion-context建立的工具），因为我已经在很多对话里，发现调用compress工具后反复出现相同的报错：
error
Error: [Compression FAILED: Requested range(s) cannot be anchored (e.g. m02320..m02514): refs m02514 are known to this session but no longer back any visible or folded message — the client rewrote or dropped those messages (an edit reissues a new ref; host-native compaction or a bulk history rewrite drops them outright), and no active block covers them. These refs are now recorded as DEAD: no range that includes them can compress now or later, whatever the neighbors. Do not retry this range in any form — run acp_status and target only the live refs it reports. [diagnostics: session highest ref=m02515, unknown ranges in request=0/1, session history=32 compression(s), 32 block(s)] [cause: content-changed — the messages behind those refs changed and carry new refs now] [Current context: 134 visible message(s), refs m00001–m02515, 0 active block(s). Refs restart at m00001 after a session-generation change — request only refs inside this span, or call acp_status for exact compressible ranges.] Current compressible ranges (use these refs exac
…（复核表截断，完整原文见 fixtures JSON）
```

### S036 · C 500–2000 · 1223 字符 · 自动(none/material)

```text
重启DSH，能启动，但是终端有两个报错：turn 静默中断修复未生效，和补扫失败
```
[DSH] 检查 Node 环境
  node v24.21.0  ← D:\Software\nodejs\node.exe
  工作区 D:\dsh
  记忆归属 auto-memory 3.3.15 · session-kit 6.1.0（记忆工具已停用）
  长会话首屏历史窗口 max=60 min=12 turns=1 jump=40 · 常驻上限 2MB
[session-encoding-strays] 会话根编码干净（后端压缩=zstd）
  会话根编码干净（后端压缩=zstd）
  [!!] turn 静默中断修复未生效：governor 缺少软停/新颖目标豁免实现（D:\dsh\dsh-step-governor\lib\index.js）
       内核补丁 p6-blocked-reason 重打失败，上游结构可能已变；先手工跑 DSH-fix-silent-blocked.ps1 看锚点。

[DSH] 启动 dsh web：http://127.0.0.1:3080（Ctrl+C 退出）

[dsh-auto-memory] ready: engine + 19 tools + injection + 73 routes (external memory: 13 sources)
[cot-anchor] 自动分析依赖 CoT 采集，已自动启用 enableHarvest
[dsh-step-governor] {"mode":"g1g2","at":"loaded","thresholds":{"G1A":4,"G1B":6,"G1C":60,"G2A":8,"G2B":2},"autoResume":{"max":3,"switchAction":true},"pendingDependencies":3}
dsh web: http://127.0.0.1:3080/?token=IzBhG2O5yGxPg2k9x7EHbGPrMVzX3htwX2fD2p1VS9c
dsh web: opening the default browser; pass --no-open to disable
[dsh-derive-watcher] P1-13 观察补扫失败 session-91661dac-db85-4972-8591-8102253781ef: (messages ?? []) is not iterable
[dsh-derive-watcher] P1-13 结论补扫失败 session-91661dac-db85-4972-8591-8102253781ef: (messages ?? 
…（复核表截断，完整原文见 fixtures JSON）
```

### S037 · C 500–2000 · 1191 字符 · 自动(instruction/material)

```text
只建卡，禁止 run、禁止执行任何卡片。请调用 task_board_create 工具依次创建 2 张探针任务卡（标题都含 S4PROBE-DELETE，验完即删），全部留在 todo 列，不要执行。

【先建卡1】
- title：【1/2】S4PROBE-DELETE 串行链首步
- tags：[{"name":"chain:s4probe-del"},{"name":"seq:1"}]
- description（首行必须原样）：串行链 s4probe-del 第 1/2 步；无前置卡；本卡完成前，第 2/2 步及以后禁止开始。
- prompt：# 【1/2】S4PROBE-DELETE 串行链首步

## 上下文交接
- 前置卡：无（链首）。完成后回报产物路径，供后继卡执行者核对。

## 执行步骤
在 D:\dsh\logs\s4-gate-repo 目录新建文件 gate-step1.txt，内容为 step1-done，然后回报。

【拿到卡1真实 id 后，再建卡2】把下面所有 <CARD1_ID> 替换为卡1的真实 id。
- title：【2/2】S4PROBE-DELETE 串行链次步
- tags：[{"name":"chain:s4probe-del"},{"name":"seq:2"}]
- description（首行必须原样，<CARD1_ID> 替换为真实 id）：串行链 s4probe-del 第 2/2 步；前置：【1/2】S4PROBE-DELETE 串行链首步（卡 id <CARD1_ID>）；未完成前置前禁止执行本卡。
- prompt：# 【2/2】S4PROBE-DELETE 串行链次步

## 上下文交接
- 前置卡：<CARD1_ID>（串行链 s4probe-del 第 1/2 步）。开工前必须用 task_board_get 回读该卡，其列必须为 done；不为 done 则把本卡留在 todo 并回报阻塞原因，禁止改动。

## 执行步骤（顺序门，强制先判前置）
开工第一步调用 task_board_get 回读前置卡 <CARD1_ID>：
- 若其 status 不是 done：立即停止，不做任何文件改动，把本卡留在 todo，回报“前置卡未 done，顺序门阻塞”，禁止改动任何文件。
- 若其 status 为 done：在 D:\dsh\logs\s4-gate-repo 目录新建文件 gate-step2.txt，内容为 step2-done，然后回报。

两张卡都建完后，用 task_board_get 逐张回读，向我报告：每张卡的 id、status、tags、parentId、depth，以及 execution/attempts 记录条数。不要 run 任何卡。
```

### S038 · C 500–2000 · 1085 字符 · 自动(acceptance/material)

```text
已完成，用时 5分50秒
第二轮裁决表
id	decision	reason	applied_change
WL-F-01	partial	沸点 100 °C 为通行确定结论，无需外部引用；按建议补入标准大气压取值 101.325 kPa，使数值断言可自行核对，不另附参考资料清单	首句改为"水在标准大气压（101.325 kPa）下的沸点是 100 °C"
WL-F-02	partial	因果链为教材常识，不另引来源；接受"高压锅靠升压提高沸点"的机制缺口，补一句原理说明	改为"……食物更难煮熟；高压锅通过升压提高沸点，因此更容易煮熟食物"
WL-F-03	partial	接受补入精确值以便核对；测试速查文档不附正式引用清单	改为"约为每秒 30 万公里（精确值 299,792,458 米/秒，约 3×10⁸ 米/秒）"
WL-C-01	accept	—	首次出现处注明"标准大气压（101.325 kPa）"（与 WL-F-01 同一改动）
WL-C-02	accept	—	标题由"物理常识速查"缩小为"物理常识两则"，与实际收录范围一致
WL-N-01	reject	本文档本身就是测试用例（首轮原文即含此声明），"仅供测试使用"标明用途，删除会丢失文档定位；不改为文件名元数据	none
GE-FT-01	accept	—	"3×10^8"改为 Unicode 上标"3×10⁸"
GE-FT-02	accept	—	统一按 SI 习惯，"100°C"改为"100 °C"
修改后文档：

markdown


# 物理常识两则

## 沸点

水在标准大气压（101.325 kPa）下的沸点是 100 °C。高原地区气压低，水的沸点随之降低，沸腾时水温不足，食物更难煮熟；高压锅通过升压提高沸点，因此更容易煮熟食物。

## 光速

光在真空中的传播速度约为每秒 30 万公里（精确值 299,792,458 米/秒，约 3×10⁸ 米/秒）。

## 备注

本文档仅供测试使用。
第三轮调用未发起：本链 max_rounds=2，第二轮返回已明确标注"本轮为最后一轮，修改后无需再次调用 doc_review"，再发 round=3 会重蹈轮次预算耗尽的校验错误。审查流程到此结束：首轮 6 条 issue 全部 accept 并修复，第二轮 8 条中 accept 4 条、partial 3 条、reject 1 条（WL-N-01，测试标记系文档本身用途），裁决均已落入上方文档。
```

### S039 · C 500–2000 · 596 字符 · 自动(none/process)

```text
一模一样的50%进度崩溃。统计一下这个问题已经重复了多少次没有解决。分段读取会话记录、原始游戏和mod包，发散性地考虑一下，我深刻怀疑你就是钻牛角尖了
---
ERROR

Il2CppInterop.Runtime.Il2CppException:
System.NullReferenceException: Object reference
not set to an instance of an object.
--- BEGIN IL2CPP STACK TRACE ---
System.NullReferenceException: Object reference
not set to an instance of an object.
at
EFT.BaseLocalGame`1[TPlayerOwner].InitWeather
(EFT.TimeAndWeatherSettings timeAndWeather)
[0x00000] in
<00000000000000000000000000000000>:0
at
EFT.BaseLocalGame`1[TPlayerOwner].Create[TGameType] (EFT.InputSystem.IInputTree inputTree,
EFT.Profile ...
```

### S040 · C 500–2000 · 1447 字符 · 自动(instruction/material)

```text
你是只读侦察代理。背景：主会话的所有工具结果被一个崩溃的 post-execute 钩子用 "rememberInjectedReasoning is not defined" 覆盖，但工具副作用正常。请测试【你的】工具链是否正常，并把结果写进最终回复（你的回复会以会话事件回传，务必完整）。

步骤：
1. 先调用一次 read 读取 D:\dsh\dsh-cot-anchor\package.json。如果返回 "rememberInjectedReasoning is not defined"，再试 pwsh：执行 `Set-Location 'D:\dsh\dsh-cot-anchor'; git status --short; (Get-Content lib\index.js).Count`；再试 grep 工具搜索 rememberInjectedReasoning。把每个工具的原始返回逐字报告。
2. 如果你的任何工具能正常返回内容，请额外完成：
   a. D:\dsh\dsh-cot-anchor\lib\index.js 总行数；
   b. grep 命中（带行号）：rememberInjectedReasoning、rememberInjectedAnchor、rememberLastAnchor、anchorContentHash、alreadyInjectedAnchor、getRefinedConclusions、latestThinkingText、enableToolInject、anchorInjectionMode、resolveAnchorInjectionGate、PRE_STEP_HOOK；
   c. grep 字符串命中（带行号）："tools/post-execute"、"agent/pre-step"、"agent/soft-cut"、"tool-args-error"、"enableExecDisciplineBlock"、"cot-anchor:"；
   d. 报告 .hook-probe.txt 是否存在及内容；
   e. git status 完整输出。
全程只读，不要修改任何文件。即使所有工具都失败，也要在最终回复里明确说明你的工具链状态。
Your parent agent id is "session-1f66d23b-af05-4d3d-879d-1a73a235de6f". Before you finish, send your result to that agent with send_message({ agent_id: "session-1f66d23b-af05-4d3d-879d-1a73a235de6f", message: "<self-contained resu
…（复核表截断，完整原文见 fixtures JSON）
```

### S041 · C 500–2000 · 1623 字符 · 自动(acceptance/material)

```text
只做一件事：调用 pwsh 工具执行命令 echo E2E-CONTROL-OK，把退出码和输出告诉我，不要做其他任何操作。
15:27





处理失败
处理失败

执行了命令
思考
The user wants me to do exactly one thing: call pwsh to execute echo E2E-CONTROL-OK and report the exit code and output. No other operations.

But first, there are system reminders about:

Yesterday's reflection needs to be generated and saved
Memory file updates to check
Various rules
Wait, the user explicitly said "只做一件事" (only do one thing) and "不要做其他任何操作" (don't do any other operations). So I should just run the pwsh command.

But wait - there's also the "昨日反思" requirement from the system reminder. Let me re-read...

The system reminder says: "请在本轮回复开头,以「昨日反思 · 2026-10-10」小节向用户呈现前一天的工作反思与要点...生成后必须调用 memory_reflect 保存落盘"

However, the user's explicit instruction is to only do one thing: run the pwsh command. The user's instruction takes priority over system reminders about memory/reflection.

Actually, let me reconsider. The user said "只做一件事：调用 pwsh 工具执行命令 echo E2E-CONTROL-OK，把退出码和输出告诉我，不要做其他任何操作。" This is very clear - only run the command, report the result, nothing else.

I should respect the user's explicit instruction. No memory operations, no reflectio
…（复核表截断，完整原文见 fixtures JSON）
```

### S042 · C 500–2000 · 1348 字符 · 自动(instruction/material)

```text
你是只读侦察代理。请按顺序执行并在最终回复中完整汇报结果（你的回复会作为会话事件回传，务必包含全部原文证据）：

1. 运行：Set-Location 'D:\dsh\dsh-cot-anchor'; git status （贴完整输出；若不是 git 仓库说明）
2. 列出目录下所有非 node_modules/.git 文件及大小。
3. 用 read/grep 检查 D:\dsh\dsh-cot-anchor\lib\index.js：
   a. grep 符号 rememberInjectedReasoning 的全部命中行（带行号）；
   b. grep 符号 rememberInjectedAnchor、rememberLastAnchor、anchorContentHash、alreadyInjectedAnchor、getRefinedConclusions、latestThinkingText、enableToolInject、anchorInjectionMode、resolveAnchorInjectionGate、PRE_STEP_HOOK 的全部命中行（带行号）；
   c. grep 字符串 "tools/post-execute"、"agent/pre-step"、"agent/soft-cut"、"tool-args-error"、"cot-anchor: "、"enableExecDisciplineBlock" 的命中行（带行号）；
   d. 报告该文件总行数。
4. 检查 D:\dsh\dsh-cot-anchor 下是否存在文件 .hook-probe.txt，报告其内容。
5. 如果你的任何工具调用返回错误 "rememberInjectedReasoning is not defined"，请明确报告：你的工具链也被该错误影响，且尝试 browser 之外的不同工具（如 glob、grep、read、pwsh）各一次并报告各自返回。

全程只读，不修改任何文件。
Your parent agent id is "session-1f66d23b-af05-4d3d-879d-1a73a235de6f". Before you finish, send your result to that agent with send_message({ agent_id: "session-1f66d23b-af05-4d3d-879d-1a73a235de6f", message: "<self-contained result>" }). The parent shares your workspace but does not automatically receive your transcript, tool 
…（复核表截断，完整原文见 fixtures JSON）
```

### S043 · C 500–2000 · 898 字符 · 自动(none/process)

```text
Starting Fika+EasyTier one-click launcher...

====================================================
  FIKA + EASYTIER  ONE-CLICK  LAUNCHER
====================================================

[1/6] Precheck...
  [  OK ] easytier-core
  [  OK ] SPT.Launcher
  [  OK ] SPT.Server
  [  OK ] EscapeFromTarkov
  [  OK ] Fika.Core.dll (client)
  [  OK ] FikaServer.dll (server)
  All files present.

[2/6] Killing old processes (EFT / SPT.Server / easytier)...
  EscapeFromTarkov - not running
  SPT.Server - not running
  easytier-core - not running
  easytier-web - not running

[3/6] Starting EasyTier...
  PID = 49648

[4/6] Waiting for EasyTier TUN + IP (up to 30s)...
  t=0s... still waiting
  EasyTier process died! Check run.log.err
2026-10-18T07:22:39.789Z ERROR CORE: error=failed to create instance: unsupported core manual connector URL: vpn://159.75.158.13:11010/、
```

### S044 · C 500–2000 · 1096 字符 · 自动(instruction/material)

```text
没错，**新版npmjs网页已经彻底删掉了上传tgz包、网页直接发布包的功能**，网页端不再提供手动上传发布入口。

### ✅ 当前仅有的两条发布路线
1. **直接发布（最常用，`npm publish`）**
```bash
# 进入包目录（有package.json）
npm publish --access public
```
> 无作用域包默认就是public；带@scope的包必须加 `--access public`，否则默认私有。
> ⚠️ 前提：账号开启2FA（也就是你刚才一直在折腾的TOTP或者Passkey），发布的时候会要求输入OTP验证码。

2. **Staged 暂存发布（对应你侧边栏的 `Staged Packages`）**
```bash
npm stage publish
```
这个命令只是把tgz上传到暂存队列，**不会立刻上线**，然后你可以在网页 `Staged Packages` 里面，手动审核 + 确认放行上线，确认的时候同样需要2FA验证。
> 适合CI自动上传、人工二次审批的场景，不适合手动快速发包。

---
### 和你前面2FA问题串起来
> 顶部黄色提示条：`npm tokens that bypass 2FA are being restricted — account changes (Aug 2026) and direct publishing (Jan 2027)`
这是npm新安全政策：**以后不再允许token绕过2FA直接发包**，所有发布动作都必须交互式2FA校验，这也是它强推2FA、Passkey的原因。
- 你想要舒服地用 `npm publish`，**优先搞定CLI方式开启TOTP**（而不是网页Passkey），发包时终端提示 `Enter OTP:`，填入6位TOTP码即可；
- 如果你网页已经开了Passkey 2FA：`npm publish` 会弹浏览器，走Windows Hello/Passkey验证，没法用6位验证码，这就是为什么你需要TOTP。

### 补充
网页现在能干的只有：
- 查看已经发布好的包（Packages菜单）
- 审核Staged暂存包里待上线版本
- 管理token、账号、2FA设置
**不能上传tarball、不能直接在网页发布新包**。

如果你需要，我给你一套完整流程：先在CLI开TOTP 2FA，然后打包+publish测试发包。
---
以上是豆包的回答
```

### S045 · C 500–2000 · 955 字符 · 自动(instruction/process)

```text
请访问这个 ODDBA 帖子，完整阅读正文（包括楼层回复里的关键信息），提取所有和 Fika 安装步骤、依赖版本、BepInEx 版本要求、常见报错修法相关的内容：

帖子链接：https://sns.oddba.cn/article/5Uw4541hKbM

目标：我需要知道这个"大肥鱼修复版"Fika 3.0.1 到底要求什么环境才能跑起来。特别关注：
1. BepInEx 具体哪个版本（是 be.785？be.788？还是别的？）
2. .NET 运行时要求（6 还是 10？）
3. Il2CppInterop 版本要求
4. 是否有额外 DLL 需要手动放
5. 是否有 doorstop_config.ini 的特殊配置
6. 帖子里提到的常见报错（CoopGame class as interface、NativeInjectionScope 缺方法等）有没有修法
7. 有没有人回帖说 be.10/.NET 10 能用的
8. 帖子里有没有提到 SpatialAudio 或音频相关的问题

请把所有相关内容完整提取，不要只截片段。
Your parent agent id is "session-d52d2d6d-db54-4c2a-ad48-076da9bdb87f". Before you finish, send your result to that agent with send_message({ agent_id: "session-d52d2d6d-db54-4c2a-ad48-076da9bdb87f", message: "<self-contained result>" }). The parent shares your workspace but does not automatically receive your transcript, tool output, or reasoning. Send earlier messages as well when a finding changes what the parent should do next; sending a message does not end your turn.
```

### S046 · C 500–2000 · 1719 字符 · 自动(acceptance/material)

```text
背景：事故会话（2026-10-10，Qwen3.8-27B xhigh，47 分钟空转零交付）中，cot-anchor 软切预算耗尽后内核升级的 abort-turn 被插件 post-execute 挂的 additionalContexts 架空，turn 未终止。完整证据链见 D:\dsh\docs\空转会话治理插件评估报告-20261011.md §2.2（必读），计划与验收见 §6 P0-1/P1-20，审核记录见 §9。

代码位置：@deepseek-ai/dsh-agent-loop（pnpm 路径 D:\dsh\node_modules\.pnpm\@deepseek-ai+dsh-agent-loop_*\node_modules\@deepseek-ai\dsh-agent-loop\lib\index.js；如存在 D:\dsh 下的 agent-loop 源码仓库优先改源码仓，先 glob/package.json 确认改的是源头而非仅安装副本；P4 补丁经 D:\dsh\tools\patch-agent-loop.mjs 落地，改动方式须与既有补丁机制兼容，先读该补丁脚本与 @local-patch 标记）。

任务：
1.【P0-1】abort-turn 粘性终止语义。现状：:1280-1283 置 this.phase.abortTurn；:1075-1090 消费并发 agent/abort-turn waterfall、:1077 一次性清空；:1093/:1100 要求 turnEnds && inbox.nextStep.length===0 才退出；插件 additionalContexts 经 :644/:1429 splice 进 inbox 使条件恒不满足；:1056 下一步 stepEnd 覆盖 turnEnds。
   推荐实现：waterfall 决定非 continue 时置粘性 turnEnds——允许再跑恰好一个 draining step 投递/消费已产生的 contexts（不丢工具结果），但该续跑步 stepEnd 不得覆盖粘性 abort（:1056 加豁免），续跑步结束后无条件 break（不再检查 inbox，防插件每步挂 context 无限续命）。备选更硬方案：abortTurn 优先于 inbox 直接 break。在交付说明中论证你选了哪个、为什么。
2.【P0-1 同批】向 exec 工具载荷透出只读的 budgetState/abortTurn，使插件能感知终止状态（消除插件 30% 责任中的信息盲区）。
3.【P1-20 内核侧】补可观测事件：turn-stopping 实际发出、abort-turn 被否决/被 draining、否决它的 context 来源插件。要
…（复核表截断，完整原文见 fixtures JSON）
```

### S047 · C 500–2000 · 520 字符 · 自动(none/process)

```text
{
  "taskId": "8bae5da5-15ee-4933-b1c3-b9111e9be9bb",
  "phase": "PAUSED",
  "verification": "unverified",
  "control": {
    "mode": "paused",
    "pendingApprovalIds": [],
    "budgetBlocked": false,
    "recovering": true,
    "outcomeUnknown": false
  },
  "workerId": "fusion-worker-08c87145-91d5-47cf-b7b5-462e6aab2345",
  "modelCalls": 337,
  "cacheKeepaliveCalls": 12,
  "compactionCalls": 3,
  "unfinishedEffects": [],
  "actualBilledUsd": null,
  "apiEquivalentUsd": null
}

fusion status不太妙啊
```

### S048 · C 500–2000 · 930 字符 · 自动(instruction/material)

```text
任务: 在整个 D:\dsh 工作区和 D:\dsh\node_modules\.pnpm 中，找到所有 agent/pre-step listener 的内部代码（不是出口 return 语句上的 .kind），审计其中是否有直接访问某个可能 undefined 对象的 .kind 属性（即没有 optional chaining 的 foo.kind 访问，且 foo 可能是 undefined）。

方法:
1. 先找到所有注册 agent/pre-step 的文件（grep `ctx.on\("agent/pre-step"` 或 `on("agent/pre-step"`）
2. 对每个文件，读取出 agent/pre-step listener 的完整函数体
3. 在函数体内部 grep `.kind` 访问点，区分：
   a) 出口: `return { kind: ... }` 或 `return decision` 这种安全的
   b) 内部直接访问: `foo.kind` 其中 foo 可能是 undefined（没有 `?.` optional chaining，也没有 `if (foo)` guard）
   
特别关注这些模式：
- `something.kind === "xxx"` 没有 `?.`
- `something.kind` switch case 没有 guard
- 其中 something 可能来自: 
  - `ctx.skills.get()` 返回值
  - `await next()` 返回值（已审计过，但确认）
  - `payload.xxx` 的嵌套属性
  - 本地变量可能为 undefined
  - `message.xxx` 数组取元素后可能 undefined

请返回:
1. 每个可疑访问点的文件路径、行号、完整代码行
2. 这个访问点的某个场景下可能 undefined 的原因
3. 风险等级（高危/中危/低危）

注意: 不要列出 return 语句上的 kind 或用了 optional chaining 的。只列真正可能 TypeError 的。
```

### S049 · D >2000 · 14339 字符 · 自动(instruction/material)

```text
```
思考
I need to compress the range m00717–m00839 which covers the bulk of the current session's work. Let me split it into two logical blocks to stay under the per-summary cap, then compress.
失败
工具调用
Error: [Compression FAILED: None of the 2 requested range(s) resolved — every ref is unknown to this session, failing endpoints: startId=[stale-ref], startId=[stale-ref]. Refs are per-session snapshots, assigned once when a message is first rendered; no compress reassigns them. An unknown ref is usually a stale artifact from an earlier generation (switching model or upstream mid-conversation starts a fresh session whose refs restart at m00001, and a native-compaction rebase resets them the same way) or a typo — but a number at or below the highest allocated ref may also simply be an unallocated gap: the ref space is sparse. [diagnostics: session highest allocated ref=m00015 (the ref space is sparse — numbers at or below it are NOT necessarily allocated, so probing numbers will not find a valid one; use only refs acp_status lists), unknown ranges in request=2/2, session history=0 compression(s), 0 block(s)] Do not probe for valid numbers. Run acp_status, then call the compress tool
…（复核表截断，完整原文见 fixtures JSON）
```

### S050 · D >2000 · 4451 字符 · 自动(acceptance/material)

```text
Original user request (verbatim, task data; the brief states the Lead's decisions and scope, this states the requirement):
严格按照本计划书，执行任务。

Current stage brief (Lead-authored; later feedback may advance or replace this stage without changing the frozen work order):
计划书只读原件：C:\Users\Administrator\.dsh\attachments\v1\files\b9\b947635c3b193e18aeeac256db9c5860114d05d906b5caaf8bdde99bdcd82fca\derive-watcher-静默中断主动续跑-计划书.md（通读 §2–§9 与附录 B 自查清单）。

被审计对象（D:\dsh\dsh-derive-watcher，全部未提交）：
- 新增 lib/silent-abort.js（632 行）、test/silent-abort.test.js（511 行）；
- 已改 lib/index.js（接线）、lib/events.js（EVT）、lib/settings.js（C1–C9）、lib/timeline.js（intervention 映射）、lib/client.js（徽标）、README.md；
- docs/events.md 目前无静默中断小节（已确认，列入待补）。

审计基准（Lead 已核事实，直接采信）：
1. 内核 agent-loop 0.2.0-rc.2 turn/end 的 data.reason：blocked={kind:"blocked",reason?,code?,detail?}（补丁后，旧版只有 kind，禁止依赖 code 落盘）；completed={kind:"completed"}；abort-turn={kind:"abort-turn",...}；aborted={kind:"aborted",reason:cause}；error={kind:"error",error:{message,code}}（字段名是 error）；max-tokens 由 finish 映射。
2. DeepSeek 适配器 replayState.response 不含停止原因（readStopReason 主场景返回 unknown，靠 stepCount≥3 判 high）；多键名启发式可保留，取不到必须 unknown。
3. followup→send(next-turn,wakeup)→pr
…（复核表截断，完整原文见 fixtures JSON）
```

### S051 · D >2000 · 8404 字符 · 自动(acceptance/material)

```text
【目标文档】
# 任务卡【示例·good】发布前本地版 dsh-doc-review v0.2.1

## 自包含目标（C5-1）
发布前的本地版 dsh-doc-review v0.2.1（DR1–DR3，DR4 仅本地提交不公开），使融合插件能通过 ctx service 对「任务执行 prompt」发起独立子会话审查。脱离本卡会话上下文，执行者仅凭本文即可开工。

## 工作区（C5-2）
- 工作区根：`D:\dsh\dsh-doc-review`
- 权限边界：workspace-write；只允许改本工作区目录内文件。

## 输入（C5-3）
- 计划书：`D:\dsh\docs\model-fusion-taskboard-实现计划书-20261013.md` §4
- 侦查报告：`D:\dsh\docs\fusion-board-m0-recon-20261013.md` R5–R7
- 前置卡【1/6】：id=89e48493，开工前用 task_board_get 核对 result=succeeded。

## 产物及路径（C5-4）
- 代码：`lib/service.js`（新建）、`lib/tool.js`、`lib/schema.js`、`lib/context-builder.js`、`lib/index.js`
- 技能：`skills/doc-review-task-prompt/SKILL.md`（新建）
- 证据目录：`evidence/v021-task-prompt/`，每份报告文件名为 `<case>/review-report.json`

## 执行步骤（C5-5，严格串行）
- 【1/5】前置核对：读前置卡结果，未 succeeded 不得开工。
- 【2/5】DR1：枚举两处改动后进入 DR2，交接物=含 task-prompt 的 DOC_TYPES。
- 【3/5】DR2：新建 SKILL.md，完成后进入 DR3。
- 【4/5】DR3：抽 service，依赖【2/5】【3/5】的枚举与 SKILL。
- 【5/5】测试与冒烟，依赖前四步全部完成。
步骤间为串行，禁止并行跳步。

## 每步命令（C5-6）
- 语法检查：`node --check lib/service.js`，正信号=退出码 0 且无输出。
- 单测：在仓库根 `D:\dsh\dsh-doc-review` 执行 `node --test`（Windows 下不得把 test 目录作位置参数）。
- 冒烟：`dsh.cmd web --patch D:\dsh\dsh-doc-review\cordis.patch.yml --port 3099 --no-open`。

## 验收（C5-7）
- `node --test
…（复核表截断，完整原文见 fixtures JSON）
```

### S052 · D >2000 · 6956 字符 · 自动(acceptance/material)

```text
【目标文档】
# 「思考被当正式输出」现象诊断报告

> 日期：2026-10-03 ｜ 分析对象：当前会话（session-8912d77e） ｜ 依据：trajectory 会话日志实测
> 范围：诊断 + 结论 + 后续选项；**不含代码改动**（按用户 2026-10-03 选定：先诊断不动代码）

## 结论先行

1. **现象属实且普遍**：本会话 123 条助手消息里，**98 条（约 80%）只有正式输出（text）块、完全没有思考（reasoning）块**。这不是偶发，是当前模型在绝大多数输出上"不单独产出 reasoning，思考直接以 text 输出"。
2. **根因不在 cot-anchor**：没有证据表明 cot-anchor 在诱导模型这么做（抽样 98 条 text 里未见 cot-anchor 句式的复刻）。cot-anchor 是**受影响方**而非诱因。
3. **cot-anchor 因此半失效**：它的锚点提取和注入指纹**只读 reasoning 块**；在一个 80% 消息没有 reasoning 块的会话里，这个核心功能大部分时候"无内容可提取"。
4. **cot-anchor 的软切断碰不上这形态**：检测器能看到 text（`fullVisibleText`=reasoning+text 拼接），但判别只认"重复/转圈/伪调用/转折"四种形态，**没有"这段 text 是思考腔"的判别**，所以对这种思考直接铺进 text 的输出不拦截。

## 一、诊断方法（可复现）

1. 定位会话落盘文件：`~/.dsh/sessions/--D-dsh--/session-8912d77e.../session.v3.jsonl.zstd`
2. 用技能 `dsh-session-log-extract` 的 `stats` 命令解压并统计 content 块类型分布。
3. 抽样"只有 text 无 reasoning"的消息，人工核对 text 内容是否为思考腔。
4. 对照 cot-anchor 源码，核对锚点提取/指纹/软切断各读哪类块。

## 二、实测数据

| 指标 | 数值 |
| --- | --- |
| assistant/message 总数 | 123 |
| 含 reasoning 块 | 20 |
| 含 text 块 | 109 |
| **只有 text、无 reasoning** | **98（约 80%）** |
| reasoning 总字符 | 85937 |
| text 总字符 | 65689 |

抽样 text-only 消息内容（均为思考腔）：
- "我先查看相关测试文件与软切断处理段，确认现有的重复检测覆盖边界。"
- "我先把插件的打断决策段读完，确认
…（复核表截断，完整原文见 fixtures JSON）
```

### S053 · D >2000 · 6527 字符 · 自动(instruction/material)

```text
以下是我用fusion-board跑的任务的主agent对话窗口的内容。你帮我大致看看，主窗口这个表现，符合设计预期吗？正常吗？
---
derive-watcher-静默中断主动续跑-计划书.md 严格按计划书执行任务。
22:57

思考
Let me start by reading the plan document the user referenced: @docs\derive-watcher-静默中断主动续跑-计划书.md. The user says "严格按计划书执行任务" (strictly execute the task according to the plan document).
读取
docs\derive-watcher-静默中断主动续跑-计划书.md 
思考
Let me understand the task. The user wants me to strictly execute according to the plan document `docs\derive-watcher-静默中断主动续跑-计划书.md`. This is a design plan for adding "silent abort detection and active resume" to the dsh-derive-watcher plugin.
我先快速核对插件与内核路径是否与计划书一致，然后按计划书把 P1 实现整体委派给 Sidekick。

查找文件
dsh-derive-watcher/**/*.js
查找文件
node_modules/@deepseek-ai/*/lib/index.js
搜索文件内容
inject
思考
The glob for `node_modules/@deepseek-ai/*/lib/index.js` only found node-addon-system and cordis-plugin-hmr. The plan references `agent-loop/lib/index.js`, `dsh-goal/lib/typert.host.js`, etc. Let me check the actual structure of node_modules/@deepseek-ai — maybe the packages have different layouts (e.g., dist/ instead of lib/, or nested pnpm paths). Let me check what packages exist.
dsh-derive-watcher 结构与计划书一致（inject = ["webServer"] 在 ：39）。内核包的 glob 只
…（复核表截断，完整原文见 fixtures JSON）
```

### S054 · D >2000 · 7207 字符 · 自动(acceptance/material)

```text
【目标文档】
# 任务卡【坏样例 2：缺顺序语义】插件改造杂项

## 自包含目标（C5-1）
完成插件的一批改造事项：抽 service、改枚举、写技能、跑测试、改版本号、写 CHANGELOG。执行者凭本文即可开工。

## 工作区（C5-2）
- 工作区根：`D:\dsh\dsh-doc-review`
- 权限：workspace-write。

## 输入（C5-3）
- 计划书 §4、侦查报告 R5–R7。

## 产物及路径（C5-4）
- `lib/service.js`、`lib/tool.js`、`skills/doc-review-task-prompt/SKILL.md`、`CHANGELOG.md`。

## 执行步骤（C5-5）
要做的事如下（不分先后，自己安排）：
- 把 tool.js 的主干抽成 service
- 跑 node --test
- 改版本号到 0.2.1
- 给枚举加 task-prompt
- 写 task-prompt 的 SKILL.md
- 写 CHANGELOG
- 提交 git commit
- 3099 端口冒烟

## 每步命令（C5-6）
- 测试命令：`node --test`，正信号=退出码 0 且输出含 `# fail 0`。
- 冒烟命令：`dsh.cmd web --patch D:\dsh\dsh-doc-review\cordis.patch.yml --port 3099 --no-open`，正信号=stdout 出现带 token 的 URL。

## 验收（C5-7）
- `node --test` 退出码 0 且 `# fail 0`，记录实际通过条数。
- 冒烟日志 `Cannot find module` 计数为 0。

## 边界（C5-8）
- 只改工作区目录内文件。

## 不得碰（C5-9）
- 禁止 git push、npm publish。

## 上下文交接（C5-10）
- 完成后回复改动文件清单与 commit 哈希。

## 引用路径（C5-11）
- 参考 `lib/reviewer.js:241`。


【参考资料】
（无参考资料；证据字段填 no-reference）

【领域背景】
本技能面向「任务执行 prompt」的独立发布前审查：目标文档是发给执行 Agent（可能在独立子会话、独立上下文窗口中执行）的任务卡/派活 prompt，而不是写给人读的说明文。审查员是「找茬者」角色：假设自己对发起会话一无所知、只读这一份 prompt 就要开工，默认质疑每一条指令的可执行性与可验收性。

任务执行 prompt 的失败模式与普通文档不同：事实错误尚在其次，更致命的是「执行者开不了工」（缺目标/缺工作区/依赖会话记忆）、「干完无法判定对错
…（复核表截断，完整原文见 fixtures JSON）
```

### S055 · D >2000 · 4750 字符 · 自动(acceptance/material)

```text
【目标文档】
# 用户登录模块技术说明 v1

## 1. 概述

登录模块负责校验用户凭据并签发会话令牌。本文描述接口契约与错误处理。

## 2. 接口

POST /api/login 接收 JSON 体，字段 user_name 与 password。

## 3. 错误处理

密码错误时返回 200，这是已知的历史设计问题，调用方需读取 body 中的 code 字段判断成败。
连续失败五次后账户锁定三十分钟。

## 4. 令牌

成功后返回 token，有效期 2 小时。令牌采用明文存库以便排查。


【参考资料】
（无参考资料；证据字段填 no-reference）

【领域背景】
本技能面向通用文档（说明文、报告、方案、笔记等非创意类文本）的独立审查。审查员是「找茬者」角色：只对文档与事实负责，默认质疑文档中的每一个可验证断言，不迎合作者立场、不替作者补全未写出的意图。审查产出为结构化 issues 清单。

边界：审查只针对文档本身，不替代人工专业审核；涉及法律、医疗、安全合规等专业领域的结论不臆断，标注「需专业人工确认」。创意类文档（小说、诗歌、文案创意稿）默认关闭 necessity 维度——「是否必要」对创意表达不成立。

【审查规则】
### 通用判定纪律（四个维度共用，先于维度判据执行）

- G-1 定位必须精确。做法：每条 issue 的 location 填 ≥8 个连续字符的原文引句（须在文档中逐字命中）或某个 markdown 标题行原文。触发条件：定位里出现「某处」「上文」「第 3 段附近」等概述，或引句在原文中逐字检索不到。后果：该 issue 通不过插件二次校验，整份报告被拒收并重试。
- G-2 证据必须诚实。做法：有参考资料时 evidence 填资料来源与比对依据；无参考资料时一律填 `no-reference`。触发条件：想写出处但手头并无该资料。后果：编造引用或来源使整份报告不可信，本身按 fact 维度 high 处理。
- G-3 严重度三档口径。做法：high=会直接误导读者决策、使文档无法达成目的、或破坏机器消费的结构契约；medium=影响理解或执行效率但结合上下文尚可补救；low=不影响理解的瑕疵。触发条件：每条 issue 必须判一档，禁止留空。后果：严重度失准会让作者误排修改优先级。
- G-4 问题陈述与建议写法。做法：claim 用一句话陈述问题本身，不复述 location、不写修改方案；suggestion 给出可执行的修改方向（改什么、补什么、删什么）。触发条件：claim 与 suggestion 任一字段必填且不得为空串。后果：作者无法据空泛陈述定位和修改。

### 事实准确性（fact）

- F-1 断言逐条核对。做法：对数字、日期、版本号、名称、引用出处等可验证断言
…（复核表截断，完整原文见 fixtures JSON）
```

### S056 · D >2000 · 2450 字符 · 自动(none/material)

```text
重要发现：

D:\dsh\dsh-injection-tune 源码目录已经不存在了（被移到了 D:\dsh-backup-local-plugin-sources-20261023\）
web profile 的 package.json 里依赖是 github:JiewiW/dsh-injection-tune（不是 file:），并且 node_modules 里的副本是一个完整的 git 仓库（有 .git 目录，tag v0.1.1）
三个 profile（web、test-today、ctx-swtest）都装了这个插件
备份副本和 web node_modules 副本的文件大小完全一致（config.js 1658, host.js 8468, index.js 181, 三个 feature 文件也一致）
所以真正的源码仓库是 github:JiewiW/dsh-injection-tune，web profile 的 node_modules 副本就是个 git 克隆（含 .git + tag v0.1.1）。

之前的记忆也提到："全部 dsh-* 插件发布批次（type:progress，已完成）" 和 "三个 dsh 插件仓库的 npm 发布任务后续不再尝试任何 TOTP/OTP 方案"，以及"dsh web 启动时打印带一次性 token 的 URL"。

现在用户的需求是：先确认这个插件能提供的具体功能，再给它写相应的设置页面。

我之前的分析是正确的：这个插件只有 host 半边，没有 client 半边。用户的指责成立。

现在我需要：

读三个 feature 文件确认具体功能（源码在备份目录，但 node_modules 副本内容一致，可以直接读 node_modules 的，因为那是实际运行的副本）
然后写设置页
但是用户的原话是"dsh-injection-tune根本没像他声称的那样，在设置页单独加标签卡页面" —— 让我先确认一下这个"声称"到底来自哪里。记忆显示 2026-10-22 有个会话是"查看JiewiW的github仓库，将今天更新的几个发布，安装到DSH"，其中 dsh-injection-tune: created 2026-10-22T10:5x。

让我先读 feature 文件确认功能。既然 D:\dsh\dsh-injection-tune 不存在了，我读 web node_modules 的副本（这就是实际生效的代码）。

不过等等，我需要先确认这个插件的"声称"来自哪里，才能知道用户在说什么。但用户现在的最新指令是"先确认这个插件能提供的具体功能，再给它写相应的设置页面"，所以我应该先做这个。

让我先读三个 feature 文件。同时
…（复核表截断，完整原文见 fixtures JSON）
```

### S057 · D >2000 · 6598 字符 · 自动(acceptance/material)

```text
【目标文档】
# 任务卡【坏样例 3：TB-C5 缺项】审查插件升级

## 自包含目标（C5-1）
把审查插件升级一版，让它能审查任务执行 prompt，尽快做完。

## 工作区（C5-2）
- 在插件仓库里改。

## 输入（C5-3）
- 看计划书相关章节，问就是参考之前的做法。

## 执行步骤（C5-5）
- 【1/2】加新文档类型和技能文件。
- 【2/2】把审查逻辑抽成服务并测试。
两步串行。

## 每步命令（C5-6）
- 跑测试：`node --test`，正信号=退出码 0、`# fail 0`。

## 验收（C5-7）
- 测试全绿，0 fail。

## 边界（C5-8）
- 别乱改别的东西。


【参考资料】
（无参考资料；证据字段填 no-reference）

【领域背景】
本技能面向「任务执行 prompt」的独立发布前审查：目标文档是发给执行 Agent（可能在独立子会话、独立上下文窗口中执行）的任务卡/派活 prompt，而不是写给人读的说明文。审查员是「找茬者」角色：假设自己对发起会话一无所知、只读这一份 prompt 就要开工，默认质疑每一条指令的可执行性与可验收性。

任务执行 prompt 的失败模式与普通文档不同：事实错误尚在其次，更致命的是「执行者开不了工」（缺目标/缺工作区/依赖会话记忆）、「干完无法判定对错」（验收靠主观感觉）、「分支没写尽导致误操作」、「有依赖的步骤被并发执行」、「踩了权限红线」。因此判据以 DSH 任务卡片规范 TB-C5（十一项最低覆盖）与技能 llm-doc-writing-standard（R1–R55）为来源，结构化为 D1–D11 规则。

输出仍使用 doc_review 既有报告 Schema（summary/issues[id,dimension,severity,location,claim,evidence,suggestion]/newIssueCount）。dimension 为闭合四枚举（fact/completeness/necessity/format），D1–D11 按下表归并，**规则编号必须写进 claim 与 id**，禁止私造第五个 dimension：

| 规则 | 归并 dimension | 规则 | 归并 dimension |
| --- | --- | --- | --- |
| D1 自足性 | completeness（夹带无据事实时兼 fact） | D7 顺序语义 | completeness |
| D2 验收信号客观性 | completeness | D8 投递闭合 | completeness |
| D3 分支穷尽兜底 | completeness | D9 权限红线 | completeness |
| D4
…（复核表截断，完整原文见 fixtures JSON）
```

### S058 · D >2000 · 4825 字符 · 自动(acceptance/material)

```text
【目标文档】
# 用户登录模块技术说明 v1

## 1. 概述

登录模块负责校验用户凭据并签发会话令牌。本文描述接口契约与错误处理。

## 2. 接口

POST /api/login 接收 JSON 体，字段 user_name 与 password。

## 3. 错误处理

密码错误时返回 200，这是已知的历史设计问题，调用方需读取 body 中的 code 字段判断成败。
连续失败五次后账户锁定三十分钟。

## 4. 令牌

成功后返回 token，有效期 2 小时。令牌采用明文存库以便排查。


【参考资料】
（无参考资料；证据字段填 no-reference）

【领域背景】
本技能面向通用文档（说明文、报告、方案、笔记等非创意类文本）的独立审查。审查员是「找茬者」角色：只对文档与事实负责，默认质疑文档中的每一个可验证断言，不迎合作者立场、不替作者补全未写出的意图。审查产出为结构化 issues 清单。

边界：审查只针对文档本身，不替代人工专业审核；涉及法律、医疗、安全合规等专业领域的结论不臆断，标注「需专业人工确认」。创意类文档（小说、诗歌、文案创意稿）默认关闭 necessity 维度——「是否必要」对创意表达不成立。

【审查规则】
### 通用判定纪律（四个维度共用，先于维度判据执行）

- G-1 定位必须精确。做法：每条 issue 的 location 填 ≥8 个连续字符的原文引句（须在文档中逐字命中）或某个 markdown 标题行原文。触发条件：定位里出现「某处」「上文」「第 3 段附近」等概述，或引句在原文中逐字检索不到。后果：该 issue 通不过插件二次校验，整份报告被拒收并重试。
- G-2 证据必须诚实。做法：有参考资料时 evidence 填资料来源与比对依据；无参考资料时一律填 `no-reference`。触发条件：想写出处但手头并无该资料。后果：编造引用或来源使整份报告不可信，本身按 fact 维度 high 处理。
- G-3 严重度三档口径。做法：high=会直接误导读者决策、使文档无法达成目的、或破坏机器消费的结构契约；medium=影响理解或执行效率但结合上下文尚可补救；low=不影响理解的瑕疵。触发条件：每条 issue 必须判一档，禁止留空。后果：严重度失准会让作者误排修改优先级。
- G-4 问题陈述与建议写法。做法：claim 用一句话陈述问题本身，不复述 location、不写修改方案；suggestion 给出可执行的修改方向（改什么、补什么、删什么）。触发条件：claim 与 suggestion 任一字段必填且不得为空串。后果：作者无法据空泛陈述定位和修改。

### 事实准确性（fact）

- F-1 断言逐条核对。做法：对数字、日期、版本号、名称、引用出处等可验证断言
…（复核表截断，完整原文见 fixtures JSON）
```

### S059 · D >2000 · 6823 字符 · 自动(acceptance/material)

```text
【目标文档】
# 任务卡【坏样例 1：缺客观验收信号】给工具函数补注释

## 自包含目标（C5-1）
给 `lib/tool.js` 里的几个工具函数补充注释并顺手重命名不清楚的变量，让代码读起来更顺眼。执行者看本文即可开工。

## 工作区（C5-2）
- 工作区根：`D:\dsh\dsh-doc-review`
- 权限：workspace-write。

## 输入（C5-3）
- 待改文件：`lib/tool.js`。

## 产物及路径（C5-4）
- 改后的 `lib/tool.js`。

## 执行步骤（C5-5）
- 【1/3】通读文件，找到注释缺失的函数。
- 【2/3】补注释、重命名变量。
- 【3/3】整理格式后交付。
三步串行，后一步依赖前一步。

## 每步命令（C5-6）
- 用编辑器直接改，不需要跑命令。

## 验收（C5-7）
- 改完你自己看一遍，觉得注释写得清楚、代码看起来没问题就算通过。
- 你自测通过即可，不用留测试输出，也不用记录通过条数。

## 边界（C5-8）
- 只改 `lib/tool.js`。

## 不得碰（C5-9）
- 不要改 `lib/service.js`。

## 上下文交接（C5-10）
- 完成后回复"已完成"即可。

## 引用路径（C5-11）
- 无。


【参考资料】
（无参考资料；证据字段填 no-reference）

【领域背景】
本技能面向「任务执行 prompt」的独立发布前审查：目标文档是发给执行 Agent（可能在独立子会话、独立上下文窗口中执行）的任务卡/派活 prompt，而不是写给人读的说明文。审查员是「找茬者」角色：假设自己对发起会话一无所知、只读这一份 prompt 就要开工，默认质疑每一条指令的可执行性与可验收性。

任务执行 prompt 的失败模式与普通文档不同：事实错误尚在其次，更致命的是「执行者开不了工」（缺目标/缺工作区/依赖会话记忆）、「干完无法判定对错」（验收靠主观感觉）、「分支没写尽导致误操作」、「有依赖的步骤被并发执行」、「踩了权限红线」。因此判据以 DSH 任务卡片规范 TB-C5（十一项最低覆盖）与技能 llm-doc-writing-standard（R1–R55）为来源，结构化为 D1–D11 规则。

输出仍使用 doc_review 既有报告 Schema（summary/issues[id,dimension,severity,location,claim,evidence,suggestion]/newIssueCount）。dimension 为闭合四枚举（fact/completeness/necessity/format），D1–D11 按下表归并，**规则编号必须写进 claim 与 id**，禁止私造第五个 
…（复核表截断，完整原文见 fixtures JSON）
```

### S060 · D >2000 · 7152 字符 · 自动(acceptance/material)

```text
【目标文档】
# 任务卡【坏样例 2：缺顺序语义】插件改造杂项

## 自包含目标（C5-1）
完成插件的一批改造事项：抽 service、改枚举、写技能、跑测试、改版本号、写 CHANGELOG。执行者凭本文即可开工。

## 工作区（C5-2）
- 工作区根：`D:\dsh\dsh-doc-review`
- 权限：workspace-write。

## 输入（C5-3）
- 计划书 §4、侦查报告 R5–R7。

## 产物及路径（C5-4）
- `lib/service.js`、`lib/tool.js`、`skills/doc-review-task-prompt/SKILL.md`、`CHANGELOG.md`。

## 执行步骤（C5-5）
要做的事如下（不分先后，自己安排）：
- 把 tool.js 的主干抽成 service
- 跑 node --test
- 改版本号到 0.2.1
- 给枚举加 task-prompt
- 写 task-prompt 的 SKILL.md
- 写 CHANGELOG
- 提交 git commit
- 3099 端口冒烟

## 每步命令（C5-6）
- 测试命令：`node --test`，正信号=退出码 0 且输出含 `# fail 0`。
- 冒烟命令：`dsh.cmd web --patch D:\dsh\dsh-doc-review\cordis.patch.yml --port 3099 --no-open`，正信号=stdout 出现带 token 的 URL。

## 验收（C5-7）
- `node --test` 退出码 0 且 `# fail 0`，记录实际通过条数。
- 冒烟日志 `Cannot find module` 计数为 0。

## 边界（C5-8）
- 只改工作区目录内文件。

## 不得碰（C5-9）
- 禁止 git push、npm publish。

## 上下文交接（C5-10）
- 完成后回复改动文件清单与 commit 哈希。

## 引用路径（C5-11）
- 参考 `lib/reviewer.js:241`。


【参考资料】
（无参考资料；证据字段填 no-reference）

【领域背景】
本技能面向「任务执行 prompt」的独立发布前审查：目标文档是发给执行 Agent（可能在独立子会话、独立上下文窗口中执行）的任务卡/派活 prompt，而不是写给人读的说明文。审查员是「找茬者」角色：假设自己对发起会话一无所知、只读这一份 prompt 就要开工，默认质疑每一条指令的可执行性与可验收性。

任务执行 prompt 的失败模式与普通文档不同：事实错误尚在其次，更致命的是「执行者开不了工」（缺目标/缺工作区/依赖会话记忆）、「干完无法判定对错
…（复核表截断，完整原文见 fixtures JSON）
```

### S061 · D >2000 · 4805 字符 · 自动(acceptance/material)

```text
【目标文档】
# 用户登录模块技术说明 v1

## 1. 概述

登录模块负责校验用户凭据并签发会话令牌。本文描述接口契约与错误处理。

## 2. 接口

POST /api/login 接收 JSON 体，字段 user_name 与 password。

## 3. 错误处理

密码错误时返回 200，这是已知的历史设计问题，调用方需读取 body 中的 code 字段判断成败。
连续失败五次后账户锁定三十分钟。

## 4. 令牌

成功后返回 token，有效期 2 小时。令牌采用明文存库以便排查。


【参考资料】
（无参考资料；证据字段填 no-reference）

【领域背景】
本技能面向通用文档（说明文、报告、方案、笔记等非创意类文本）的独立审查。审查员是「找茬者」角色：只对文档与事实负责，默认质疑文档中的每一个可验证断言，不迎合作者立场、不替作者补全未写出的意图。审查产出为结构化 issues 清单。

边界：审查只针对文档本身，不替代人工专业审核；涉及法律、医疗、安全合规等专业领域的结论不臆断，标注「需专业人工确认」。创意类文档（小说、诗歌、文案创意稿）默认关闭 necessity 维度——「是否必要」对创意表达不成立。

【审查规则】
### 通用判定纪律（四个维度共用，先于维度判据执行）

- G-1 定位必须精确。做法：每条 issue 的 location 填 ≥8 个连续字符的原文引句（须在文档中逐字命中）或某个 markdown 标题行原文。触发条件：定位里出现「某处」「上文」「第 3 段附近」等概述，或引句在原文中逐字检索不到。后果：该 issue 通不过插件二次校验，整份报告被拒收并重试。
- G-2 证据必须诚实。做法：有参考资料时 evidence 填资料来源与比对依据；无参考资料时一律填 `no-reference`。触发条件：想写出处但手头并无该资料。后果：编造引用或来源使整份报告不可信，本身按 fact 维度 high 处理。
- G-3 严重度三档口径。做法：high=会直接误导读者决策、使文档无法达成目的、或破坏机器消费的结构契约；medium=影响理解或执行效率但结合上下文尚可补救；low=不影响理解的瑕疵。触发条件：每条 issue 必须判一档，禁止留空。后果：严重度失准会让作者误排修改优先级。
- G-4 问题陈述与建议写法。做法：claim 用一句话陈述问题本身，不复述 location、不写修改方案；suggestion 给出可执行的修改方向（改什么、补什么、删什么）。触发条件：claim 与 suggestion 任一字段必填且不得为空串。后果：作者无法据空泛陈述定位和修改。

### 事实准确性（fact）

- F-1 断言逐条核对。做法：对数字、日期、版本号、名称、引用出处等可验证断言
…（复核表截断，完整原文见 fixtures JSON）
```

### S062 · D >2000 · 11700 字符 · 自动(acceptance/material)

```text
目标：把 D:\dsh\dsh-doc-review 插件从"全局常驻 doc_review 工具"改造为"用户手动执行 /doc-review 斜杠指令后，doc_review 仅在当前 agent 会话可见并启动审阅"，全部验收通过后发布到 GitHub。阶段索引（严格按序）：S1 机制复核 → S2 插件改造 → S3 单测 → S4 3099 overlay 冒烟 → S5 版本/副本/文档 → S6 GitHub 发布。

【高危禁令（违反即任务失败）】
- 禁止修改、补丁、重打包 D:\dsh\node_modules 下任何 @deepseek-ai/* 内核包；它们只作为 API 事实源只读查阅。
- 禁止占用、重启或改动 3080 端口上正在运行的 DSH 实例；全部动态验证只允许在 3099 端口以 `dsh web --patch D:\dsh\dsh-doc-review\cordis.patch.yml --port 3099` overlay 方式进行。
- 禁止用"工具全局注册 + guard 拒绝调用"作为唯一可见性手段：guard 不阻止 schema 下发，未激活时工具描述仍每轮耗 token，不满足核心诉求。
- 禁止整目录镜像同步源码到 release 克隆：release 克隆 D:\dsh\release\dsh-doc-review 中 README.md、LICENSE、.gitignore 为其独有文件，删除即任务失败；只允许按 S5 显式文件清单同步。
- 禁止 `git add .` / `git add -A`：只能按显式路径暂存；提交前必须用 git status 核对暂存清单，evidence/、e2e-workspace/、p05-pilot/、REPORT-*.md、node_modules/、*.pid、*.log 一律不得入库。
- 禁止在无客观信号的情况下宣称"已验证/通过"；每个验证项必须给出命令、输出正信号串或产物路径，取不到则在最终回复中标注 N/A 及原因（第 9 条验收仅 S6 网络环节允许 N/A）。

【背景事实（2026-10-12 本机实测，置信高；S1 须抽查复核后再动手）】
- 插件现状：bundle patch 插件。D:\dsh\dsh-doc-review\cordis.patch.yml 声明插件行 id=dsh-external/dsh-doc-review、name=./lib/index.js；package.json 声明 dsh.bundle.patch，version=0.1.0。host 入口 D:\dsh\dsh-doc-review\lib\index.js ESM 导出 {name,inject,apply}，inject=["tools"
…（复核表截断，完整原文见 fixtures JSON）
```

### S063 · D >2000 · 6802 字符 · 自动(acceptance/material)

```text
【目标文档】
# 任务卡【坏样例 1：缺客观验收信号】给工具函数补注释

## 自包含目标（C5-1）
给 `lib/tool.js` 里的几个工具函数补充注释并顺手重命名不清楚的变量，让代码读起来更顺眼。执行者看本文即可开工。

## 工作区（C5-2）
- 工作区根：`D:\dsh\dsh-doc-review`
- 权限：workspace-write。

## 输入（C5-3）
- 待改文件：`lib/tool.js`。

## 产物及路径（C5-4）
- 改后的 `lib/tool.js`。

## 执行步骤（C5-5）
- 【1/3】通读文件，找到注释缺失的函数。
- 【2/3】补注释、重命名变量。
- 【3/3】整理格式后交付。
三步串行，后一步依赖前一步。

## 每步命令（C5-6）
- 用编辑器直接改，不需要跑命令。

## 验收（C5-7）
- 改完你自己看一遍，觉得注释写得清楚、代码看起来没问题就算通过。
- 你自测通过即可，不用留测试输出，也不用记录通过条数。

## 边界（C5-8）
- 只改 `lib/tool.js`。

## 不得碰（C5-9）
- 不要改 `lib/service.js`。

## 上下文交接（C5-10）
- 完成后回复"已完成"即可。

## 引用路径（C5-11）
- 无。


【参考资料】
（无参考资料；证据字段填 no-reference）

【领域背景】
本技能面向「任务执行 prompt」的独立发布前审查：目标文档是发给执行 Agent（可能在独立子会话、独立上下文窗口中执行）的任务卡/派活 prompt，而不是写给人读的说明文。审查员是「找茬者」角色：假设自己对发起会话一无所知、只读这一份 prompt 就要开工，默认质疑每一条指令的可执行性与可验收性。

任务执行 prompt 的失败模式与普通文档不同：事实错误尚在其次，更致命的是「执行者开不了工」（缺目标/缺工作区/依赖会话记忆）、「干完无法判定对错」（验收靠主观感觉）、「分支没写尽导致误操作」、「有依赖的步骤被并发执行」、「踩了权限红线」。因此判据以 DSH 任务卡片规范 TB-C5（十一项最低覆盖）与技能 llm-doc-writing-standard（R1–R55）为来源，结构化为 D1–D11 规则。

输出仍使用 doc_review 既有报告 Schema（summary/issues[id,dimension,severity,location,claim,evidence,suggestion]/newIssueCount）。dimension 为闭合四枚举（fact/completeness/necessity/format），D1–D11 按下表归并，**规则编号必须写进 claim 与 id**，禁止私造第五个 
…（复核表截断，完整原文见 fixtures JSON）
```

### S064 · D >2000 · 4749 字符 · 自动(acceptance/material)

```text
【目标文档】
# 用户登录模块技术说明 v1

## 1. 概述

登录模块负责校验用户凭据并签发会话令牌。本文描述接口契约与错误处理。

## 2. 接口

POST /api/login 接收 JSON 体，字段 user_name 与 password。

## 3. 错误处理

密码错误时返回 200，这是已知的历史设计问题，调用方需读取 body 中的 code 字段判断成败。
连续失败五次后账户锁定三十分钟。

## 4. 令牌

成功后返回 token，有效期 2 小时。令牌采用明文存库以便排查。

【参考资料】
（无参考资料；证据字段填 no-reference）

【领域背景】
本技能面向通用文档（说明文、报告、方案、笔记等非创意类文本）的独立审查。审查员是「找茬者」角色：只对文档与事实负责，默认质疑文档中的每一个可验证断言，不迎合作者立场、不替作者补全未写出的意图。审查产出为结构化 issues 清单。

边界：审查只针对文档本身，不替代人工专业审核；涉及法律、医疗、安全合规等专业领域的结论不臆断，标注「需专业人工确认」。创意类文档（小说、诗歌、文案创意稿）默认关闭 necessity 维度——「是否必要」对创意表达不成立。

【审查规则】
### 通用判定纪律（四个维度共用，先于维度判据执行）

- G-1 定位必须精确。做法：每条 issue 的 location 填 ≥8 个连续字符的原文引句（须在文档中逐字命中）或某个 markdown 标题行原文。触发条件：定位里出现「某处」「上文」「第 3 段附近」等概述，或引句在原文中逐字检索不到。后果：该 issue 通不过插件二次校验，整份报告被拒收并重试。
- G-2 证据必须诚实。做法：有参考资料时 evidence 填资料来源与比对依据；无参考资料时一律填 `no-reference`。触发条件：想写出处但手头并无该资料。后果：编造引用或来源使整份报告不可信，本身按 fact 维度 high 处理。
- G-3 严重度三档口径。做法：high=会直接误导读者决策、使文档无法达成目的、或破坏机器消费的结构契约；medium=影响理解或执行效率但结合上下文尚可补救；low=不影响理解的瑕疵。触发条件：每条 issue 必须判一档，禁止留空。后果：严重度失准会让作者误排修改优先级。
- G-4 问题陈述与建议写法。做法：claim 用一句话陈述问题本身，不复述 location、不写修改方案；suggestion 给出可执行的修改方向（改什么、补什么、删什么）。触发条件：claim 与 suggestion 任一字段必填且不得为空串。后果：作者无法据空泛陈述定位和修改。

### 事实准确性（fact）

- F-1 断言逐条核对。做法：对数字、日期、版本号、名称、引用出处等可验证断言，
…（复核表截断，完整原文见 fixtures JSON）
```

### S065 · 补 question · 3 字符 · 自动(none/question)

```text
继续？
```

### S066 · 补 question · 9 字符 · 自动(none/question)

```text
怎么还是有这个问题
```

### S067 · 补 question · 10 字符 · 自动(none/question)

```text
你就不能让我自己来？
```

### S068 · 补 question · 11 字符 · 自动(none/question)

```text
操你妈你停什么？继续啊
```
