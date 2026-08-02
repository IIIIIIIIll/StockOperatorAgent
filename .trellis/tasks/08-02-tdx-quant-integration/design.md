# 设计：集成 tdx_quant 通达信数据管道

## 1. 现状与边界

```
现有主链路（不动）:
AKShareSource.fetch_stock_history(ticker, look_back_days)
  → DataFrame(akshare 12列) → ChinaStockData(*list(row.values())) → ZODB
  → StockOutputFormatter → stock_information → InvestmentCommittee 图(5 agents, prompt|llm 链)

本设计新增:
TdxSource(fetch_*) → mapping.to_akshare_schema(df) → 同一 12 列序
  → 复用 ChinaStockData(*list(row.values())) → ZODB   ← M1
compute_all(日K/分钟K) → enrichment → stock_information ← M2
TdxMcpClient.query(实时情报) → enrichment → stock_information ← M3
```

**边界约束**：
- agent 图（State/节点/边/prompt）零改动——情报走 `make_investment_decision` 图前预取
- `ChinaStockData` 位置构造零改动——映射层负责对齐 akshare 列序
- akshare 路径与既有测试零改动——TDX 是并列路径 + 主优先

## 2. vendor 机制（引入方式）

**决策：vendor 快照，非 submodule。**

理由：
- tdx_quant 无 pyproject/setup.py，pip 不可装
- 本仓库 clone-and-run 自包含（README），submodule 引入 clone 摩擦（--recursive）与上游存续依赖
- 12 commits 未发版项目，vendor 固定快照即诚实状态

**结构**（保留上游绝对导入 `scripts.*` 不动）：
```
data_source/chinese_mainland/tdx/vendor/          ← vendor 根（sys.path 插入点）
  scripts/data_pipeline/     (connectors/ extractors/ jobs/ materializers/
                             indicators/ screener/ normalizers/ code_mapping.py
                             fetch_realtime_watchlist.py tdx_client.py ...)
  scripts/tdx_mcp/           (tdx_client.py tdx_stock_analyzer.py tdx_concept_board.py ...)
  VENDOR.md                  ← 上游 commit、日期、与上游差异清单
```
- 不含 `frontend/`、`tests/`、根级 README/PLAN_INTERFACES.md（不参与运行）
- `TdxSource` 模块级一次性 `sys.path.insert(0, vendor_root)`，导入上游模块；此 sys.path 副作用限定在该包内
- 更新流程：重新拷贝 + 更新 VENDOR.md commit（写入 README）

**依赖核对**（vendor 代码 import 面 vs requirements.txt）：
- pandas/pyarrow/numpy/httpx/tqdm/tabulate 均在 requirements.txt ✓
- 需新增：`pytdx==1.72`（唯一新依赖）
- jobs/materializers 用 pyarrow 写 parquet——本仓库有 pyarrow==23.0.1 ✓（TdxSource 可传 `data_root=Path("data/tdx_cache")`（gitignored）做磁盘缓存，与 TdxDownloader 默认行为一致）

## 3. M1 数据源层

### 3.1 TdxSource（`data_source/chinese_mainland/tdx/tdx_source.py`）

遵循 data_source spec：class per source、method per endpoint、raw DataFrame out、无业务逻辑。

```python
class TdxSource:
    def __init__(self, parquet_root: Path = Path("data/tdx_cache")): ...
    def fetch_daily(self, ticker: str, max_bars: int | None = None) -> pd.DataFrame
    def fetch_minute(self, ticker: str, freq: int = 5, max_bars: int | None = None) -> pd.DataFrame
    def fetch_xdxr(self, ticker: str) -> pd.DataFrame
    def fetch_finance_capital(self, ticker: str) -> pd.DataFrame
    def fetch_company_finance(self, ticker: str) -> pd.DataFrame
    def fetch_security_list(self, market: int) -> pd.DataFrame
    def fetch_snapshot(self, ticker: str) -> pd.DataFrame
    def fetch_index(self, code: str, market: int, max_bars: int | None = None) -> pd.DataFrame
```
内部：`TdxDownloader(parquet_root)`；全部走 vendor 代码，不做清洗/转换。

### 3.2 列映射层（`data_source/chinese_mainland/tdx/mapping.py`）

**契约**：输出 DataFrame 列名与 akshare `stock_zh_a_hist` 完全一致（顺序即值顺序）：

| 列名 | pytdx 来源 | 计算 |
|---|---|---|
| 日期 | datetime | `%Y-%m-%d` 字符串（与 akshare 一致） |
| 股票代码 | ts_code | 6 位（去 `.SZ` 后缀） |
| 开盘/收盘/最高/最低 | open/close/high/low | — |
| 成交量 | vol | cast int64 |
| 成交额 | amount | — |
| 振幅 | — | `(high-low)/prev_close*100`，首行 NaN |
| 涨跌幅 | — | `(close-prev_close)/prev_close*100`，首行 NaN |
| 涨跌额 | — | `close-prev_close`，首行 NaN |
| 换手率 | — | `vol/float_shares*100`；`float_shares=None` 时 NaN |

函数：`to_akshare_hist_schema(df, ticker, float_shares=None) -> pd.DataFrame`。

### 3.3 前复权（`data_source/chinese_mainland/tdx/adjust.py`）

- 输入：mapping 后的日K + xdxr 事件表（`download_xdxr` 输出：送配股/分红/除权日）
- 算法：标准 qfq——以最新事件日为基准，向前对历史价乘复权因子（送配股摊薄 + 现金红利），与 akshare `qfq` 口径对齐
- 输出：调整后的 12 列 DataFrame（只改价格列，成交量按因子反比调整——akshare qfq 成交量同口径）
- 验收：平安银行/贵州茅台 近 120 日 qfq 收盘价 vs akshare `adjust="qfq"` 偏差 < 0.5%
- 若 xdxr 拉取失败：降级返回未复权数据 + `logger.warning`（data_source 层不 raise，遵循布尔协议/日志约定）

### 3.4 DataAcquisition 接入

```python
def acquire_historical_data_tdx(self, ticker):   # 镜像既有 acquire_historical_data
    # 新鲜度优先: stock.last_data_update == today → True
    # 1. TdxSource().fetch_finance_capital(ticker) → float_shares (失败→None)
    # 2. TdxSource().fetch_daily(ticker, max_bars=look_back_days) + fetch_xdxr
    # 3. mapping → adjust → 每行 ChinaStockData(*list(row.values())) → stock.add_data
    # 4. storage.put_stock + logger.info → True / False + logger.error
def get_stock_data(self, ticker):                 # 改主路径
    # acquire_daily_overview / acquire_performance_report 不变(akshare)
    # acquire_historical_data_tdx(ticker) 失败 → acquire_historical_data(ticker) 兜底
```
- 换手率：`float_shares` 取 finance_capital 的流通股本（vendor `download_finance_capital` 输出含总股本/流通股本字段——实施时核对字段名）
- 不删不改 `acquire_historical_data`（akshare 路径）

## 4. M2 指标/选股器

- **指标**：`core/llms/tools/` 新增 `get_trend_indicators(ticker) -> str`：
  - 取 ZODB 中该股票日K（最近 ~120 根）→ 转成 tdx_quant `compute_all` 所需输入（datetime/open/high/low/close/vol/amount 列）→ `compute_all(df, timeframe="daily", shares=float_shares)` → 最近一行指标格式化为文本（MA5/10/20/60、MACD DIF/DEA/柱、RSI、KDJ、BOLL 上下轨、ATR、量比、换手率）
  - 返回中文文本供 agent 阅读；失败返回占位文本（不 raise，图可继续）
- **选股器**：不新增运行时路径。vendor 自带 `screen()` + 冒烟测试验证其可用性；README 记录离线用法（`python -m scripts.data_pipeline.screener.run_screener --codes ... --conditions ...`，经 vendor sys.path）
- 指标输入构造：ZODB 的 ChinaStockData 列序 → 重命名映射（date→datetime 等），放 `data_source/chinese_mainland/tdx/mapping.py` 或 enrichment 模块（实施时定）

## 5. M3 TDX MCP

- vendor `scripts/tdx_mcp/tdx_client.py` → `TdxMcpClient(api_key=env TDX_API_KEY)`，仅依赖 httpx ✓
- 新工具 `core/llms/tools/get_market_intel.py`：
  ```python
  def get_market_intel(ticker: str) -> str:
      # TDX_API_KEY 缺失 → 返回 "（未配置 TDX_API_KEY，跳过实时市场情报）"（不 raise）
      # query(f"{ticker} 实时行情 资金流向 所属概念板块", size=50) → to_dicts() → 中文摘要文本
  ```
- 接入：`core/investment_committee.py` 的 `make_investment_decision`——构建初始 state 时追加：
  ```python
  stock_information += "\n【实时市场情报】\n" + get_market_intel(target_ticker)
  ```
  （import 放函数内，避免无 key 环境下的模块级副作用；不改变图结构）
- `.env.example` 加 `TDX_API_KEY=`

## 6. 测试

| 文件 | 类型 | 内容 |
|---|---|---|
| `test/data_source/test_tdx_mapping.py` | 离线 | 合成 pytdx bars → 12 列序断言、首行 NaN、换手率、qfq golden values |
| `test/data_source/test_tdx_adjust.py` | 离线 | qfq 算法：构造除权事件断言调整价 |
| `test/data_source/test_tdx_source.py` | live smoke | `fetch_daily("000001")` ≥1 根真实 bar（对标 test_akshare 风格） |
| `test/data_source/test_tdx_screener.py` | 离线冒烟 | 2 代码 + 1 条件的 screen 结构断言 |
| `test/core/test_trend_indicators.py` | 离线 | compute_all 列存在性 + 指标数值口径 |
| `test/core/test_market_intel.py` | 离线 | 无 key 降级文本；有 key 时 live（可跳过） |
| `test/core/test_data_acquisition_tdx.py` | 现有风格 | 布尔协议 + 新鲜度跳过 + TDX→akshare 回退（真实 ZODB） |

- pytest.ini 保持 `testpaths = test`；live 测试沿既有风格（test_akshare 即 live），不引入新 marker
- 既有测试全绿是回归门槛

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| TDX 服务器部分超时/空返回 | vendor `connect_first_available` 多服务器 fallback；DataAcquisition 层 akshare 兜底 |
| snapshot 通道实测 quotes 为空 | M1 不依赖 snapshot；实施时验证 fetch_realtime_watchlist，失败仅记日志 |
| qfq 与 akshare 口径偏差 | 离线 golden 测试锁偏差 < 0.5%；偏差超标时 M1 降级未复权 + warning |
| pytdx 对 3.13 的兼容（已实测 OK） | 锁定 `pytdx==1.72`；vendored 代码 import 面测试覆盖 |
| vendor 与上游分叉 | VENDOR.md 记录 commit + 差异；更新走重拷流程 |
| 换手率需流通股本字段名未知 | 实施第 1 步核对 finance_capital 输出字段，映射层参数化 |

## 8. 回滚

- 每步独立可回滚：TdxSource/mapping 是新增文件；`get_stock_data` 主路径改动一行可还原（akshare 直调）
- DataAcquisition 新增方法不删旧方法；M3 的 enrichment 是追加文本，去掉即还原
- 阶段里程碑：M1 → M2 → M3 各自完成后测试全绿再提交，任何里程碑不达标不进入下一个
