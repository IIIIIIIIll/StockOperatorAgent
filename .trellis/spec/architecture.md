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
       └─ 5 agents (agents/chinese_mainland/)  — one node each, linear chain
            └─ DeepSeekApi (core/llms/deepseek/deepseek_api.py) — 默认；QwenApi 可选
                 └─ tool: get_stock_info (core/llms/tools/get_company_info.py)
                      └─ DataAcquisition (core/data_acquisition.py)
                           ├─ TdxSource (data_source/chinese_mainland/tdx/) — 主链路：
                           │    历史行情 + 个股概览 (overview.py) + 业绩报告 (reports.py)
                           ├─ AKShareSource (…/akshare/fetch_stcok_data.py) — 备用路径，
                           │    主流程不再调用（原方法保留）
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
  all five agents read `state['target_stock_ticker']` and `state['stock_information']`.
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
  保留为 Qwen 可选项。loaded with `load_dotenv()` in `main.py`,
  `investment_committee.py`, and LLM tests.
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
- `utils/state.py` — the LangGraph `State` TypedDict (documented in `agents/index.md`).
- `utils/constants.py` — see above.

## Known Quirks (do not "fix" without a task)

- Data-source module is `data_source/chinese_mainland/akshare/fetch_stcok_data.py`
  (typo "stcok"). Renaming breaks imports — keep the name.
- `core/stock_output_formatter.py:1` imports `output` from `openpyxl.styles.builtins`
  and then shadows it with a local `output` variable. Dead import; leave it.
- Some agent query templates contain a literal `${state[...]}` (e.g.
  `agents/chinese_mainland/bullish_trader.py:32`) — a copy-paste artifact that
  renders literally into the prompt. Harmless; do not spread it to new code.
- `bullish_opinions` / `bearish_opinions` are typed `Annotated[list, add_messages]`
  in `State` but agents return plain strings; the reducer wraps them into message
  lists, which is why `display.py` reads `[-1].content`.
- The LangGraph checkpointer is `InMemorySaver` with `thread_id "1"` — state does
  not survive process restarts.

## Anti-Patterns

- Adding a second business-day implementation in another module — use
  `get_last_business_day`.
- Hardcoding `database/china_stock_data.fs` paths elsewhere — use
  `utils.constants.china_db_path`.
- Replacing loguru with stdlib `logging` in new modules — see [logging.md](./logging.md).
