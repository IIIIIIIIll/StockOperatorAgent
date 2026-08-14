# Thinking Guides

> **历史归档（2026-08-14）**：本目录指引写于 Python（Streamlit + LangGraph +
> akshare + ZODB）时代；Python 业务代码已删除，内容保留作历史，不逐行改写。
> 当前唯一实现为 **TS**（Expo web/RN + Node server，见
> [ts/index.md](../ts/index.md)）。**UI 验证指引**已更新：`cd ts && npx vitest run`
> + `npx tsc --noEmit`（测试/类型门），不再有 pytest/mock 链路。下方
> pytest/display.py/akshare/ZODB 示例仅作设计溯源参考。

> **Purpose**: Expand your thinking to catch things you might not have considered.

---

## Why Thinking Guides?

**Most bugs and tech debt come from "didn't think of that"**, not from lack of skill:

- Didn't think about what happens at layer boundaries → cross-layer bugs
- Didn't think about code patterns repeating → duplicated code everywhere
- Didn't think about edge cases → runtime errors
- Didn't think about future maintainers → unreadable code

These guides help you **ask the right questions before coding**.

---

## Available Guides

| Guide | Purpose | When to Use |
|-------|---------|-------------|
| [Code Reuse Thinking Guide](./code-reuse-thinking-guide.md) | Identify patterns and reduce duplication | When you notice repeated patterns |
| [Cross-Layer Thinking Guide](./cross-layer-thinking-guide.md) | Think through data flow across layers | Features spanning multiple layers |

---

## Quick Reference: Thinking Triggers

### When to Think About Cross-Layer Issues

- [ ] Your change spans 2+ of: akshare → dataclass → ZODB → agent state → UI
- [ ] You touch a DataFrame→dataclass construction site (`from_row(row, column_map=...)`)
- [ ] You change a dataclass field order or a `'%Y%m%d'` report-date format
- [ ] You add a key to the LangGraph `State` (`utils/state.py`)
- [ ] You change the agent constructor signature or the committee graph wiring
- [ ] You write data without a `transaction.commit()` next to it

→ Read [Cross-Layer Thinking Guide](./cross-layer-thinking-guide.md)

### When to Think About Code Reuse

- [ ] You're writing similar code to something that exists (agent template,
      positional construction, business-day logic)
- [ ] You see the same pattern repeated 3+ times
- [ ] You're adding a new field to multiple places
- [ ] **You're modifying any constant or config** (`utils/constants.py`)
- [ ] **You're creating a new utility/helper function** ← Search first!
- [ ] You're about to import `akshare` or `ZODB` outside their layers
- [ ] You're declaring a new dataclass for data that already has one

→ Read [Code Reuse Thinking Guide](./code-reuse-thinking-guide.md)

### When Verifying UI Changes

- [ ] UI 改动涉及渲染/交互（display.py、charts、data_markdown、主题）→
      先跑 `pytest test/e2e/ -v`（mock 模式秒级、零 token 验收），
      再决定是否走完整链路（TDX 抓取 + 5 代理 DeepSeek，分钟级烧 token）
- [ ] 改动 display.py 的契约（`REPORT_TABS`、观点 expander、数据 Tab、
      模块全局 committee/build_stock_information）→ 同步检查
      `test/e2e/` 用例是否仍覆盖，mock 层是否需要跟着改
- [ ] mock_app 模式下断言失败 ≠ 生产缺陷 → 先核对 mock 层（FakeGraph
      内容、seed fixture）与浏览器 DOM 实测差异（1.61.1：svg 非 canvas、
      `[role="tab"]` 选择器、tab 渐进渲染）

### When Verifying AI Cross-Review Results

- [ ] Reviewer claims "user input can be malicious" → Check the actual data source (internal manifest? user config? external API?)
- [ ] Reviewer flags "missing validation" → Is the data from a trusted internal source?
- [ ] Reviewer says "behavior change" → Read the code comments — is it intentional design?
- [ ] Reviewer identifies a "bug" in test → Mentally delete the feature being tested — does the test still pass? If yes → tautological test

**Common AI reviewer false-positive patterns**:
1. **Trust boundary confusion**: Treating internal data (bundled JSON manifests) as untrusted external input
2. **Ignoring design comments**: Flagging intentional behavior documented in code comments as bugs
3. **Variable misreading**: Not tracing a variable to its actual definition (e.g., Map keyed by path vs name)

**Verification rule**: Every CRITICAL/WARNING finding must be verified against the actual code before prioritizing. Budget ~35% false-positive rate for AI reviews.

---

## Pre-Modification Rule (CRITICAL)

> **Before changing ANY value, ALWAYS search first!**

```bash
# Search for the value you're about to change
grep -r "value_to_change" .
```

This single habit prevents most "forgot to update X" bugs.

---

## How to Use This Directory

1. **Before coding**: Skim the relevant thinking guide
2. **During coding**: If something feels repetitive or complex, check the guides
3. **After bugs**: Add new insights to the relevant guide (learn from mistakes)

---

## Contributing

Found a new "didn't think of that" moment? Add it to the relevant guide.

---

**Core Principle**: 30 minutes of thinking saves 3 hours of debugging.
