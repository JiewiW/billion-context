# IMPROVED: quote-fidelity edition (billion-context-dsh) + 标定证据链

> 本分支是 billion-context-dsh（DSH 宿主，基于上游 3b89313）的**改进版完整快照**，并随附整个改进施工的文档与标定证据；与 `master`（上游统一版同步分支）相互独立。

## 本分支包含的改进

1. **材料分类器（mixed-form 判定链）**：`src/messages.ts` — MIN_CHARS(500) → 文档头命中 → 全文交付祈使否决 → 混合形态正文检查（编号行 ≥3 拒绝）→ 行数 ≥6 → 称呼否决；粘贴残留行识别（时间戳/状态/提示符/工具标签）。
2. **保真规则提示注入**：`src/prompts.ts` / `nudge.ts` — 范围行成分标注 `| user N`（来源标签计数，取不到留空不编造）。
3. **注入轨迹（inject-trace）**、**快照去重（snapshot-dedupe）**。
4. 姊妹分支 `improved/acp-kernel-quote-fidelity` 承载内核侧引用保真门（θ=0.56，默认 enforce）。

## improve/ — 工程证据链

| 目录 | 内容 |
|---|---|
| `improve/docs/` | 9 份工程文档：机制剖析、改进版计划书（+LLM 版 +审查报告）、两轮施工计划书、三份交付报告 |
| `improve/case/` | 标定脚本与数字产物：θ 标定（带 (0.5588, 1]，生产 0.56）、材料分类器准召（P=1.0 / R=0.8276）、误报率明细、来源覆盖率统计、68 条人工标注 fixtures |

**隐私边界**：真实会话 dump、在线注入轨迹等含对话内容的文件未上传；fixtures 经伪名化（本机路径 → `<HOME>`/`<DSH>`），标注文本保留工程语义。

## 脱敏说明

本分支面向公开发布：本机路径已统一替换为 `<HOME>` / `<DSH>` 占位符；`.bak` 备份、日志与临时调试文件未纳入。
