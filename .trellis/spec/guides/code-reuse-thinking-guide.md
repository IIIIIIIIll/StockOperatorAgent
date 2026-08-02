# Code Reuse Thinking Guide

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
grep -rn "list(row.values())" core data_source test
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

### Pattern 1: The Agent Class Template

The five agents in `agents/chinese_mainland/` are deliberately near-identical:
same constructor shape, same `prompt | llm` chain, same node method returning a
state-update dict. **When adding an agent, copy the closest existing one and
change the role message + node name + state key.** Do not redesign the pattern —
`core/investment_committee.py` wires them all positionally.

### Pattern 2: DataFrame → Dataclass Positional Construction

`StockOverview(*list(row.values())[1:])`-style construction appears in
`core/data_acquisition.py` and `test/data_source/test_akshare.py`. Reuse the
existing dataclasses (`StockOverview`, `ChinaStockData`, `StockPerformanceReport`,
`StockInfo`) rather than declaring new ones — see `data_structure/index.md`.

### Pattern 3: Business-Day and Date Logic

- `utils/time_helper.get_last_business_day` — the only trading-calendar helper.
  Reuse it; do not reimplement weekend handling (agents' `current_date` prompt
  partial, ZODB 17:00 freshness gate, `DataAcquisition` all use it).
- `'%Y%m%d'` report-date strings — the cross-layer format for performance
  reports. Keep it; do not introduce a second date format on that boundary.

### Pattern 4: Repeated Constants

`utils/constants.py` is the single source of truth for `default_start` and
`china_db_path`. Import from there (`from utils.constants import default_start`)
exactly as `ChinaStock.py` and `ZODBStorage.py` do — never re-define the values
or the path literal.

### Pattern 5: Logging Calls

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
- [ ] New agent follows the five-agent template
- [ ] Constants defined in `utils/constants.py`, dates keep the `'%Y%m%d'` format
