# 实施计划：TDX 覆盖个股概览与业绩报告

## 里程碑

**M1 概览层**
1. `TdxSource.get_stock_name`（security_list 名称索引 + 模块级缓存；失败回退 ticker）
2. `data_source/chinese_mainland/tdx/overview.py`：build_overview（22 列序 +
   派生计算：PE/PB/市值/涨跌幅/60日/ytd）
3. 测试：`test/data_source/test_tdx_overview.py`（离线 golden + live）
4. **检查点**：离线全绿 + live 000001 overview 字段合理

**M2 业绩报告层**
5. `data_source/chinese_mainland/tdx/reports.py`：build_reports（pivot + 映射 +
   QoQ 自算）
6. 测试：`test/data_source/test_tdx_reports.py`（离线 + live）
7. **检查点**：新增测试绿 + 既有绿

**M3 流程重构**
8. `DataAcquisition`：ensure_stock + acquire_performance_report_tdx +
   get_stock_data 纯 TDX 化
9. 扩展 `test/core/data_acquisition/test_data_acquisition_tdx.py`
10. **检查点**：get_stock_data('000001') 全链路（overview+历史+业绩，无 akshare）

**收尾**
11. README（数据源说明：纯 TDX、按需构建、缺字段 NaN）
12. spec 更新（data_source/index.md、core/index.md、architecture.md）
13. 全量 pytest + git 审查 → 提交

## 验证命令

```bash
# overview 冒烟
python3 -c "from data_source.chinese_mainland.tdx.tdx_source import TdxSource; df = TdxSource().build_overview('000001'); print(df.iloc[0][['股票代码','名称','最新价','市盈率-动态','总市值']])"

# 业绩冒烟
python3 -c "from data_source.chinese_mainland.tdx.tdx_source import TdxSource; df = TdxSource().build_reports('000001'); print(df.head(2))"

# 全链路
python3 -c "from core.data_acquisition import DataAcquisition; s = DataAcquisition().get_stock_data('000001'); print(s.ticker, len(s.get_datas()), len(s.get_performance_reports()))"

# 测试
python3 -m pytest -q test/data_source/test_tdx_overview.py test/data_source/test_tdx_reports.py test/core/data_acquisition/test_data_acquisition_tdx.py
```

## Review Gates

- M1 完成 → 概览测试全绿 + 冒烟 → M2
- M2 完成 → 报告测试全绿 → M3
- M3 完成 → 全链路冒烟 + 全量回归 → 收尾提交

## 回滚点

- `get_stock_data` 单行还原；新增文件删除即卸载；akshare 方法全程保留
- 里程碑不达标不提交，先修再走

## 开放问题

1. snapshot 在非交易时段（周末/盘后）返回的 price 是收盘价？实测确认（周六
   实测返回 11.63 = 7/31 收盘 ✓ 已确认）
2. 名称表首次拉取耗时（SH+SZ 分页）实测；失败时 name 回退 ticker
3. F10 最新报告期 eps 口径（报告期 vs 动态）——以最新期为准并记录
4. `change_percent_ytd` 年初基准：取年内首个交易日收盘，跨年时 prev 为去年末
5. 全量回归中 test_acquire_historical_data_failed 偶发翻转（ZODB 状态依赖）
   ——本任务不动，记录
