---
description: Architecture overview — runtime layers, data flow, config, shared utils, known quirks
paths:
  - main.py
  - .env.example
  - utils/**
---

# Architecture

## Runtime Layers

```
Streamlit UI (core/ui/display.py)
  └─ InvestmentCommittee (core/investment_committee.py)  — LangGraph StateGraph
       └─ 6 agents (agents/chinese_mainland/)  — 8 图节点（信息面分析师条件启用，
           对抗修订为双节点）；expert/trader 带 bind_tools 工具（web_search +
           亿信三件套，开关门控）
            └─ DeepSeekApi (core/llms/deepseek/deepseek_api.py) — 默认；QwenApi 可选
                 └─ tool: get_stock_info (core/llms/tools/get_company_info.py)
                      └─ DataAcquisition (core/data_acquisition.py)
                           ├─ TdxSource (data_source/chinese_mainland/tdx/) — 主链路：
                           │    历史行情 + 个股概览 (overview.py) + 业绩报告 (reports.py)
                           ├─ AKShareSource (…/akshare/fetch_stcok_data.py) — 备用路径，
                           │    主流程不再调用（原方法保留）
                           ├─ BillionsClient (data_source/chinese_mainland/billions/) —
                           │    亿信 REST 薄包装（可选，BILLIONS_API_KEY 开关门控；
                           │    供亿信工具/前置段/信息面分析师）
                           ├─ persistent dataclasses (data_structure/chinese_mainland/)
                           └─ ZODBStorageInstance (data_storage/chinese_mainland/ZODBStorage.py)
                                └─ ZODB FileStorage file (database/china_stock_data.fs, gitignored)
```

Each directory is one layer with its own guideline (see [index.md](./index.md)).
Cross-layer rules of thumb:

- Data flows as **pandas DataFrames** out of the data source (TDX 主链路 /
  akshare 备用), becomes **persistent dataclasses** by positional construction,
  and reaches agents as a **formatted string** (`StockOutputFormatter`). Never
  skip a layer's conversion. 个股数据按需单股构建（TDX 无全市场行情扫描）；
  pytdx 无数据的字段输出 NaN 而非报错。
- LangGraph `State` keys (see `agents/index.md`) are the contract between agents;
  all agents read `state['target_stock_ticker']` and `state['stock_information']`
  （信息面分析师条件启用，`information_analysis` 缺失时读方必须 `state.get()`
  容错——trader/manager 查询插值用条件段）。
- The Streamlit `progress_updater` (a `st.empty()` container) is passed into every
  agent constructor; agents report progress via `progress_updater.info("...")`.
  UI progress text is Chinese.

## Entry Point

- Run with `streamlit run main.py` (README.md). `main.py` is minimal: it configures
  the loguru handler, calls `load_dotenv()`, then `write_ui()`.
- `main.py` 日志 handler 落位 `LOG_DIR / "stock_operator_agent.log"`（2026-08-02
  修复：原 `./logs/...` 相对路径随 CWD 漂移，日志落别处；现锚定仓库 `logs/`）。
- `core/ui/display.py` checks **only `DEEPSEEK_API_KEY`** in `os.environ` before
  rendering（2026-08-02 修复：`investment_committee.py` 永远构造 `DeepSeekApi()`，
  只配 DASHSCOPE 时旧检查放行但构造即抛 OpenAIError 崩溃）and validates the
  ticker input (6-digit numeric) before analysis.

## Configuration

- API key: `DEEPSEEK_API_KEY`（默认 LLM）+ `DEEPSEEK_MODEL`（默认
  `deepseek-v4-flash`，可切 `deepseek-v4-pro`）在 `.env`；`DASHSCOPE_API_KEY`
  保留为 Qwen 可选项；`BILLIONS_API_KEY`（亿信 Fin 开放平台，2026-08-08）为
  可选信息面能力主闸——未配置时亿信全部能力关闭、现有流程零变化。loaded
  with `load_dotenv()` in `main.py`, `investment_committee.py`, and LLM tests。
  亿信开关族（truthy 语义对齐 `WEB_SEARCH_DISABLED`）：总闸
  `BILLIONS_DISABLED` + 能力闸 `BILLIONS_{FINDB,SEARCH,TWITTER,FETCH,ANALYST}
  _DISABLED` + 工具调用上限 `BILLIONS_{SEARCH,TWITTER,FETCH}_MAX_CALLS`
  （默认 3/2/3）。开关解析集中 `utils/billions_config.py`（跨 core/agents/UI
  共用），读取点 `os.getenv` 调用时判（图装配期判工具绑定与节点接线）。
- `utils/constants.py` holds the only module-level constants:
  - `default_start = 1997-01-01` — baseline for "no data yet" timestamps
    (`ChinaStock.last_data_update`, `ZODBStorageInstance.root.overview_last_updated`)
  - `china_db_path` — the ZODB file (gitignored via `*.fs`)，**锚定仓库根**
    （2026-08-02 修复：原相对路径 `'database/china_stock_data.fs'` 在非仓库根
    CWD 下静默创建第二个空库；现为 `str(REPO_ROOT / 'database' / 'china_stock_data.fs')`，
    值语义不变、解析不再依赖 CWD）
  - `REPO_ROOT` — 仓库根 `Path`（`Path(__file__).resolve().parents[1]`），
    所有曾依赖 CWD 的路径（ZODB 库 / parquet 缓存 / 日志）的统一锚点
  - `LOG_DIR` — 仓库 `logs/`（gitignored），main.py 的 loguru handler 落位

## Shared Utils (`utils/`)

- `utils/time_helper.get_last_business_day(date)` — the only trading-calendar helper.
  Handles **weekends only**; public holidays are not modeled. Used by agents
  (`current_date` prompt partial), `DataAcquisition`, and `ZODBStorage` (17:00 gate).
- `utils/market_time.py`（2026-08-02，08-02-market-hours-util）— A 股交易
  时段判定：`is_trading_time(now=None)` 北京时间工作日 9:30–11:30 /
  13:00–15:00 判交易时段（15:00 整起判非交易时段——行情不再变化）；
  周末/节假日无日历 → 判非交易时段（保守：休市行情不变，下游"用缓存"
  正确）。`latest_trading_day(stock)` 从 ZODB 日K 末根 bar 取最近交易日
  （零网络——pytdx 无交易日历接口，akshare 完全弃用）。复用
  `get_last_business_day`，时区 Asia/Shanghai 与 time_helper 同约定。
  消费方：`get_market_intel` 缓存判定（MCP 情报）。
- `utils/state.py` — the LangGraph `State` TypedDict (documented in `agents/index.md`).
- `utils/constants.py` — see above.
- `utils/runtime_config.py`（2026-08-08，08-08-billions-switches-ui）— 通用
  运行时覆盖层：`set_runtime_overrides` / `clear_runtime_overrides` /
  `runtime_bool(key, env_fallback)` / `runtime_int`——**会话级配置**（UI 能力
  开关/亿信上限）唯一落点；覆盖 → env 兜底，默认空 = 零行为变化。消费点：
  `web_search_enabled`（WEB_SEARCH_ENABLED）、`_mcp_disabled`
  （TDX_MCP_ENABLED）、`billions_enabled`/`billions_max_calls`
  （BILLIONS_MASTER / BILLIONS_{CAP} / BILLIONS_{CAP}_MAX_CALLS）。
- `utils/env_file.py`（2026-08-08）— `.env` 原子写：
  `update_env_file(updates) -> (bool, msg)`——**只更新白名单 8 键**
  （DEEPSEEK_API_KEY/MODEL、DASHSCOPE_API_KEY、TDX_API_KEY、
  BILLIONS_API_KEY、LANGSMITH_TRACING/API_KEY/PROJECT），保留注释/顺序/
  无关键，tmp + `os.replace` 原子替换，成功后同步 os.environ（立即生效，
  无需重启）；失败返回消息不抛异常；密钥值不 log。
  `env_file_path()`：env `ENV_FILE_PATH` 覆盖（e2e 隔离用）→ 回退
  `REPO_ROOT / ".env"`。

## Known Quirks (do not "fix" without a task)

- Data-source module is `data_source/chinese_mainland/akshare/fetch_stcok_data.py`
  (typo "stcok"). Renaming breaks imports — keep the name.
- `core/stock_output_formatter.py:1` imports `output` from `openpyxl.styles.builtins`
  and then shadows it with a local `output` variable. Dead import; leave it.
- `${state[...]}` 字面残留已清理（2026-08-02 fix-dead-code-cleanup：bullish/
  bearish/investment_manager 删除 `$` 前缀；grep 无残留）——新代码保持无
  `$` 前缀的正确插值。
- `bullish_opinions` / `bearish_opinions` are typed `Annotated[list, add_messages]`
  in `State` but agents return plain strings; the reducer wraps them into message
  lists, which is why `display.py` and `investment_manager` read `[-1].content`.
- The LangGraph checkpointer is `InMemorySaver` with `thread_id "1"` — state does
  not survive process restarts.

## Anti-Patterns

- Adding a second business-day implementation in another module — use
  `get_last_business_day`.
- Hardcoding `database/china_stock_data.fs` paths elsewhere — use
  `utils.constants.china_db_path`.
- Replacing loguru with stdlib `logging` in new modules — see [logging.md](./logging.md).
