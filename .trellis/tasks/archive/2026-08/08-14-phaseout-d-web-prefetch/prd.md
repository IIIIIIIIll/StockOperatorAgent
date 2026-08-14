# web 亿信预抓 key 注入（child D）

## Goal

修复审计 py-agents P3（C1 决策）：web 端信息面分析师亿信预抓（三源 + twitter）恒关——`committee.ts:61` expert 工厂不传 `_billionsClient`，`agents.ts:342` 回退 `new BillionsClient()`（无 key）。补 key 注入路径，web 端预抓与 Python 对齐。**注意安全问题**（用户明确要求）。

## Background

- 审计证据：`archive/2026-08/08-14-py-ts-gap-audit/research/py-agents.md` P3/C7；`00-gap-report.md` §3 C1。
- Python 对照：`information_analyst.py:153-186` 预抓经 `billions_enabled`（含主闸 key 硬约束）+ `_client` 懒加载。
- TS 现状：`agents.ts:326-345` 构造已接受可选 `_billionsClient`（第 5 参）；`runner.ts` `makeBillionsIntel`（131-153）与 `assembleTools`（168-177）已从 settings.keys 读亿信 key；`committee.ts:61` 工厂不传。
- 决策（用户 2026-08-14）：补 key 注入，**注意安全问题**。

## Requirements

1. 亿信 key（settings.keys.billionsApiKey）经 App → committee 装配 → `BillionsInformationAnalyst` 构造 `_billionsClient` 注入，预抓三源 + twitter 在 web 端生效。
2. **安全约束**（用户强调）：
   - key 不落日志（log.ts 无 key 输出；注入路径不打印 key）
   - 不新增代理透传——保持浏览器端直连亿信 API 现状（billionsClient 现状），不把 key 引入 /llm-proxy 类服务端转发
   - 无 key → 行为与现状一致（DDG 回退、不报错、不注册差异）
3. 接线路径复用现有 `settings.keys.billionsApiKey` 读取（与 makeBillionsIntel/assembleTools 同源），不新增 env 读取。
4. 无 key 注册谓词差异（审计 C3）**不处理**——保持现状，仅记录（用户默认接受）。

## Acceptance Criteria

- [ ] web 端配置亿信 key 后，分析师预抓产出「【亿信检索结果】」素材（浏览器实测或注入 fake client 单测）
- [ ] 无 key → 行为与现状逐字节一致（DDG 回退文本不变）
- [ ] 日志无 key 泄漏（grep 注入路径无 console/log 打印 key）
- [ ] 不新增服务端代理路由（git diff 无 proxies.cjs/server.mjs 亿信相关改动）
- [ ] vitest 新增用例覆盖注入 + 安全约束；现有全绿 + `tsc --noEmit`

## Out of scope

- 无 key 注册谓词对齐（C3，记录为设计差异）
- 亿信预抓参数对齐（_COUNT 5→10、公告检索词，py-agents P2，NON_BLOCKER）
- Node/探针链路补齐（C6，接受现状）
