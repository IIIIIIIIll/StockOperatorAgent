# fix(data): 数据链路单遍拉取 + 批量提交（review #2+#3）

## Goal

消除 `get_stock_data` 主链路的重复网络拉取与逐行事务：

- **#2 单遍拉取**：daily / finance_capital / company_finance 目前每次分析
  各拉 2 次（overview 1 次 + history/reports 各 1 次）；改为每次分析调用每源
  只拉 1 次，三个消费者（overview 刷新 / 历史 / 业绩）共享同一 DataFrame。
- **#3 批量提交**：`add_data` / `add_performance_report` 逐行
  `transaction.commit()`——首建全量回填（max_bars=None，老股票数千根 bar）是
  数千个顺序 FileStorage 事务；改批量 API 单次 commit。

## Requirements

### R1（拉取去重——FetchScope）

- `DataAcquisition` 新增每调用级拉取去重：`FetchScope(src)` 持有
  `(source, ticker) -> DataFrame` 缓存，分析主链路（`get_stock_data`）创建
  一个 scope 贯穿三个消费者。
- 去重规则（daily 大小感知）：缓存 DataFrame 满足本次请求（`len(df) >=
  请求根数`，或请求 None 时缓存已是全量）→ 复用；否则按本次请求重拉并
  覆盖缓存。首建（gap>120 → 全量）请求 None 时缓存必为空 → 全量恰拉一次。
- **预播种（协调器决策）**：`get_stock_data` 计算各 freshness 门状态，预拉
  daily 一次——需要全量回填 → `max_bars=None`（同时覆盖 overview 的 250
  窗口与 history 全量）；否则任一消费者需要 → `max_bars=250`（覆盖 overview
  250 与 history ≤120 缺口）。门判定从方法内提取为共享 helper
  （`_overview_stale(stock)` / `_history_gap(stock)` / `_reports_stale(stock)`），
  协调器与消费者同一来源，不双份逻辑。
- 消费者方法（`ensure_stock` / `acquire_historical_data_tdx` /
  `acquire_performance_report_tdx`）新增可选 `_scope=None` 参数：None →
  维持现状（独立调用直拉，既有测试语义不变）；传入 → 走 scope。
- 层契约不变：scope 只做"同一 DataFrame 复用"，不改变任何返回列序/类型；
  `overview.py` / `reports.py` 的 `build_overview` / `build_reports` 增加可选
  `_scope` 透传（默认 None 直拉）。
- snapshot / xdxr 仅单一消费者使用（overview / history），为契约统一也走
  scope，无实际去重收益但零成本。

### R2（批量提交——ChinaStock 批量 mutator）

- `ChinaStock.add_datas(list[ChinaStockData]) -> int`：按 `date >`
  last_data_update 过滤后全量追加 + 前进 last_data_update + **单次 commit**，
  返回实际追加数（0 = 全部重复，不 commit）。
- `ChinaStock.add_performance_reports(list[StockPerformanceReport]) -> int`：
  按 report_date 递增去重（仅 > 最后一份者追加；输入假定 period 升序，
  compose_reports 已保证）单次 commit，返回追加数。
- 单行版本 `add_data` / `add_performance_report` 保留（既有测试引用），实现
  委托批量版本或保持独立——行为不变。
- `acquire_historical_data_tdx` / `acquire_performance_report_tdx` 主路径改用
  批量版本（先收集后一次提交）。

### R3（spec 修订）

- `data_structure/index.md`："Every mutating method ends with
  transaction.commit()" 增补批量例外：批量 mutator 整批一次 commit（每行
  commit 是 anti-pattern，首建数千事务）。
- `core/index.md`：`get_stock_data` 条目更新为单遍拉取语义（FetchScope +
  预播种）；三个消费者条目补 `_scope` 参数。
- `data_source/index.md`：无变更（thin wrapper 契约不变）。

## Acceptance Criteria

- [x] 首建路径每源恰一次网络拉取（注入计数 scope）：daily 1 / capital 1 /
      F10 1 / snapshot 1 / xdxr 1（当前为 daily 2 / capital 2 / F10 2）
      —— test_get_stock_data_first_build_fetches_each_source_once 钉死
- [x] 既有消费者独立调用（无 scope）行为不变：test_data_acquisition_tdx.py
      全绿（含 #1 的 3 个 gate 用例 + 既有 15 用例）
- [x] `add_datas` 批量语义：全追加 + last_data_update 前进 + 0 全部重复时
      不 commit；`add_performance_reports` 同款（递增去重）——
      test_ChinaStock.py 新增 7 用例钉死
- [x] 首建路径事务数从"数千"降为常数（批量 1 commit + 既有 put_stock
      commit）——实现审查 + 批量语义测试
- [x] 已有股票双 stale 各源恰一次 / 三门全 fresh 零拉取——
      test_get_stock_data_existing_stock_stale_gates_each_source_once /
      test_get_stock_data_fresh_gates_zero_fetch 钉死
- [x] 全量回归 0 新增失败（基线 0F/119P/20S，+17 新用例 → 预期 0F/136P/20S）
- [x] spec 修订落地（data_structure mutator 批量规则 + core 单遍拉取条目）
- [x] review 文档 #2 #3 checkbox 勾选

## Notes

- Complex task：design.md + implement.md 先行，评审后再 `task.py start`。
- 依赖：已归档的 08-02-stale-overview-gate（#1 的 freshness 门是本次
  预播种的判定基础，但无硬依赖——门 helper 独立提取）。
- 不做：daily 读 parquet 缓存优化（spec 待办段已存档理由，与本任务正交）；
  qfq 后数据与 overview 原始 close 的口径差异（既有行为，不在本任务）。
