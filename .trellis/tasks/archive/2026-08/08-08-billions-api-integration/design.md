# 设计：亿信 API 接入

## 架构与边界

新增能力分 4 处落位，全部以开关门控（R2）；关闭时与现状同构：

```
data_source/chinese_mainland/billions/
├── __init__.py
└── client.py        # BillionsClient：4 端点薄包装，httpx + X-API-KEY
core/llms/tools/
├── billions_fin_db.py   # get_billions_financial_intel(ticker) -> str（前置段）
├── billions_search.py   # make_billions_search_tool(...)（工具，计数上限）
├── billions_twitter.py  # make_billions_twitter_tool(...)
└── billions_fetch.py    # make_billions_fetch_tool(...)
utils/
└── billions_config.py   # 开关解析（共享 truthy 语义 + 能力门控）
agents/chinese_mainland/
└── information_analyst.py  # BillionsInformationAnalyst（graph 节点）
```

- **client.py** — `BillionsClient(_http=None, _key=None)`：方法 `fin_db(query,
  data_sources=["auto"])` / `search(query, source, search_mode, count,
  time_range)` / `twitter_search(query, search_mode, count)` / `fetch(url=None,
  doc_id=None)`。超时参数化：fin_db 120s、search/twitter 按档位 +10s 余量、
  fetch 90s。返回归一化 dict（`result[]` 或 `content[]`）；业务失败
  （`success:false`/HTTP 4xx/5xx/异常）→ 抛 `BillionsApiError`（带 code/status），
  由调用方降级，client 内不做重试（对齐 data_source 降级约定）。
  `_http` 注入 httpx 实例供测试伪造响应。
- **billions_config.py** — `billions_enabled(capability: str) -> bool`
  （= `BILLIONS_API_KEY` 存在 且 非 `BILLIONS_DISABLED` 且 非
  `BILLIONS_{CAP}_DISABLED`；truthy 语义 `("","0","false","no")` 对齐
  `WEB_SEARCH_DISABLED`）、`billions_max_calls(capability, default) -> int`。
  能力名：`FINDB` / `SEARCH` / `TWITTER` / `FETCH` / `ANALYST`。
- **工具三件套** — 仿 `web_search.py` 形状：函数级懒导入 client、注入参数
  `_client=None`、失败 → `logger.warning` + 占位文本、闭包计数器 `_calls`
  超 `_max_calls`（默认 3/2/3，env `BILLIONS_{SEARCH,TWITTER,FETCH}_MAX_CALLS`
  覆盖）→ 占位提示不再请求。名称 `billions_search` / `billions_twitter` /
  `billions_fetch`；返回 Markdown（title/link/date/institution）。
  `billions_fetch` 对 `doc_id`（announcement）与 `url` 双支持。
- **前置段** — `get_billions_financial_intel(ticker)`：固定问数（该股最新财务
  概况 + 近期行情，fin_db auto 路由）；开关关 → 空串；失败 → 占位段或空串，
  不污染 `stock_information`。
- **信息面分析师** — `BillionsInformationAnalyst` 复制现有 expert 模板
  （`ChatPromptTemplate` + `partial(current_date)` + `invoke_with_retry` +
  `safe_progress`/`push_report`）。node 内**确定性预抓**：对
  [announcement, report, web] 各 1 次 search（fast、count=5、time_range
  past 3 months）+ twitter 1 次（fast、count=5）；按开关过滤源，失败源跳过并
  在报告中注明；汇总后单次 LLM 调用撰写带来源/日期的信息面报告。prompt 新增
  `core/llms/prompt.py`（信息面分析师 system 段：汇总公告/研报/新闻/推特，
  标注来源机构与日期，指出信息缺口）。

## 数据流

```
build_stock_information（investment_committee.py:38-49）
  = 个股信息 + 趋势 + 财务指标 + 实时情报 + [get_billions_financial_intel]（条件）
                                                        ↑ 开关开时追加
committee（investment_committee.py:55-127）
  tools = [web_search] + [billions_search/billions_twitter/billions_fetch]（按开关）
  START → {fundamental, trend, technical, information}（分析师条件并行）
        → bullish/bearish（3 专家 + 分析师 join，4 入边）
        → 互相 _revise → investment_manager → END
  State 新增 key：information_analysis: str（一次性写入，无追加语义）
UI（display.py:34-41 REPORT_TABS）→ 改为函数按 ANALYST 开关条件返回列表，
  information_analysis Tab 仅启用时渲染
```

分析师输出消费方式对齐现有 expert 输出（traders join 入边）；manager 若
现有流程读 expert 输出则同样读分析师输出，实施时对照
`investment_committee.py:108-123` 现有边保持一致。

## 兼容与迁移

- 无 key / 全关 → graph 与 tools 与 Tab 与今天逐字节一致（条件接线而非占位
  节点）；ZODB/UI/State 既有键不变
- e2e：`mock_committee.py` `MOCK_REPORTS` 增加 `information_analysis` 条目；
  `conftest.py` 注入 dummy `BILLIONS_API_KEY` 使新 Tab 渲染路径被覆盖；
  零真实调用审计断言加入"无亿信 API 调用"标记检查；另增无 key 用例断言
  新 Tab 不存在
- `test/integration/test_graph_parallel.py`：`_RoutedLlm` 增加信息面分析师
  prompt 路由；新图形态（4 专家并行）与旧形态（3 专家）均覆盖

## 关键权衡

| 决策 | 选择 | 权衡 |
|---|---|---|
| 采集策略 | 确定性预抓（4 检索/run 固定） | 成本可预期、覆盖确定；固定检索词可能漏信息 → 多空交易员工具 follow-up 弥补 |
| 图接线 | 条件接线（关时无节点） | 零行为变化；测试需覆盖两种图形态 |
| 工具调用 | LLM 按需 + 每 run 计数上限 | 省配额 vs 可能错过信息；上限 env 可调 |
| 存储 | 检索结果不落 ZODB | 避免 schema 膨胀；报告文本随 State 流至 UI |
| 超时 | client 显式参数化 | 慢档位 120s+，UI 侧需容忍（走 ProgressBridge，不阻塞主流程） |

## 回滚

- 一键回滚：设 `BILLIONS_DISABLED=true` 或删除 `.env` 中 `BILLIONS_API_KEY`
- 每实现步骤独立提交，单步可 revert（见 implement.md 回滚点）
- 客户端/工具/分析师相互独立开关，可逐步灰度

## 风险文件（改动面）

- `core/investment_committee.py` — 图结构、tools 绑定、前置段
- `core/ui/display.py` — REPORT_TABS 契约（静态列表 → 条件函数）
- `utils/state.py` — 新 key `information_analysis`
- `test/e2e/mock_committee.py` / `conftest.py` — FakeGraph 镜像与 env
- `core/llms/prompt.py` — 新 system prompt
