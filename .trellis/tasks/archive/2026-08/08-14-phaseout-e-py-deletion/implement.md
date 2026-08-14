# Implement：Python 分域删除（child E）

## 前置

- [ ] A/B/C/D 全部完成（BLOCKER 处置完毕）——未完成则本任务 blocked
- [ ] 通读审计报告 `archive/2026-08/08-14-py-ts-gap-audit/research/00-gap-report.md` §4/§5 与各分片 gap 表

## 执行顺序（每域：删除 → 验证 → commit）

1. **E1 死代码面**：git rm legacy_akshare.py、akshare/fetch_stcok_data.py、mcp_intel_cache.py、scripts/*.py、StockInfo.py、ZODBStorage 17:00 门（编辑保留文件）、fetch_minute/fetch_index（编辑 tdx_source.py）→ vitest + tsc + grep 无引用 → commit
2. **E2 数据源/存储面**：git rm data_source/、data_storage/、data_structure/ + test/data_source、test/data_storage、test/data_structure → vitest + tsc + probe.mts 采集冒烟 → commit
3. **E3 工具/agent 面**：git rm core/llms/、agents/ + test/agents、test/core/llms、test/core/tools → vitest + tsc + demo 全图冒烟 → commit
4. **E4 编排/UI 面**：git rm core/（剩余）、utils/、main.py + test/core/（剩余）、test/utils、test/e2e → vitest + tsc + 浏览器完整分析冒烟 → commit
5. **E5 收尾**：agents.ts 头注释（M3 契约声明，C2）、overview.ts 头注释（命名漂移，C4）、spec/README 更新 → tsc + spec 一致性 → commit

## 验证命令（每域重复）

```bash
cd ts && npx vitest run && npx tsc --noEmit
node --experimental-strip-types tools/probe.mts 600036   # E2 起
```

## 风险文件

- `core/data_acquisition.py` 被 `get_company_info` 工具消费（E3/E4 边界——按域序 E2 后 E3 删 tools 时确认）
- `test/e2e/` Streamlit mock 套件（E4 随 UI 面删）
- `ts/tools/export_fixtures.py`（保留至 E5）

## start 前 follow-up

- [ ] A-D 完成确认
- [ ] 审计报告 gap 表已逐域核对（被删能力 TS 等价物存在）
- [ ] 删除清单 == 审计建议，用户已批准
