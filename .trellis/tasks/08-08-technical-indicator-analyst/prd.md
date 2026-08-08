# 添加技术指标分析师

## Goal

为 StockOperatorAgent 投资委员会新增第 6 个独立 agent 角色「技术指标分析师」，与现有趋势分析专家并存（用户已确认：新增独立角色，分工为**指标信号 + 择时**），为多空交易员与投资经理提供指标层面的独立分析输入。

## Background（代码证据）

- 现有 5 个 agent（`agents/chinese_mainland/`）：fundamental_analysis_expert、trend_analysis_expert、bullish_trader、bearish_trader、investment_manager；图装配 `core/investment_committee.py` 7 节点 12 边，三对并行（fundamental∥trend → bullish∥bearish → revise → manager），LangGraph 多入边隐式 join，墙钟 4 阶段。
- `build_stock_information` 已把 8 项技术指标（MA/EMA/MACD/RSI/KDJ/BOLL/ATR/量比 + 换手率，通达信口径，最近一根 bar 摘要）拼进 `stock_information`（`core/llms/tools/get_trend_indicators.py`）——新分析师复用同一份输入。
- 指标扩展决策（用户拍板）：新增 **MACD-VH**（Spiroglou 波动率归一化 MACD，SSRN #4099617）与**刘晨明乖离率**（广发证券策略首席刘晨明，ln(close)−ln(EMA20)，关键阈值 5%）。公式与来源见 `research/indicators-macd-vh-liu-bias.md`。
- 硬约束：vendor（`data_source/.../tdx/vendor/`，tdx_quant 快照 b95d8e9）**严禁修改**（VENDOR.md）——新指标必须写在本仓库自己的模块（如 `core/llms/tools/extra_indicators.py`），复用 vendor 参数化 `calc_ema` / `calc_atr`。
- 既有测试 `test/core/llms/tools/test_get_trend_indicators.py`：占位降级 + marker 断言 + `text.count("N/A") == 1`——扩展输出需锁步加 marker 断言。
- 趋势分析专家（`trend_analysis_expert_message`，prompt.py:40-46）：纯技术驱动、支撑压力区间、长中短期目标价、乐观/中性/悲观情景、禁止基本面。
- State 契约（`utils/state.py`）：`target_stock_ticker` / `stock_information` / `messages` / `fundamental_analysis` / `trend_analysis` / `bullish_opinions` / `bearish_opinions` / `final_decision`。
- 下游消费：bullish/bearish 节点 query 插值 `state['fundamental_analysis']` + `state['trend_analysis']`（bullish_trader.py:51-56，bearish 对称）；manager 同样插值两份报告 + 两份观点（investment_manager.py:44-52）；三处 prompt 文案均写"基于基本面分析师和趋势分析师的报告"（prompt.py:69/93/157）。
- UI（`core/ui/display.py`）：REPORT_KEYS（:35-39）+ tab（:125-129）+ 映射（:177-181）；push_report 节点级即时填充 + superstep 兜底渲染。
- 测试：`test/integration/test_graph_parallel.py` 按 system 消息独有短语路由假 LLM（歧义即 UNROUTED）；`test/e2e/mock_committee.py` 假委员会吐 5 个报告 key；`test/e2e/test_smoke.py:46` 断言 tab 标签列表；`test/e2e/test_interaction.py:86-87` 断言各 tab 渲染内容；`test/integration/test_investment_committee.py` 为 deprecated skip。

## Requirements

R1. 新增 agent `agents/chinese_mainland/technical_indicator_analyst.py`，类 `TechnicalIndicatorAnalyst`，严格遵循 agents spec 模板：构造签名 `(llm, config, progress_updater=None)`（专家层不传 tools、直调 `invoke_with_retry`）、节点方法 `technical_indicator_analyst`、`safe_progress` / `push_report("technical_indicator_analysis", ...)`、返回 `{"messages": [query[0], response], "technical_indicator_analysis": response.content}`。
R2. 新 prompt `technical_indicator_analyst_message`（`core/llms/prompt.py`）：中文、禁编造；角色句含离线测试路由独有短语"精于技术指标信号解读与择时判断"（与既有 7 条路由短语子串互斥）；产出 MACD 金叉/死叉、**MACD-VH 柱态与动量区（±40 过度延伸、±50/±150/±200）**、RSI 超买超卖、KDJ 背离、BOLL 位置与开口、均线排列、量价配合、**刘晨明乖离率阈值规律（5% 关键阈值）**、信号组合与强度置信度、关键防守位；禁止引入基本面、禁止给出目标价位与情景分析（趋势专家职责）、禁止回复"无法确定"。
R3. State（`utils/state.py`）新增 `technical_indicator_analysis: Optional[str]`，纯增量无 reducer 变更。
R4. 图装配（`core/investment_committee.py`）：注册节点 `"technical_indicator_analyst"`，新增 3 边 `START→` / `→bullish_trader` / `→bearish_trader`——3 专家并行、bullish/bearish 三入边隐式 join、墙钟仍 4 阶段（8 节点 15 边）。
R5. 下游消费：bullish/bearish/manager 节点 query 追加第三份报告插值；三处 prompt 文案同步补"技术指标分析师/技术指标分析"引用；revise prompt 不改。
R6. UI（`core/ui/display.py`）：REPORT_KEYS 加 `("technical_indicator_analysis", "技术指标分析")`、新 tab「技术指标分析」（趋势分析之后、看涨观点之前），两处（tab 定义与映射）同步。
R7. 测试同步：`test_graph_parallel.py` 路由表加新短语分支、join/bridge（7→8 报告）/manager 断言更新；e2e `mock_committee.py` + `test_smoke.py:46` + `test_interaction.py` 锁步更新。
R8. 指标扩展（vendor 零改动）：新模块 `core/llms/tools/extra_indicators.py`——`calc_macd_vh`（MACD_V=(EMA12−EMA26)/ATR26×100、SIGNAL=EMA9、MACD_VH 柱）与 `calc_liu_bias`（ln(close)−ln(EMA20)）；`get_trend_indicators.py` 输出追加 2 行（MACD-VH 行含柱态与动量区，刘晨明乖离率行含百分比）；新单测 `test_extra_indicators.py` 钉死公式与柱态四态判定。

## Acceptance Criteria

- [ ] AC1：新 agent 文件通过 agents spec 模板检查（构造签名 / 节点方法 / safe_progress / push_report / invoke_with_retry 直调）
- [ ] AC2：新 prompt 位于 `core/llms/prompt.py`，路由短语与既有 7 条子串无歧义（离线测试无 UNROUTED）
- [ ] AC3：图装配后 `test_graph_parallel.py` 全绿——三份报告齐备才进 trader（三入边 join 语义钉死）
- [ ] AC4：bullish/bearish/manager 的 query 与 prompt 均引用第三份报告（测试断言通过）
- [ ] AC5：UI 渲染「技术指标分析」tab；e2e 全绿（smoke tab 标签 + interaction 内容断言锁步更新）
- [ ] AC6：`test_extra_indicators.py` 全绿——MACD-VH 公式与柱态四态、刘晨明乖离率公式按手算样例断言通过
- [ ] AC7：`get_trend_indicators` 输出含 MACD-VH 与刘晨明乖离率两行，既有 N/A 计数断言不回归（锁步 marker 断言更新）
- [ ] AC8：全量 pytest 通过，数量 ≥ 116 且无新增失败

## Out of Scope

- 不新增除 MACD-VH、刘晨明乖离率外的指标（WR/CCI/BIAS/SAR/OBV/ADX 等均未选；OBV 为累积量、单 bar 快照无意义）
- **MACD-VH 的 200-EMA 趋势制度过滤不做**（图前数据仅 60 根日K，预热不足）——后续如需需扩历史窗口，单独评估
- 不做事件级判断（金叉/死叉时刻、背离的多 bar 历史扩展）——本次为单 bar 快照口径，多 bar 指标历史属另一档扩展
- 不给技术指标分析师绑定联网搜索工具（专家层直调，与 fundamental/trend 一致）
- 不引入新依赖、不改 `tool_loop.py` / revise 轮 / manager 消费逻辑（`[-1].content` 语义不变）
- 不重做趋势分析专家职责（目标价/情景仍归它）
