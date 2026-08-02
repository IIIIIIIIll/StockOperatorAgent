# chore: 小修集合（review #8-#11）

## Goal

review #8-#11 四项小修（#7 #12 用户决定不做，见 parent PRD）：

- **#8 文档/规范漂移**：`acquire_historical_data_tdx` docstring（"失败返回
  False 走兜底…调用方回退 akshare"）与 `.trellis/spec/.../error-handling.md`
  声称调用方回退 akshare——实际 `get_stock_data` 忽略布尔结果、无回退
  （PRD：纯 TDX 不兜底）。改措辞对齐现实。
- **#9 数据阶段进度反馈**：`build_stock_information`（display.py:52）是单块
  阻塞调用（首建分钟级）无任何进度更新。三个工具调用间插
  `updatable_container.info(...)`。
- **#10 deprecated akshare 移出主流程文件**：`core/data_acquisition.py`
  414 行中 ~200 行是 7 个 deprecated 方法（备用路径）。移 `legacy/`
  模块（如 `core/data_acquisition_legacy.py` 或 `core/legacy/`），主流程
  文件减半。**标记为可选**（风险：既有测试 `da.update_*` 引用——被 skip
  的测试不执行，但模块级引用需核对；若迁移面扩大则降级为"保留现状 +
  注释"）。
- **#11 API 路径 BJ 报错更清晰**：UI 路径 BJ 有明确提示；`get_stock_info`
  对 BJ 股票给通用 `Exception('Stock not found')`——改明确中文信息。

## Requirements

- R1（#8）：只改 docstring/spec 措辞，不改行为（回退确实不存在）。
- R2（#9）：display.py 三工具调用之间 `updatable_container.info`（与既有
  中文提示风格一致）；不改 `build_stock_information` 签名。
- R3（#10）：**可选**。若 `get_stock_data` 主链路（#2+#3 后）不再引用
  deprecated 方法，迁移成本低；若引用面扩大（测试/文档），保留现状并在
  spec 记录"备用路径常驻"决策。
- R4（#11）：`core/llms/tools/get_company_info.py` 对
  `is_bj_ticker(ticker)` 提前给出明确错误（中文信息 + 指引），仍走
  `raise Exception` 边界（唯一 raise 点约定不变）。

## Acceptance Criteria

- [x] #8：grep 无"回退 akshare"残留（docstring + error-handling spec 措辞
      与纯 TDX 现实一致："PRD 纯 TDX 无 akshare 兜底"）
- [x] #9：`build_stock_information(ticker, progress=None)` 三工具间回调；
      display 传 `updatable_container.info`（数据阶段 3 条分步进度）；
      缺省 None 路径（make_investment_decision）不受影响
- [x] #10：9 个 deprecated 方法 + YJBB_COLUMN_MAP 迁出至
      `core/legacy_akshare.py`（LegacyAksharePaths mixin）——`da.*` 调用与
      被 skip 测试引用不变；主流程文件 414 → 减半；`test_module_import_lazy_akshare`
      语义保持（legacy 模块同样惰性导入）；test_data_correctness_fixes 的
      YJBB 引用改指向 legacy
- [x] #11：`get_stock_info("430047")` 抛错含"北交所"与指引（离线用例
      test_bj_code_raises_clear_message；检查在打开 ZODB 之前）
- [x] 全量回归 0 新增失败（基线 0F/148P/20S，+1 新用例 → 0F/149P/20S）
- [x] review 文档 #8 #9 #10 #11 checkbox 勾选；core spec akshare 方法段
      更新为"迁出至 legacy_akshare.py"

## Notes

- Lightweight task，PRD-only（#10 若实施为中量重构，单独加 implement.md）。
- #8/#9/#11 互相独立可分开 commit；#10 单独 commit。
