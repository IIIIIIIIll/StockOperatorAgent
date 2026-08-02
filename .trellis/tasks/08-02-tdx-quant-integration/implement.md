# 实施计划：集成 tdx_quant 通达信数据管道

上游：https://github.com/henrylin99/tdx_quant（当前 main HEAD）
本地研究克隆：/tmp/tdx_quant（已 clone，含实测验证）

## 里程碑与检查点

**M0 前置验证（已完成）**
- [x] pytdx==1.72 在 Python 3.13.5 安装/导入成功
- [x] 实测拉取真实日K（115.238.56.198:7709，000001 返回 5 根 bar）
- [x] 确认 tdx_quant 无打包文件 → vendor 路线成立
- [x] 核对 vendor import 面 vs requirements.txt（唯一新依赖 pytdx）
- [x] `download_finance_capital` 输出字段确认：`liutongguben` = 流通股本
- [x] xdxr 输出确认：`trade_date` + pytdx 原始字段（category/fenhong/songgu/peigu…）
- [x] bars 列序确认：`datetime, open, high, low, close, vol, amount, market, code, ts_code, trade_date`
- [x] 上游 commit：`b95d8e915aa2fa4b703e64c38ca48eb51a6fa96e`
- [x] .gitignore 无 data/ 条目 → 需新增（`data/` 或 `data/tdx_cache`）
- [x] `fetch_realtime_watchlist`（snapshot 通道）实测可用：`fetch_snapshot('000001')` 返回实时快照（price=11.63）

**M1 历史行情数据源**
1. vendor 拷贝：
   - `mkdir -p data_source/chinese_mainland/tdx/vendor/scripts`
   - 拷贝 `data_pipeline/` 全子树 + `tdx_mcp/` 全子树 → vendor/scripts/
   - 写 `VENDOR.md`（commit、日期、范围、差异清单）
   - 验证：sys.path 插入后 `import scripts.data_pipeline.tdx_client` 成功
2. `tdx_source.py`：TdxSource 8 个 fetch_* 方法（薄包装）
3. `mapping.py`：`to_akshare_hist_schema(df, ticker, float_shares=None)` → 12 列序
4. `adjust.py`：qfq 算法（xdxr 事件 → 复权因子）
5. `data_acquisition.py`：`acquire_historical_data_tdx` + `get_stock_data` TDX 优先/akshare 兜底
6. requirements.txt：`pytdx==1.72`；确认 `data/tdx_cache` gitignored（查 .gitignore，缺则加）
7. 测试：test_tdx_mapping / test_tdx_adjust / test_tdx_source（live）/ test_data_acquisition_tdx
8. **检查点**：`pytest` 全绿；`python -c` 冒烟 `TdxSource().fetch_daily("000001")`

**M2 指标/选股器**
9. `get_trend_indicators(ticker)` 工具（ZODB 日K → compute_all → 指标文本）
10. screener 冒烟测试（2 代码 + 1 条件，RESULT_COLUMNS 断言）
11. **检查点**：新增测试绿 + 既有绿

**M3 TDX MCP**
12. `get_market_intel(ticker)` 工具（无 key 降级）
13. `investment_committee.py`：`make_investment_decision` 前置 enrichment（函数内 import）
14. `.env.example` 加 `TDX_API_KEY=`
15. **检查点**：无 key 环境跑通图（降级文本）；有 key live smoke（可选）

**收尾**
16. [x] README：TDX 数据源说明、TDX_API_KEY、vendor 更新方式
17. [x] spec 更新：`data_source/index.md` 等 6 个 spec 文件（TdxSource/mapping/qfq/
     vendor 约定、ZODB 单例、TDX 异常捕获点、新工具、TDX 测试）
18. [x] 全量 `pytest`（28 过 / 29 环境性失败，零新增）→ git 审查 → 提交

## 验证命令

```bash
# vendor import 验证
python3 -c "import sys; sys.path.insert(0, 'data_source/chinese_mainland/tdx/vendor'); import scripts.data_pipeline.tdx_client; print('vendor import OK')"

# 数据源冒烟
python3 -c "from data_source.chinese_mainland.tdx.tdx_source import TdxSource; df = TdxSource().fetch_daily('000001'); print(df.tail(3))"

# 测试
python3 -m pytest -q

# qfq 对比（开发期一次性核对）
python3 -c "..."  # akshare qfq vs TDX qfq 偏差 < 0.5%
```

**基线（2026-08-02，无 .env / DASHSCOPE_API_KEY，部分网络受限）**：既有套件
29 failed / 3 passed。失败分类：
- live Qwen 集成测试（缺 DASHSCOPE_API_KEY）— 环境性
- live akshare（网络慢/限流，README 已注明）
- `ChinaStock('dummy')` 已知损坏测试（testing spec 已记录）
回归门槛 = **不新增失败**：基线下通过的 3 个保持通过 + 新增离线测试全绿 +
新增 live 测试不引入异常错误（失败需为环境性并记录）。

## Review Gates

- M1 完成 → 全量测试绿 + 冒烟过 → 再进入 M2
- M2 完成 → 新增测试绿 → 再进入 M3
- 最终：全量 pytest、git diff 审查、spec 更新后 commit

## 回滚点

- `get_stock_data` 主路径改动单行可还原（TDX 失败回退逻辑剥离）
- 新增文件（tdx_source/mapping/adjust/vendor）删除即完全卸载
- 里程碑不达标不回退已提交内容，先修再走

## 待实施时确认（开放问题）

1. ~~流通股本字段名~~ → 已确认：`liutongguben`；mapping 层读该列，缺失则换手率 NaN
2. ~~xdxr 输出列~~ → 已确认：`trade_date` + category/fenhong/songgu/peigu/suogu 等 pytdx 原始字段；adjust 算法据此计算复权因子
3. snapshot 通道（fetch_realtime_watchlist）实测是否可用——M1 不依赖，实施时验证，失败仅记日志
4. ZODB 中既有数据为 akshare qfq——切换 TDX 后首次增量衔接是否出现混价（同一 ticker 新旧数据复权口径一致即无问题；不一致时设计清库/全量重拉策略）
