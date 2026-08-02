# Process Flow Review — 2026-08-02

End-to-end review of the StockOperatorAgent runtime pipeline: UI → data acquisition
(TDX/ZODB) → LangGraph agent chain → output. The goal is to record improvement
opportunities found by reading the full flow, so each can be picked up as its own
task. No code was changed.

Status legend: `[ ]` open, `[x]` done, `[~]` intentional (user decision — will not implement).

---

## Flow map (as it runs today)

```
UI submit (core/ui/display.py)
 └─ build_stock_information (core/investment_committee.py:18)
 │   └─ get_stock_info → get_stock_data (core/data_acquisition.py:402)
 │       └─ ensure_stock → build_overview (data_source/.../tdx/overview.py)
 │       │    fetches: snapshot, daily(250), finance_capital, company_finance, name index
 │       └─ acquire_historical_data_tdx: finance_capital, daily, xdxr → qfq → per-bar commit
 │       └─ acquire_performance_report_tdx: company_finance (F10) → per-report commit
 │   └─ get_trend_indicators (ZODB → vendored compute_all)
 │   └─ get_market_intel (TDX MCP, optional; placeholder without TDX_API_KEY)
 └─ graph.stream: fundamental → trend → bullish → bearish → manager   [5 serial LLM calls]
 └─ get_state_history[0] → five tabs
```

## Findings summary

| # | Finding | Severity | Where |
|---|---------|----------|-------|
| 1 | Overview never refreshed after first build → stale prices fed to LLM | High (correctness) | `core/data_acquisition.py:318`, `data_structure/.../ChinaStock.py:25` |
| 2 | Duplicate network fetches: daily ×2, finance_capital ×2, F10 ×2 per analysis | High (latency) | `data_source/.../tdx/overview.py:240-245`, `core/data_acquisition.py:161-187,359-400` |
| 3 | Commit-per-row ZODB writes; first build = thousands of transactions | High (latency, disk) | `data_structure/.../ChinaStock.py:30,51`, `core/data_acquisition.py:185-187` |
| 4 | 5 strictly serial LLM calls, but 2 pairs are independent | Medium-High (UX) | `core/investment_committee.py:61-66` |
| 5 | ZODB singleton connection not thread-safe; Streamlit sessions run in threads | Medium (robustness) | `data_storage/.../ZODBStorage.py:75-99` |
| 6 | No retry on transient LLM API errors; one 429 kills the whole chain | Medium (reliability) | `agents/chinese_mainland/*.py` node methods |
| 7 | No end-to-end result caching — same ticker same day re-pays 5 LLM calls | Medium (cost) | `core/investment_committee.py:44`, `core/ui/display.py:61` |
| 8 | Doc/spec drift: "caller falls back to akshare" — no fallback exists | Low-Med | `core/data_acquisition.py:130-139`, `.trellis/spec/.../error-handling.md` |
| 9 | Data phase has zero progress feedback (can take minutes on first build) | Low (UX) | `core/ui/display.py:39-59` |
| 10 | Legacy akshare ≈ 200 of 414 lines in `core/data_acquisition.py` | Low (maintainability) | `core/data_acquisition.py:40-308` |
| 11 | BJ ticker via `make_investment_decision` → confusing generic "Stock not found" | Low | `core/data_acquisition.py:322-327` (ensure_stock), `core/llms/tools/get_company_info.py` |
| 12 | Agent debug logs dump full queries/responses (multi-KB lines) | Low | all 5 agents |

---

## 1. Stale overview — biggest correctness gap

`ensure_stock` returns `True` for any stock already in ZODB and never rebuilds the
overview (`core/data_acquisition.py:318-319`). `overview_last_update` is written
(`ChinaStock.py:20,29`) but **never read** (grep-confirmed write-only dead state).
Consequence:

- Day 1: overview built from live snapshot → `latest_price`, PE/PB, momentum,
  60d/YTD fresh.
- Day N: daily bars refresh (freshness gates), but the formatter
  (`core/stock_output_formatter.py:14-21`) still feeds the LLM the day-1
  `Latest price` with stale PE/PB while bars are current → **mixed-epoch context**.

The "不每日刷新概览" design avoided 4 fetches per analysis. Cheaper compromise:
refresh when `overview_last_update` is older than the last business day (17:00-gate
style, like `check_need_update_overview`), or at minimum rebase price-derived
fields from the freshly fetched daily bar. One conditional fetch per stock per day.

**Status:** [x] **Effort:** small — implemented 2026-08-02 in task `08-02-stale-overview-gate` (date-based gate: refresh when `overview_last_update.date() < get_last_business_day(asia_today())`, best-effort rebuild via `update_overview`, test injection point `_build_overview`)

## 2. Duplicate network fetches per analysis

On first build of a stock, `get_stock_data` (`core/data_acquisition.py:410-414`)
pulls the same sources twice each:

- `build_overview` fetches `daily(max_bars=250)`, `finance_capital`,
  `company_finance` (`overview.py:240-245`)
- `acquire_historical_data_tdx` then fetches `finance_capital` again (`:163-169`)
  and `daily` again — full history on first build (`:171-175`)
- `build_reports` then fetches `company_finance` a second time (`reports.py:162`)

Parquet cache is write-only (documented "缓存真相"), so each is a real pytdx
round trip — ~5 redundant fetches of the heaviest endpoints per first build.

**Fix:** restructure `get_stock_data` into one fetch pass — fetch each source
once and feed the same DataFrames into `compose_overview` + history append +
`compose_reports` (all three are already pure functions; only the plumbing is
missing).

**Status:** [x] **Effort:** medium — implemented 2026-08-02 in task `08-02-data-onepass-bulk-commit` (FetchScope per-call fetch dedup + coordinator pre-seed: first build 7→4 fetches, steady stale day 6→4, all-fresh 0)

## 3. Commit-per-row ZODB writes

`ChinaStock.add_data` commits per bar (`ChinaStock.py:30`) and
`add_performance_report` per report (`:51`). First build with `max_bars=None`
for a 1997-listed stock = **thousands of sequential FileStorage transactions**
(tpc cycle + OOBTree index update + transaction record per row). Likely the
dominant cost of the first-build path ("10+ min first load" in README).

**Fix:** batch API — `add_datas(list)` appends, sets `last_data_update` once,
single commit. Deviates from the spec'd "every mutator commits" rule →
requires a `.trellis/spec` amendment (data_structure + data_storage indexes).

**Status:** [x] **Effort:** medium — implemented 2026-08-02 in task `08-02-data-onepass-bulk-commit` (`add_datas` / `add_performance_reports` single-commit batch mutators; single-row versions delegate; spec amended with the batch exception)

## 4. Serial LLM chain — two independent pairs

Graph is a strict linear chain (`core/investment_committee.py:61-66`), but
`fundamental ∥ trend` depend only on `stock_information`, and
`bullish ∥ bearish` depend only on the two reports. LangGraph joins on multiple
incoming edges automatically:

```
START → fundamental ──┐      START → trend ──┐
       fundamental → bullish ← trend         bullish/bearish → manager
```

Cuts wall-clock from **5 serial calls to 3 stages** (each DeepSeek call is
10-60s). Caveat: parallel calls hit rate limits sooner.

**Status:** [x] **Effort:** small — implemented 2026-08-02 in task `08-02-parallel-llm-pairs` (two parallel pairs + implicit join; wall-clock 5 serial → 3 stages, verified by a timing test: 6.8s vs ≥10s serial; `_llm` injection point for offline graph tests)

## 5. Thread-safety assumption is not guaranteed

`get_zodb_storage` is a process singleton (required — FileStorage flock is not
re-entrant), but the connection is **not thread-safe**. The spec's justification
("UI 层串行渲染即满足") is wrong for Streamlit: each browser session runs
`write_ui` in its own thread, so two sessions can read/commit concurrently on one
connection (`POSKeyError`/`ConflictError` risk). Double-clicking submit spawns
two concurrent runs of the same graph.

**Fix:** widen the existing construction lock (`ZODBStorage.py:75-99`) into a
read/commit lock around ZODB access in `DataAcquisition` / `ZODBStorage`.

**Status:** [x] **Effort:** small — implemented 2026-08-02 in task `08-02-zodb-lock-llm-retry` (`RLock` on the singleton connection held around data-phase ops only, never across LLM calls; 2 concurrency tests incl. a serialization timing assertion)

## 6. No retry on LLM errors

Agent nodes do bare `self.llm.invoke(...)`; a 429 or timeout at node 3 aborts the
entire run, and the user re-pays all 5 calls (plus data work) on re-submit.

**Fix:** small retry-with-backoff wrapper (2-3 attempts on
429/5xx/connection errors) around the invoke.

**Status:** [x] **Effort:** small — implemented 2026-08-02 in task `08-02-zodb-lock-llm-retry` (`core/llms/retry.py`: tenacity backoff on 429/5xx/connection/timeout ×3, business errors pass through; one-line change per agent node, 6 injection tests)

## 7. No end-to-end result caching

`InMemorySaver` is fresh per call, `thread_id` always `"1"` — nothing survives.
Same ticker, same day → full 5-call re-analysis.

**Fix:** per-`(ticker, date)` result cache (file or ZODB, same keying style as
the data caches). Note: analysis output should be day-stamped anyway given
finding #1.

**Status:** [~] **Effort:** medium — **intentional, not implementing** (user decision 2026-08-02: the LLM re-run per submission is the intended product behavior; no per-day result cache)

## 8. Doc/spec drift — akshare fallback no longer exists

`acquire_historical_data_tdx`'s docstring ("失败返回 False 走兜底…调用方回退
akshare") and `.trellis/spec/.../error-handling.md` both claim the caller falls
back to akshare. Reality: `get_stock_data:412` ignores the return value and
there is no fallback (PRD: 纯 TDX 不兜底).

**Fix:** update docstring + spec to match reality, or decide the fallback question.

**Status:** [x] **Effort:** trivial — implemented 2026-08-02 in task `08-02-small-fixes-polish` (docstring + error-handling spec now state "PRD 纯 TDX 无 akshare 兜底"; grep-clean of "回退 akshare")

## 9. Data phase has zero progress feedback

`build_stock_information` is one blocking call (minutes on first build) with no
progress updates; the UI shows a single "请耐心等待" message
(`display.py:39-59`).

**Fix:** interleave `updatable_container.info()` between the three tool calls
(data / indicators / market intel).

**Status:** [x] **Effort:** trivial — implemented 2026-08-02 in task `08-02-small-fixes-polish` (`build_stock_information(ticker, progress=None)` optional callback; display passes `updatable_container.info` — 3 step messages during the data phase)

## 10. Legacy weight in the main flow file

~200 of 414 lines of `core/data_acquisition.py` are deprecated akshare paths
(`:40-308`, 7 methods). If "备用路径" is truly legacy, move them to a
`legacy/` module to halve the main flow file.

**Status:** [x] **Effort:** small — implemented 2026-08-02 in task `08-02-small-fixes-polish` (moved to `core/legacy_akshare.py` as a `LegacyAksharePaths` mixin; `da.*` call sites and skipped-test references unchanged; main flow file halved)

## 11. BJ ticker via the API path gives a confusing error

UI path blocks BJ codes with a clear message; `make_investment_decision` (API
path) reaches `ensure_stock` → returns False → generic `Exception('Stock not
found')` from `get_company_info.py`.

**Fix:** clearer message in `get_stock_info` (or check `is_bj_ticker` at the
committee entry).

**Status:** [x] **Effort:** trivial — implemented 2026-08-02 in task `08-02-small-fixes-polish` (BJ check in `get_stock_info` before opening ZODB, raises the same clear Chinese message the UI shows; offline test asserts it)

## 12. Agent debug logs dump full prompts

All 5 agents `logger.debug` the full query+response, including the whole
60-bar / 20-report blob — multi-KB log lines per run.

**Fix:** truncate to a few hundred chars, or log only the first/last lines.

**Status:** [~] **Effort:** trivial — **intentional, not implementing** (user decision 2026-08-02: full prompt/response logging is desired for LangSmith debugging parity)

---

## Suggested order of work

1. **#1 stale overview gate** — correctness first, small diff, needs a test
2. **#2 + #3 one-pass fetch + bulk commits** — data path redesign (biggest
   latency win, medium diff, spec amendment for the commit rule)
3. **#4 parallel LLM pairs** — pure graph-wiring change + test update
4. **#5 lock + #6 retry** — robustness
5. **#8–11** — polish (#7 result caching and #12 log truncation are intentional — see their status lines)

## Reference files

- `core/ui/display.py` — Streamlit UI, submission flow
- `core/investment_committee.py` — graph wiring, `build_stock_information`
- `core/data_acquisition.py` — data flow orchestration
- `data_source/chinese_mainland/tdx/{overview,reports,tdx_source}.py` — TDX fetch layer
- `data_storage/chinese_mainland/ZODBStorage.py` — singleton + transaction rules
- `data_structure/chinese_mainland/ChinaStock.py` — per-row commit behavior
- `.trellis/spec/` — intended architecture this review was checked against
