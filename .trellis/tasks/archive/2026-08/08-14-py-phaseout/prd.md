# Python phaseout 执行：TS 功能完整化 + 分域删除

## Goal

基于 08-14-py-ts-gap-audit 审计结论（已归档），执行 Python phaseout：

1. **TS 功能完整化**：处理 4 个 BLOCKER（B1 亿信 caps 接线、B2/B3/B4 UI 补齐）与已决策接线项（freshness 门、web 亿信预抓 key 注入）。
2. **Python 分域删除**：按依赖顺序删除 Python 业务代码，每域删除后可独立验证（vitest + tsc + 现有 Python 测试回归对照）。

## 任务树

```
08-14-py-phaseout (parent)
├── A 08-14-phaseout-a-bills-caps   B1: 亿信 caps 接线（独立）
├── B 08-14-phaseout-b-ui-gaps      B2/B3/B4: 日K 列 + 涨跌幅柱图 + 财务趋势图（独立）
├── C 08-14-phaseout-c-freshness    C8: freshness 门接线（独立）
├── D 08-14-phaseout-d-web-prefetch C1: web 亿信预抓 key 注入 + 安全约束（独立）
└── E 08-14-phaseout-e-py-deletion  Python 分域删除（依赖 A-D 完成）
```

## 依赖

- E 依赖 A/B/C/D 全部完成：删除 Python 前 TS 必须先具备全部被删能力（BLOCKER 处置是前置）。
- A-D 相互独立，可并行；每个 child 的验收标准见各自 prd.md。

## 决策输入（审计任务 §2.5，用户 2026-08-14 拍板）

| 决策 | 决定 |
|---|---|
| B1 caps 死控件 | 接线到工具层（caps → assembleTools → maxCalls 注入） |
| B2/B3/B4 UI 缺口 | 全部补齐（日K 2 列 + 涨跌幅柱图 + 财务趋势图） |
| C1 web 亿信预抓 | 补 key 注入，注意安全问题（key 不落日志、不新增代理透传、保持浏览器端直连） |
| C2 M3 契约 | 更新契约为准（改 agents.ts 头注释）——归 E 收尾 |
| C8 freshness 门 | 接线恢复同日跳过 |

次要项默认：C3 无 key 谓词记录为设计差异；C4 overview 命名修正注释；C5 LangSmith 接受无遥测；C6 Node 探针接受现状；C7 配置持久化接受。

## Requirements

1. A-D 各自达成 child prd.md 的验收标准（可独立验证，不依赖其它 child）。
2. E 分域删除顺序：死代码面（legacy_akshare/akshare/mcp_intel_cache/fetch_minute/fetch_index/StockInfo/17:00 门/backfill/export 脚本）→ 数据源面 → 工具/agent 面 → 编排/UI 面 → main.py；每域删除跑 vitest 全绿 + `tsc --noEmit` + 对应 Python 测试回归对照。
3. 删除前确认无 TS 依赖缺失（审计报告 MISSING/BLOCKER 全处置完毕）。
4. 引用审计证据：`.trellis/tasks/archive/2026-08/08-14-py-ts-gap-audit/research/*.md`（00-gap-report.md 是主索引）。

## Acceptance Criteria

- [ ] A-D 全部完成且验收通过（vitest 覆盖新增行为）
- [ ] E 完成后 `git rm` 的 Python 业务文件清单与审计报告删除建议一致（0 意外删除）
- [ ] 删除后 vitest 全绿 + `tsc --noEmit` 通过
- [ ] 工作树干净，每域删除独立 commit
- [ ] spec 更新：删除后 ts/index.md 更新为「Python 已 phaseout」状态；收尾项（C2/C4）落实

## Out of scope

- 北交所 / akshare 备用路径（BY_DESIGN，不移植）
- mcp_intel_cache / is_trading_time（决策不移植）
- LangSmith 遥测接线（C5 接受无遥测）
- Python 测试套件的迁移（随 Python 删除，TS 测试已覆盖）

## Notes

- Python 侧代码在 E 完成前保持只读；A-D 只改 TS。
- 报告语言：中文。
