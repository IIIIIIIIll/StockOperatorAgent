# 死代码清理与 UI 加固

## Goal

修复审计中危 3 项 + 低危 8 项：enrichment 悬空、update_overview 槽位、
akshare 死代码标注、import 惰性化、prompt 插值/残留、文案错误、单例线程
锁、UI 错误提示、注解。核心原则：**删或标注，不留"看似可用"的陷阱**。

## 修复清单

### 1. `make_investment_decision` enrichment 悬空（中）

- `investment_committee.py:54` 死代码：display 直接
  `make_investment_committee` + `graph.stream`，enrichment（技术指标 +
  TDX 实时情报）从未执行——agent 只拿到 get_stock_info 文本。
- 修法：**接入 UI 流程**（推荐）——把 enrichment 逻辑从死方法抽出为
  独立函数（如 `core/stock_info_builder.py` 或 committee 模块函数），
  `display.py` 构造 `stock_information` 时调用；`make_investment_decision`
  改为调用同一函数或删除（保留 committee API 签名兼容）。
- 验收：display 流程中 stock_information 含技术指标与实时情报段；
  UI 冒烟（无 key 降级路径）正常。

### 2. `update_overview` 写错槽位 + 死方法（中）

- `ChinaStock.update_overview` 写 `self.info` 不写 `self.overview` →
  formatter 永远读陈旧概览；`add_info`/`get_info` 全仓无调用。
- 修法：`update_overview` 改写 `self.overview`（同步 `overview_last_update`
  与 commit）；`add_info`/`get_info` 删除（无引用，先 grep 确认）；`info`
  字段保留（兼容序列化）但不再写入。
- 验收：`update_overview(new)` 后 `stock.overview == new`；grep 无
  add_info/get_info 残留调用。

### 3. akshare 死方法块标注（低）

- `data_acquisition.py` 整块 akshare 方法（acquire_daily_overview /
  update_*_overview / acquire_historical_data / acquire_performance_report /
  get_next_report_date / add_performance_report_in_storage）与
  `ZODBStorage` 的 check/set overview 门：保留不删，但 docstring 顶部加
  `deprecated（备用路径，主流程不调用）` 标注；`set_overview_updated_now`/
  `check_need_update_overview` 标注"仅备用路径使用"。
- 验收：标注齐全；grep 主流程调用点确认无引用。

### 4. 模块级 `import AKShareSource` 惰性化（低）

- `data_acquisition.py:3` 模块级导入 → 纯 TDX 启动也付出 akshare 重依赖
  成本。修法：移入 deprecated 方法内（局部 import）。
- 验收：`import core.data_acquisition` 不触发 akshare import（可打点）。

### 5. `investment_manager` 插值消息列表 repr（中）

- `investment_manager.py:39,41`：`{state['bullish_opinions']}` 插值的是
  `[HumanMessage(...)]` 列表 repr 而非观点正文。修法：
  `state['bullish_opinions'][-1].content`（reducer 包装后取正文）。
- 验收：合成状态注入 → prompt 含观点正文无元数据。

### 6. `${state[...]}` 模板残留清理（低）

- bullish_trader.py / bearish_trader.py / investment_manager.py 中的
  `${state[...]}` 字面残留（实际渲染为 `$` 前缀 + 真实值）。修法：删掉
  `$` 前缀，保留正确插值。
- 验收：prompt 无 `$` 前缀；grep 无 `${state` 残留。

### 7. 文案与日志错误（低）

- progress_updater 前后同文案（fundamental/trend/bullish）→ 后一条改
  "…生成完成"；trend_analysis_expert.py:34 logger 复制粘贴错名 →
  "Trend Analysis"。
- 验收：grep 确认无重复文案/错名。

### 8. ZODB 单例线程锁（低）

- `get_zodb_storage()` 惰性初始化无锁；Streamlit 多会话多线程共享单例，
  首屏并发可能双构造。修法：`threading.Lock()` 保护惰性初始化
  （连接本身非线程安全——文档注明单会话使用；锁只防双构造）。
- 验收：并发首调不双构造（单测或代码审查）。

### 9. display LLM 错误 UI 提示（低）

- `display.py` 的 get_stock_info 异常与 graph.stream LLM 失败无 try/except
  → 红屏 traceback。修法：UI 层包一层错误提示（st.error + 中文文案），
  不吞错误（error-handling spec 允许 UI 层守护）。
- 验收：注入失败 → UI 显示中文错误而非裸 traceback。

### 10. time_helper 注解（低）

- `utils/time_helper.py:4` `type[datetime.date]` → `datetime.date`。
- 验收：注解修正，行为不变。

## Acceptance Criteria

- [ ] 10 项完成；grep 验证无死代码调用残留（add_info/get_info/死方法主流程
      引用）
- [ ] 定向测试全绿；全量 pytest 0 failed 保持
- [ ] 无 UI 行为回退（display 冒烟：key 缺失提示、正常流）
- [ ] architecture/core spec 同步（enrichment 真实路径、key 检查、deprecated
      标注）

## Constraints

- akshare 方法**保留不删**（备用 + 既有测试引用），只标注
- `make_investment_committee`/`make_investment_decision` 公共签名不变
  （display 是唯一消费者，改动必须同步 display）
- deprecated 测试零改动
