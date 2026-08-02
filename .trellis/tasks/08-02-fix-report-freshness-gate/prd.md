# 业绩报告 freshness 门（ZODB 优先，避免重复拉 F10）

## Goal

`acquire_performance_report_tdx` 加 freshness 门：**先查本地 ZODB** 最新
`report_date`，与 F10 最新报告期一致 → 跳过远端拉取；不一致才拉。
对齐日K 的"先查再拉"模式（查 = 本地 ZODB 零网络；拉 = 才出网）。

## 现状与根因

- 业绩数据存在 ZODB（`performance_reports`，读侧正常），但写入侧无
  freshness 门：每次 `get_stock_data` 都无条件 `build_reports(ticker)`
  拉 F10，靠 `add_performance_report` 的 report_date 去重只入库新的。
- 历史日K 是"查 `last_data_update` 新鲜 → 跳过/增量"，业绩是唯一
  "跳过查直接拉"的环节。

## 修复要求

1. **门的位置**：`core/data_acquisition.py` 的 `acquire_performance_report_tdx`
   在 `build_reports`（远端 F10）前，先读 ZODB 里该股票最新
   `report_date`（`stock.performance_reports[-1].report_date`，无报告则为
   None）。
2. **判定**：拉取前无法得知 F10 最新报告期——判定方案二选一（实现者
   选可行者并记录理由）：
   a) **先拉最新期再判**：`build_reports` 返回后比对"最新 report_date 是否
      已入库"——**这不是真正的门**（仍每次拉），仅省去入库循环；不符合
      本任务目标，不采用。
   b) **基于时间预期**（推荐）：报告期是季度低频——若 ZODB 最新
      `report_date` 已是**最近一个已到报告截止日的报告期**（如今天
      2026-08-02 → 最近截止日为 2026-06-30，其 '20260630' 已入库 → 跳过），
      则跳过拉取；否则拉取。日历逻辑复用 `get_next_report_date` 同类
      季度末推算（0331/0630/0930/1231），注意 8 月末才披露完中报的
      现实：**门只承诺"该季截止日已过且已入库则不重复拉"**，若公司尚未
      披露当期报告（F10 最新期仍为上一季），拉取一次后发现无新期也不
      算错误（下次同季仍会拉——直到披露）。
   - 或者 c) **简化版**：只在"已入库最新 report_date 的季度截止日 ==
     当前最近的已到截止日"时跳过，否则拉（= b 的表述）。
3. **布尔协议与降级**：门跳过 → `logger.debug` + `True`（不拉不报错）；
   拉取失败/无报告语义不变（warning + True）；storage 无股票 → False。
4. **日K 对齐**：门只在"有报告且最新期=最近季度"时跳过，**不引入
   跨季补拉逻辑**（缺口补拉不属于本任务——`build_reports` 全量返回、
   `add_performance_report` 去重已保证完整性）。
5. **测试**：
   - 离线/合成：门命中（最新 report_date == 最近季度截止日）→
     `build_reports` 不被调用（打点或 mock 计数——house style 无 mock，
     可用"注入已入库报告 + 断言不触发网络"的 live 语义或子进程打点）；
   - 门未命中（无报告 / 最新期早于最近季度）→ 正常拉取且入库去重；
   - 现有 `test_acquire_performance_report_tdx` 语义保持（F10 可达 →
     有报告）。

## Acceptance Criteria

- [ ] `acquire_performance_report_tdx` 在"最新报告期已入库"时跳过远端
      F10（可验证：连续两次调用第二次无 F10 网络访问）
- [ ] 未命中门时行为与现状一致（拉取、去重、布尔协议）
- [ ] 定向测试全绿；全量 pytest **0 failed**（基线 112P/20S 保持，
      只增不减）
- [ ] core spec 同步（DataAcquisition 段的业绩链路描述）

## Constraints

- deprecated 测试零改动；akshare 备用路径（`acquire_performance_report`）
  不动（它的全市场扫描语义本来就没有单股门）
- 不引入 mock 框架；不改变 `build_reports` / `add_performance_report`
  契约
- 日历推算复用既有模式（`get_next_report_date` 的季度末思路），
  不重复实现
