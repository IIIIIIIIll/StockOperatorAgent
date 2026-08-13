---
description: Streamlit UI 渲染契约 — tabs、queue bridge 流式渲染、设置面板、错误守护
paths:
  - core/ui/display.py
  - core/llms/progress.py
---
# Streamlit UI 渲染契约 (`core/ui/display.py`)

- `write_ui()` renders the Chinese UI: ticker form with 6-digit validation, five
  report tabs, and a `status.empty()` container passed as `progress_updater` so
  agents can stream progress into it.
  **2026-08-02**：BJ 代码（4/8 前缀，`tdx_source.is_bj_ticker`）提交时直接
  `st.error` 明确提示不支持（TDX 不覆盖 BJ 证券），不静默 NaN。
- **2026-08-02（enrichment 真实接入）**：display 构造 `stock_information` 调用
  `build_stock_information(ticker)`（与 `make_investment_decision` 共用组装
  点）——技术指标与 TDX 实时情报段真实进入 agent 上下文；无 `TDX_API_KEY`
  时情报段为降级占位文本。
- **2026-08-02（UI 层错误守护）**：`build_stock_information` 与事件循环
  包 try/except（error-handling spec 允许的 UI 守护边界）——图后台线程的
  异常经队列回抛（error 事件 → raise），失败 `st.error` 中文提示 +
  `logger.exception`，不裸 traceback 红屏、不吞错误。
- **2026-08-08（设置面板，08-08-billions-switches-ui）**：侧边栏「设置」
  expander 4 分区承载全部配置——①模型与密钥（08-09 起 LLM_MODEL /
  LLM_BASE_URL 自由文本输入 + LLM_API_KEY 等 4 个 password 框，**空 =
  不修改**、非空 = 更新；模型/endpoint 非密钥恒收集，空值由 env_file
  必填校验拒绝保存）+ LangSmith（TRACING/
  key/project）→「保存」按钮经 `utils/env_file.update_env_file` **原子写
  .env + 同步 os.environ**（立即生效、重启保留；只动白名单 8 键，不 log
  密钥值）；②能力开关（TDX MCP/联网搜索/亿信总闸+5 能力）与亿信调用上限
  → **会话级**：表单提交前 `set_runtime_overrides`（在
  `build_stock_information` 之前）写入 `utils/runtime_config` 覆盖层，三处
  消费点（web_search/get_market_intel/billions_config）随即读到；重载恢复
  env。**面板在 `_has_deepseek_key` 检查之前渲染**——无 key 用户可在面板
  录入密钥，保存即通过门控无需重启。密码框每次渲染不留值（「未修改/清空」
  可区分）；置灰逻辑：无 BILLIONS_API_KEY 或总闸关 → 能力 toggle disabled。
  面板逻辑拆纯函数（`_collect_persisted_updates` / `_collect_session_overrides`
  / `_save_settings` / `_panel_enablements`）离线可测；真实交互由 e2e
  test_settings_panel.py 覆盖。**DOM 注意**：面板渲染使页面首个 input 变为
  折叠 expander 内控件——e2e 一律用 `get_by_label("股票代码")` 等标签
  选择器，勿用 `input.first`（2026-08-08 实测踩坑，6 处用例全中招）。
- **2026-08-02（日志）**：各 agent 的 Query/Response debug 日志是结果
  唯一打印点（display 不再重复打 Assistant 行）；`main.py` 的
  `_ensure_file_handler()` 幂等注册文件 handler——Streamlit 每次 rerun
  重执行 main.py 顶层代码，裸 `logger.add` 会叠加同文件 handler（实测
  同毫秒时间戳 2-14 份重复；用私有 `handler._sink._file_path` 判定已存在
  路径后跳过）。
- **2026-08-02（queue bridge：进度实时上屏 + 报告节点级填充）**：并行
  节点在 LangGraph 工作线程，Streamlit DeltaGenerator 只能在脚本线程
  enqueue——旧方案（sync stream 循环内渲染）只能按 superstep 填充
  （2-2-1：同一 superstep 的并行节点更新一起到达），且并行节点进度被
  safe_progress 降级丢弃。现架构：`ProgressBridge`（core/llms/progress.py，
  `info`/`push_report` 都是线程安全 `queue.put`，永不抛）作为
  progress_updater 传给图；`graph.stream` 在**后台线程**驱动
  （`_stream_graph_events`：superstep update 的报告入队作兜底、异常与
  sentinel 入队）；脚本线程 `events.get()` 循环实时渲染——进度 →
  status 容器，报告 → 对应 Tab。每个 agent 在 LLM 返回后调 `push_report`
  （core/llms/progress.py helper，None/非 bridge no-op）——报告**节点级
  即时到达**（1-1-1-1-1，实测 asymmetric 延迟：fast 节点 0.5s 即到，
  不等同 superstep 的慢节点 3s）；`rendered` 集合按 **(key, content)** 对
  去重（agent push 先到渲染，superstep update 同内容后到跳过；
  08-04-adversarial-verdict-loop 起 opinions key 推送两次——初稿 + 修订版
  ——同 key 不同内容 → **追加渲染**，观点 tab 依次显示初稿 → 修订版；
  08-04-ui-opinion-round-labels 起追加渲染带**轮次计数**：`counts` 按 key
  计数（替代 `rendered_keys` 首次渲染标记，行为等价），通用轮次计数（非
  "初稿/修订版"字样），未来多轮互驳每轮追加自然成为第 3、4 次观点；
  08-05-ui-opinion-expanders 起观点 key（`OPINION_REPORT_KEYS` =
  bullish_opinions / bearish_opinions）渲染为**可折叠条目**：每份观点一个
  `st.expander("第 {n} 次观点", expanded=(n == 1))`——第 1 次默认展开、
  后续默认折叠（用户先见初稿，修订版点击展开，不占空间）；非观点 key
  单次渲染保持平铺（header + 内容））。
  图失败 → error 事件回抛 → 既有 st.error 守护。
- **流式渲染契约（2026-08-02）**：`REPORT_TABS` 五元组（state key → Tab
  标题）顺序 = `st.tabs` 中报告 Tab 的创建顺序（数据 Tab 插入不影响相对
  顺序），渲染 dispatch 依赖该契约；`_report_content`
  消化两种值形态——stream update 中报告为**原始字符串**（节点返回即写，
  reducer 未应用；实测 2026-08-02），最终 state 里 bullish/bearish 为
  add_messages 消息列表（`[-1].content`，见 `agents/index.md`）——展示
  语义与旧实现一致。`iter_report_items` / `_report_content` 为纯函数
  （与 Streamlit 解耦，display.py 仍是薄渲染层），离线测试喂合成 update
  验证映射（`test/core/ui/test_display.py::TestDisplayIncrementalRender`）。

相关子规范：[ui-data-tab.md](./ui-data-tab.md)（采集数据 Tab）、[ui-theme.md](./ui-theme.md)（主题）、[ui-e2e.md](./ui-e2e.md)（E2E）。
