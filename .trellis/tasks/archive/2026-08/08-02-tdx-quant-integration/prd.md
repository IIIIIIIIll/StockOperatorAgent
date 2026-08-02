# 集成 tdx_quant 通达信数据管道

## Goal

将 https://github.com/henrylin99/tdx_quant（通达信量化数据管道，pytdx 直连 + TDX MCP）集成进 StockOperatorAgent，实现三个能力（用户已确认范围）：

1. **M1 历史行情数据源**：TdxSource 薄包装 + 列映射兼容层 + DataAcquisition 接入，作为历史行情主路径（akshare 兜底）
2. **M2 指标/选股器**：通达信口径技术指标（compute_all）接入 agent 输入；条件选股器作为离线能力提供
3. **M3 TDX MCP 实时工具**：概念板块/资金流/大盘等实时情报注入 agent 决策前上下文

## Requirements

### M1 历史行情数据源

- 依赖引入方式：**vendor 快照**（tdx_quant 无打包文件，非 pip 可装；clone-and-run 自包含优先），记录上游 commit；submodule 作为备选方案记录在 design.md
- `data_source/chinese_mainland/tdx/` 新增 `TdxSource` 薄包装：**class per source, method per endpoint, raw DataFrame out**（遵循 data_source spec 既有约定）
- 新增列映射层：pytdx bars → akshare `stock_zh_a_hist` 12 列序（日期/股票代码/开盘/收盘/最高/最低/成交量/成交额/振幅/涨跌幅/涨跌额/换手率），使既有 `ChinaStockData(*list(row.values()))` 位置构造**零改动**复用
- 历史价格必须**前复权（qfq）**：akshare 路径存的是 qfq 价，TDX 裸 bar 是未复权价，混存会破坏指标连续性；用 xdxr 除权除息数据实现 qfq 调整
- `DataAcquisition` 新增 `acquire_historical_data_tdx`，遵循既有约定：新鲜度优先（`stock.last_data_update`）、布尔结果协议（成功 `True`，失败 `False` + `logger.error`）、loguru `{}` 占位
- `get_stock_data(ticker)`：TDX 优先，失败自动回退 akshare；**akshare 既有路径与测试不动**
- 依赖：`requirements.txt` 增加 `pytdx==1.72`（已在 Python 3.13.5 实测可拉取真实日K；httpx/pyarrow/pandas 已存在）

### M2 指标/选股器

- 技术指标：vendor 的 `compute_all`（通达信口径 MA/EMA/MACD/RSI/KDJ/BOLL/ATR/量比/换手，`adjust=False`、`ddof=0` 等），对日K/分钟K 计算；结果注入 agent 输入（enrichment，不改 agent 模式）
- 选股器：vendor 的 screener（`screen(codes, conditions, data_root, max_bars)`）作为**离线能力**提供 + 冒烟测试；不接入请求时链路（全市场扫描不适合运行时）
- 换手率需要流通股本：`fetch_finance_capital`（pytdx 股本结构快照）提供 `shares` 参数

### M3 TDX MCP 实时工具

- vendor `scripts/tdx_mcp/`（TdxMcpClient，仅依赖 httpx）
- 新增 `core/llms/tools/` 工具：按目标股票查询概念板块/资金流/大盘概况
- 接入点：`make_investment_decision` 图前预取，追加进 `stock_information`——**不改 State/图/agent 模式**（agent 是 `prompt | llm` 链，无 tool calling）
- 无 `TDX_API_KEY` 时**优雅降级**（返回占位说明文本），不阻断主流程；`.env.example` 增加 `TDX_API_KEY=`

## Acceptance Criteria

### M1

- [ ] `pip install -r requirements.txt` 后，Python 3.13 下 `TdxSource().fetch_daily("000001")` 返回 ≥1 根真实日K（实时 smoke 测试）
- [ ] mapping 层输出与 akshare `stock_zh_a_hist` 列序完全一致，`ChinaStockData(*list(row.values()))` 可构建且字段正确（离线单测，含 golden values）
- [ ] qfq 复权：对已知股票，复权后收盘价与 akshare qfq 结果偏差 < 0.5%（离线单测）
- [ ] `acquire_historical_data_tdx` 遵循布尔协议 + 新鲜度优先；当日已更新时跳过（有测试覆盖）
- [ ] `get_stock_data` 在 TDX 失败时回退 akshare，且 akshare 路径行为不变
- [ ] 既有 pytest 全绿（`pytest`），新增 `test/data_source/test_tdx_*.py`

### M2

- [ ] 指标 enrichment：给定日K，`compute_all` 输出含 MACD/RSI/KDJ/BOLL/ATR 列（离线单测，与 tdx_quant 自带测试口径一致）
- [ ] screener 冒烟：对 2 个代码 + 1 个条件跑通 `screen`，输出 RESULT_COLUMNS 结构
- [ ] 换手率：传入流通股本时产出合理值，缺省 NaN 不报错

### M3

- [ ] 无 TDX_API_KEY 时图可正常运行（降级文本进入 stock_information，单测覆盖）
- [ ] 有 key 时 `get_market_intel("000001")` 返回概念/资金流/大盘数据（live smoke，可跳过）
- [ ] `.env.example` 含 `TDX_API_KEY=`

### 全局

- [ ] 全量 `pytest` 通过（现有 + 新增）
- [ ] 不破坏既有 akshare 路径、位置映射约定、error-handling/logging 约定
- [ ] `data_source/index.md` spec 更新：记录 TdxSource 约定、mapping/qfq 层、vendor 机制
- [ ] README 更新：说明 TDX 数据源、`TDX_API_KEY` 配置、vendor 更新方式

## Constraints

- 不改 agent 类模式（`prompt | llm` 链、State 结构、图拓扑）——M3 情报走图前 enrichment
- 不改既有 akshare 路径与 `ChinaStockData` 位置构造
- 不引入自定义异常类；错误处理遵循既有两层模式（数据层布尔协议 / LLM 工具边界 raise）
- vendor 代码保持上游原样（除非 import 层面必须微调，需在 VENDOR.md 记录差异）
- TDX 直连需节流：批处理间隔、单次拉取条数上限，防封 IP

## Notes

- 复杂任务：design.md + implement.md 完成后经 review gate（`task.py start`）再进入实施
- pytdx 实测：115.238.56.198:7709 可连通并返回真实数据（2026-07-27 平安银行日K）；个别服务器超时或返回空，需要多服务器 fallback（vendor 已实现 connect_first_available）
- snapshot（实时快照）路径在实测中 quotes 返回空，实施时需验证 `fetch_realtime_watchlist` 通道；失败不影响历史行情主路径
