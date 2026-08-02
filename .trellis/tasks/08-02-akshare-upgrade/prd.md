# 升级 akshare 到最新版

## Goal

akshare 1.18.25 → 1.18.81（落后 56 个版本），仅升级与回归，不涉及流程重构
（流程梳理单独开任务）。

## 研究结论（2026-08-02，源码级对比 1.18.25 vs 1.18.81）

- `stock_zh_a_hist`：列序两版**完全一致**
  （日期, 开盘, 收盘, 最高, 最低, 成交量, 成交额, 振幅, 涨跌幅, 涨跌额,
  换手率, 股票代码 —— 股票代码在**末尾**）
- `stock_*_a_spot_em`：列序两版**完全一致**（序号, _, 最新价, …, 代码, _, 名称, …）
- `stock_yjbb_em`：列序两版**完全一致**（diff 为空）
- `stock_individual_info_em`：item/value 两版一致
- → **升级不引入任何列序/接口变更**

## 既有疑点（记录，移交流程梳理任务，不在本任务修）

- 位置映射假设与 akshare 源码列定义不匹配：
  - `ChinaStockData(*list(row.values()))` 期望第 2 列为 ticker，但 hist 输出
    "股票代码"在**末尾**（第 12 位）
  - `StockOverview(*list(row.values())[1:])` 期望第 2 列为 ticker，但 spot 输出
    第 2 列是 "_" 占位
- 无法在本环境实测（东方财富端点被网络拒绝）；用户环境若映射错位会有数据
  错乱表现。**待流程梳理任务在可通网络下实测 akshare 实际输出列序后统一修复。**

## Requirements

- `requirements.txt`：`akshare==1.18.25` → `akshare==1.18.81`
- 本环境安装新版并验证 import 与离线行为
- 检查新版依赖是否引入与现有 pinned 包冲突（curl_cffi、akracer 等）
- 全量 pytest 回归：无新增失败（基线 29F/32P，失败均为环境性）
- 若 akshare 新版对 Python 3.13 或 numpy 2.4 有兼容问题，记录并评估回退

## Acceptance Criteria

- [ ] `pip show akshare` 版本 = 1.18.81
- [ ] `import akshare` 成功；`ak.stock_zh_a_hist` / `ak.stock_*_a_spot_em` /
      `ak.stock_yjbb_em` / `ak.stock_individual_info_em` 可被解析（签名存在）
- [ ] 全量 `pytest` 无新增失败（32 过基线保持，29 环境性失败集合不变）
- [ ] requirements.txt 已更新；无新增冲突依赖
- [ ] 结论与疑点记录到 spec（data_source/index.md 注记 + 任务 journal）

## Constraints

- 不改产品代码（升级是纯依赖变更；适配映射属流程梳理任务）
- 本环境网络限制：不做 live akshare 验证，以源码对比 + 离线回归为准
- 升级失败/依赖冲突时回退到 1.18.25（requirements 已 pin，一键回退）
