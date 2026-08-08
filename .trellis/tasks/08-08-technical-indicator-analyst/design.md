# 设计：技术指标分析师

## 目标边界

新增第 6 个 agent「技术指标分析师」：**指标信号 + 择时**角色，与趋势分析专家互补不重叠（用户拍板）：

| 维度 | 趋势分析专家（现状） | 技术指标分析师（新增） |
|------|---------------------|----------------------|
| 产出 | 走势大方向、支撑压力区间、长中短期目标价、乐观/中性/悲观情景 | 指标信号解读、择时判断、信号强度与置信度、关键防守位 |
| 禁止 | 禁止引入基本面 | 禁止引入基本面；**禁止给出目标价位与情景分析**（趋势专家职责） |
| 数据 | `stock_information`（含 8 项指标摘要） | 同左（同一份输入，指标已在其中） |

## 架构与数据流

```
START ──┬─ fundamental_analysis_expert ──┐
        ├─ trend_analysis_expert ────────┼──→ bullish_trader ──┐
        └─ technical_indicator_analyst ──┘                      ├─→ bullish_revise ──┐
                               ↑                                ├─→ bearish_revise ──┼─→ investment_manager → END
   8 节点 15 边（12+3）       （新）3 专家并行                     └─→ 对称              （不动）
```

- 新节点与 fundamental/trend 并行（只依赖 `stock_information`），bullish/bearish 变为**三入边隐式 join**（LangGraph 等三份报告齐 → 墙钟仍 4 阶段）。
- 节点装配顺序：`investment_committee.py` 中 trend 之后、bullish 之前注册（与现有两专家并列的代码位置）。

## 组件清单

### 1. 新 agent：`agents/chinese_mainland/technical_indicator_analyst.py`

严格复制 `trend_analysis_expert.py` 形状（agents spec 模板）：
- 类 `TechnicalIndicatorAnalyst`，构造签名 `(llm, config, progress_updater=None)`——**专家层不传 tools**，直调 `invoke_with_retry`（与 fundamental/trend 一致）。
- 节点方法 `technical_indicator_analyst(self, state)`：
  - query 从 `state['target_stock_ticker']` + `state['stock_information']` 构建（与 trend 相同）
  - `safe_progress("开始技术指标分析报告生成。。。")` / `safe_progress("技术指标分析报告生成完成。。。")`
  - `invoke_with_retry(self.llm, {"query": query}, config=self.config)`
  - `push_report(self.progress_updater, "technical_indicator_analysis", response.content)`
  - 返回 `{"messages": [query[0], response], "technical_indicator_analysis": response.content}`

### 1.5 新指标模块：`core/llms/tools/extra_indicators.py`（vendor 零改动）

VENDOR.md 严禁与上游静默分叉——`compute_all` 只实现现有 8 组，**新指标写在本仓库自己的模块**，复用 vendor 参数化函数（`calc_ema` / `calc_atr`），公式见 research/indicators-macd-vh-liu-bias.md：

- `calc_macd_vh(df, fast=12, slow=26, atr_len=26, signal=9) -> DataFrame`：
  `MACD_V = (EMA12−EMA26)/ATR26×100`、`SIGNAL = EMA9(MACD_V)`、`MACD_VH = MACD_V − SIGNAL`
- `calc_liu_bias(df, n=20) -> Series`：`ln(close) − ln(EMA20)`

`get_trend_indicators.py` 输出追加 2 行（同一 df 先 compute_all 再算 extra，取末根 bar）：
- `MACD-VH: MACD_V=x.xx  Signal=y.yy  VH=z.zz  柱态={正扩张/正衰减/负衰减/负扩张}  动量区={超买>150/强势50~150/震荡-50~50/弱势-150~-50/超卖<-150}`
- `刘晨明乖离率(20日EMA): p.qq%`
- 柱态判定需相邻 bar：全序列算好后比较 iloc[-2] vs iloc[-1]（VH 与 0 的大小 + 与自身前值的增减）
- **200-EMA 趋势制度过滤不做**（60 根日K窗口预热不足，Out of Scope）
- 阈值解读（5% / ±40 / ±50/±150/±200）放 prompt，工具只输出数据

### 2. 新 prompt：`core/llms/prompt.py` → `technical_indicator_analyst_message`

- 角色句须含**离线测试路由独有短语**（与现有 7 个短语互斥，歧义即 UNROUTED）：
  `"你是一位专业的股票技术指标分析师。精于技术指标信号解读与择时判断。"`
  （不包含、不被包含于 "精于计算公司的基本面数据" / "精于根据股票走势给出高准确度的客观趋势分析" / "精于价值与趋势结合的投资策略"）
- 分析要求（信号+择时职责）：
  - MACD 金叉/死叉与柱体变化、**MACD-VH 波动率归一化动量**（柱态四色语义：正扩张/正衰减/负衰减/负扩张、±40 短期过度延伸、动量区 ±50/±150/±200）
  - RSI 超买/超卖
  - KDJ 背离与超买/超卖
  - BOLL 轨道位置与开口收窄/扩张
  - 均线多空排列与交叉
  - 量比与量价配合
  - **刘晨明乖离率（ln 与 20 日 EMA 偏离）**：阈值规律 >15% 过热不追高、5%~15% 适中可入场、0~5% 接近均线趋势转弱、−5%~0% 刚跌穿坚守、<−5% 危险信号（关键阈值 5%）
  - 信号组合的一致/冲突、信号强度与置信度
  - 关键防守位（如跌破某均线/BOLL 下轨的技术性止损参考位）——**不给出具体目标价与乐观/中性/悲观情景**（趋势专家职责）
- 严格禁止（house style）：编造数据、引入基本面信息（"不要将基本面信息引入分析逻辑中"）、给出目标价位与情景分析、回复"无法确定"。

### 3. State：`utils/state.py`

新增 `technical_indicator_analysis: Optional[str]`（trend_analysis 之后）。**纯增量**：无类型变更、无 reducer 变更。

### 4. 图装配：`core/investment_committee.py`

- import + 注册节点 `"technical_indicator_analyst"`（method `technical_indicator_analyst.technical_indicator_analyst`）
- 新增 3 边：`START → technical_indicator_analyst`、`technical_indicator_analyst → bullish_trader`、`technical_indicator_analyst → bearish_trader`

### 5. 下游消费：3 个 agent 节点 + 3 个 prompt

节点 query（`bullish_trader.py` / `bearish_trader.py` / `investment_manager.py`）：追加
```
技术指标分析报告: \n
{state['technical_indicator_analysis']}
```
prompt（`prompt.py`）三处同步（bullish / bearish / investment_manager）：
- "基于基本面分析师和趋势分析师的报告" → "基于基本面分析师、趋势分析师和技术指标分析师的报告"
- "综合考虑基本面与趋势分析" → "综合考虑基本面、趋势与技术指标分析"
- "所有逻辑必须能在趋势与基本面分析报告中找到根据" / "对于没有在基本面分析师和趋势分析师中出现的数字必须标明出处" / "不允许否定与质疑基本面与趋势分析报告" 三处同样补"技术指标分析"
- revise prompt（bullish_revise/bearish_revise）：只读对方初稿与己方初稿，**不改**

### 6. UI：`core/ui/display.py`

- REPORT_KEYS 增 `("technical_indicator_analysis", "技术指标分析")`（trend 之后）
- tab 增「技术指标分析」（趋势分析之后、看涨观点之前）；display.py:125-129 与 177-181 两处同步
- push_report 即时填充 + superstep 兜底**零改动**（同 key 渲染逻辑通用）

### 7. 测试

- 新单测 `test/core/llms/tools/test_extra_indicators.py`：小样本 df 钉死公式（MACD-V = (EMA12−EMA26)/ATR26×100、Signal=EMA9、VH 差、ln 乖离率）——已知输入可手算断言；柱态四态判定（正扩张/正衰减/负衰减/负扩张）
- `test/core/llms/tools/test_get_trend_indicators.py`：marker 断言加 `"MACD-VH"` 与 `"刘晨明乖离率"`（N/A 计数断言不受影响——新指标行有数据时不为 N/A）
- `test/integration/test_graph_parallel.py`：
  - 路由表加 `"精于技术指标信号解读与择时判断" in system → INDICATOR`（先于 manager 路由；注意新短语不能命中已有分支——现有路由按子串匹配，新增短语须无歧义）
  - join 测试扩为三报告齐备才进 trader；bridge 测试 7 → 8 报告
  - manager 测试：query 断言若含报告插值文本需同步
- `test/e2e/mock_committee.py`：MOCK_REPORTS 加 `technical_indicator_analysis` 条目 + FakeGraph 第一批 superstep 吐出
- `test/e2e/test_smoke.py:46`：tab 标签列表加 "技术指标分析"
- `test/e2e/test_interaction.py:86-87`：报告断言表加该 tab 条目
- `test/integration/test_basic_graph.py`：检查 dummy 夹具是否枚举全图节点（若按单 agent 图构建则零改动）
- `test/integration/test_investment_committee.py`：deprecated skip，零改动

## 兼容性与回滚

- 纯增量：新 State key、新节点、新 prompt 常量；既有节点仅改 query 模板与 prompt 文案（对外无契约变化）。
- 回滚 = revert 提交；图装配增量边不破坏旧 checkpoint 语义（InMemorySaver 内存态，无持久迁移问题）。
- 成本：每分析 +1 次 LLM 直调（无工具循环）；`WEB_SEARCH_DISABLED` / TDX MCP 开关语义零变化。

## 关键风险

1. 离线测试路由短语歧义 → 新短语与既有 7 条子串互斥，测试钉死（UNROUTED 即失败）。
2. E2E 断言（tab 标签列表、mock 报告表、交互断言）必须与 UI 改动**同提交锁步**——display 改而 e2e 断言不改即红。
3. manager/bullish/bearish 节点 query 改动影响集成测试对 query 文本的断言——实现时先跑测试定位全部断言点。
