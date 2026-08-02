# Implement: 并行化独立 LLM 对（review #4）

## 执行顺序

### Step 1 — 离线图形状测试先行（TDD）

- 新文件 `test/integration/test_graph_parallel.py`：
  - `FakeListChatModel(responses=[...])` 5 节点（langchain_core 内置；
    若 5 个响应不够则用 `responses` 循环配置）。
  - 用例：join 生效（bullish 查询含两份报告子串）、manager 完整输入、
    messages 10 条、宽松墙钟断言（可选，不稳则撤）。
  - 用 999998 类 dummy 种子（不触真库数据；get_stock_info 不参与——直接
    种子 state，不走 build_stock_information）。

**验证**：新用例绿（在**串行图**上预期 join 断言失败——证明测试有效）。

### Step 2 — 图装配改并行

- `core/investment_committee.py:61-66`：8 行串行边 → 8 行并行边（design
  §2）。无其他改动。

**验证**：Step 1 用例全绿；`python3 -m pytest test/integration/ -q`
（skip 的两个文件维持 skip）。

### Step 3 — 回归 + spec + review 文档

- `python3 -m pytest test/core/ui/test_display.py test/integration -q`
- 全量 `python3 -m pytest -q` → 0F（基线 119P/20S；需停 Streamlit）
- agents/index.md 图装配段更新（并行结构 + 隐式 join 语义）
- docs/process-flow-review-2026-08-02.md #4 checkbox 勾选

## 评审门

- Step 2 完成后 review gate：展示 join 测试在串行→并行下的红绿转换 +
  全量回归结果，然后 commit + finish。

## 回滚点

- 图装配是唯一改动面——revert 8 行边即回滚。

## 验证命令速查

```bash
python3 -m pytest test/integration/test_graph_parallel.py -q
python3 -m pytest test/integration test/core/ui -q
python3 -m pytest -q   # 全量（需停 Streamlit）
```
