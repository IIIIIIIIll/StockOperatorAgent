# phaseout 收尾核验（零遗漏确认）

## Goal

Python phaseout（A-E）+ TS 本地数据持久化全部完成后，做一次**彻底的收尾核验**：并行只读 scout 覆盖所有可能遗漏的面——① Python 残留引用（含隐藏面）；② 持久化语义深查；③ TS 功能完整性（审计 ~300 功能点处置后无缺失）；④ 交付物/文档/spec/任务归档一致性。产出逐项确认清单，发现真实遗漏则修复或列入待办。

**核验为主：发现 → 确认/修复 → 留档。** 零遗漏是目标。

## Scope

### In scope

1. **残留引用**：全仓（含 `.claude/`、`.omp/`、`.trellis/`、`docs/`、`.env.example`、hooks、skills、scripts）grep Python 时代引用——`import core|agents|utils|data_source|data_storage|data_structure`、`python3`、`pytest`、`streamlit`、`akshare`、`ZODB`、`requirements.txt`、`main.py`、`legacy_akshare`、`mcp_intel_cache`、`test_query_baselines` 等。
2. **持久化深查**：IdbStore/FileStore 与 Store/InMemoryStore 全方法语义逐项比对（含边界：空输入/重复日期/乱序/超大/并发/close 后调用/ready 失败重试/flush 语义/队列错误隔离已测之外路径）；App 启动链、loadDemoData 判定、freshness 跨会话数据链。
3. **TS 功能完整性**：对照审计报告 00-gap-report.md——MISSING 全处置、BLOCKER 全闭环、PARTIAL 处置后 TS 无功能缺失；事件协议/流式/代理/图表/亿信/mcp/qfq 接线；删 Python 后 probe/web/测试独立可运行。
4. **交付物/文档**：spec ts/index.md 状态块、README、fixtures 冻结、tasks 归档完整性、journal、遗留确认项清单（.streamlit/export_fixtures/磁盘产物）核对。

### Out of scope

- 新功能开发
- Python 时代历史文档的逐行修订（只核对引用性内容）

## Requirements

1. 4 个只读 scout 并行，每片产出 `research/<slice>.md`：逐项确认表（项 / 证据 file:line / 结论 OK 或问题）。
2. 发现问题分级：REAL（真实遗漏，需修复/待办）/ OBS（观察，非缺陷）。
3. 主 agent 汇总：确认表 + 修复项 + 遗留清单。
4. 防假阳性：遵守 guides/index.md（信任边界/设计注释/变量误读）。

## Acceptance Criteria

- [ ] 4 片核验全部完成，逐项确认表齐备
- [ ] 无 REAL 遗漏或全部已修复/列入待办
- [ ] 汇总报告 `research/00-final-audit.md`：总体结论 + 遗留清单
