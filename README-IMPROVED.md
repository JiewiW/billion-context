# IMPROVED: quote-fidelity edition (acp-kernel)

> 本分支是 acp-kernel（基于 v0.0.101）的**改进版完整快照**，与 `master`（上游统一版同步分支）相互独立。

## 本分支包含的改进

1. **引用保真门（quote-fidelity gate）**：压缩摘要必须逐字保留用户消息中的硬约束句，两档判定（严档逐句覆盖 / 宽档整条覆盖），θ=0.56（标定带 (0.5588, 1] 内）。核心实现：`src/compress.ts`（`quoteTierOf` / `missingQuoteFragmentsOf`）、`src/compression-rules.ts`。
2. **来源门（provenance gate）**：user 消息按来源标签（user-turn / user-material / host-policy / host-content / checkpoint）分类，`prune.ts` 保护名单保留 `provenance === undefined` fail-loud 分支。
3. **用户原话保留（user-verbatim-keep）** 与 **紧急截断护栏（emergency-truncate）**。
4. **提示注入**：保真规则文本经 `prompts.ts` / `packs.ts` 注入，默认配置字节稳定（fixture 校验）。
5. **默认 enforce**：`config.ts` 中 `quoteFidelityMode: "enforce"`（2026-10-29 复审后切换）。

## 验收状态（2026-10-29 实测）

- 测试 1264 用例：1262 通过，2 失败均为已登记的 Windows 环境差异（ccr 路径分隔符、surface-config CRLF），非功能缺陷。
- 标定证据与工程文档见姊妹分支 `improved/bcdsh-quote-fidelity` 的 `improve/` 目录。

## 脱敏说明

本分支面向公开发布：本机路径已统一替换为 `<HOME>` / `<DSH>` 占位符；`.bak` 备份与临时调试文件未纳入。
