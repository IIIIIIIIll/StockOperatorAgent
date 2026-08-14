# Code Reuse Thinking Guide

> **历史归档（2026-08-14）**：本指引写于 Python（Streamlit + LangGraph + akshare
> + ZODB）时代；Python 业务代码已删除，内容保留作历史，不逐行改写。当前唯一
> 实现为 **TS**（Expo web/RN + Node server，见 [ts/index.md](../ts/index.md)）；
> UI 验证用 `npx vitest run` + `npx tsc --noEmit`。下方
> pytest/display.py/akshare/ZODB 示例仅作设计溯源参考。

> **Purpose**: Stop and think before creating new code - does it already exist?

---

## The Problem

**Duplicated code is the #1 source of inconsistency bugs.**

When you copy-paste or rewrite existing logic:
- Bug fixes don't propagate
- Behavior diverges over time
- Codebase becomes harder to understand

---

## Before Writing New Code

### Step 1: Search First

```bash
# Search for similar function names
grep -rn "get_last_business_day" core agents data_storage utils

# Search for similar logic
grep -rn "from_row" core data_source data_structure
```

### Step 2: Ask These Questions

| Question | If Yes... |
|----------|-----------|
| Does a similar function exist? | Use or extend it |
| Is this pattern used elsewhere? | Follow the existing pattern |
| Could this be a shared utility? | Create it in the right place |
| Am I copying code from another file? | **STOP** - extract to shared or reuse the template |

---

## Real Reuse Patterns In This Codebase

### Pattern 1: The Agent Base Class

All seven agents in `agents/chinese_mainland/` inherit **`AgentNode`
(`agents/base.py`)**——模板公共管道（prompt 壳 + partials、bind_tools
NotImplementedError 回退、节点骨架 complete_expert / complete_with_tools、
info_section、build_chain）收敛在基类。**When adding an agent, subclass
`AgentNode`**（构造 super() 传 `role_message`）and keep in the agent file
only: role prompt constant, the query f-string（逐字节不变——
`test_query_baselines.py` 钉死）, role-specific logic. Do not copy the
template again — `core/investment_committee.py` wires agents via
`core/role_registry.py` factories positionally.

### Pattern 2: 亿信工具工厂骨架（capped_call）与条目收集（collect_content_items）

- `core/llms/tools/_capped.py` 的 `capped_call(counter, max_calls, cap_text,
  fail_fmt, warn_msg, fn)` — 亿信三工具（billions_search/billions_twitter/
  billions_fetch）调用体骨架单点：上限判定 → 计数 → try/except 降级占位
  （不 raise）。新亿信工具工厂复用；占位文本以格式串直传（逐字保留，
  `test_billions_tools.py` 钉死）。
- `core/llms/tools/_items.py` 的 `collect_content_items(data)` — 响应
  `result[].content[]` 条目 walk（非 dict 跳过、字段缺失容错），
  billions_search / billions_twitter / 信息面分析师三处共用。新消费方
  直接导入，不再复制。
- `web_search._summarize_results` **不并入**（键契约不同：title/link/
  snippet，非 result[].content[] 形态——只有形式相似，语义不同不硬并）。

### Pattern 3: DataFrame → Dataclass Named Row Construction

Rows become dataclasses via `from_row(row, column_map=...)` classmethods:
`StockOverview.from_row(row, column_map=OVERVIEW_COLUMN_MAP)`,
`ChinaStockData.from_row(row, column_map=AKSHARE_HIST_COLUMN_MAP)`,
`StockPerformanceReport.from_row(row)` (identity — columns are field names).
Column **names** carry the contract: missing column → `KeyError`, extra columns
ignored. Reuse the existing dataclasses rather than declaring new ones — see
`data_structure/index.md` and the mapping section of `data_source/index.md`.
Positional `*list(row.values())` / dict `**row` construction is gone from
production (08-09-named-row-constructors) — do not reintroduce it.

### Pattern 4: Business-Day and Date Logic

- `utils/time_helper.get_last_business_day` — the only trading-calendar helper.
  Reuse it; do not reimplement weekend handling (agents' `current_date` prompt
  partial, ZODB 17:00 freshness gate, `DataAcquisition` all use it).
- `'%Y%m%d'` report-date strings — the cross-layer format for performance
  reports. Keep it; do not introduce a second date format on that boundary.

### Pattern 5: Repeated Constants

`utils/constants.py` is the single source of truth for `default_start` and
`china_db_path`. Import from there (`from utils.constants import default_start`)
exactly as `ChinaStock.py` and `ZODBStorage.py` do — never re-define the values
or the path literal.

### Pattern 6: Logging Calls

Every module logs with `logger.debug/info/error("{}", args)` from loguru.
Copy the call style, not the message content — see `logging.md`.

---

## When to Abstract

**Abstract when**:
- Same code appears 3+ times (the agent template already proves it works)
- Logic is complex enough to have bugs (report-date walk in `DataAcquisition`)
- Multiple layers need the same helper (`time_helper`, `constants`)

**Don't abstract when**:
- Only used once
- Trivial one-liner
- Abstraction would be more complex than duplication

---

## Gotcha: Python if/elif/else Has No Exhaustive Check

**Problem**: Python if/elif/else chains have no compile-time exhaustive check.
When a new value enters the domain (new exchange, new report marker, new ticker
class), existing chains silently fall through to `else`.

**Real example**: `DataAcquisition.acquire_performance_report` picks the latest
possible report marker by month via if/elif on `datetime.today().month` —
a new branch must be added explicitly when the reporting calendar changes.

**Prevention**: When extending any month/period/exchange conditional, search for
ALL chains that switch on the same value and add explicit branches. Don't rely
on `else` being correct for new values.

---

## Checklist Before Commit

- [ ] Searched for existing similar code (`grep -rn` first)
- [ ] No copy-pasted logic that should be shared (`time_helper`, `constants`)
- [ ] No second implementation of akshare/ZODB access outside its layer
- [ ] No re-declared dataclasses that already exist in `data_structure/`
- [ ] New agent subclasses `AgentNode`（agents/base.py）——不复制模板
- [ ] Constants defined in `utils/constants.py`, dates keep the `'%Y%m%d'` format
