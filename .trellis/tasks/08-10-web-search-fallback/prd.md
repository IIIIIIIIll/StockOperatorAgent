# 信息面分析师接入免费联网搜索回退（web-search proxy + DDG）

## 背景与问题

信息面分析师（`BillionsInformationAnalyst`）的素材预抓**硬依赖亿信 API**：

- **Python**（`agents/chinese_mainland/information_analyst.py`）：`_prefetch` 只走
  `BillionsClient.search/twitter_search`；且启用谓词
  `information_analyst_enabled()`（`core/role_registry.py`）要求
  `billions_enabled("ANALYST")`——主闸 `BILLIONS_API_KEY` 未配置时节点**完全不注册**，
  没有信息面分析报告 Tab。
- **TS web 版**（`ts/src/agents.ts`）：`BillionsInformationAnalyst.information_analyst`
  是桩——硬编码固定回退上下文「本次运行未检索到任何信息面素材：所有来源均不可用或
  未启用」，**永远不检索**；且 `ts/app/App.tsx` 在 web 平台强制
  `WEB_SEARCH_DISABLED=1`（浏览器直连 DDG 反爬/CORS 限制、Tavily 未配 key），交易员
  的联网搜索工具也被禁。

用户诉求（2026-08-10）：**没有配置 tdx/亿信 API 时，信息面分析师也应直接尝试免费
联网搜索（DuckDuckGo，免 key）**，而不是产出空素材报告。注：TDX 与信息面无关
（TDX 只影响实时行情段），本任务只解决亿信缺位时的联网搜索兜底。

## 现状盘点（证据）

- 免费搜索已存在且免 key：Python `core/llms/tools/web_search.py`（DuckDuckGo，
  cn-zh，08-03 上线实测可用）；TS `ts/src/webSearch.ts`（Tavily 优先/DDG 兜底，
  逐行移植自 Python）。二者都只经 `bind_tools` 绑给专家/交易员，**未接入信息面
  分析师的确定性预抓**。
- TS `server.mjs` 已有同源代理模式（`/llm-proxy`、`/tdx-collect`）——浏览器无
  原始 TCP/跨域限制，由 Node 侧执行后 fetch 回。`/web-search` 走同一套路。
- `test_query_baselines.py` 钉死 trader/manager 查询对 `information_analysis`
  key 缺失时的字节级不变（显式 state 驱动，与图形状无关，不受本任务影响）。

## 需求

- **R1（Python 谓词放宽）**：`information_analyst_enabled()` 改为
  `亿信路径（ANALYST 开且 SEARCH/TWITTER 至少一者开）` **或**
  `联网路径（web_search_enabled()）`——无 `BILLIONS_API_KEY` 但联网搜索开 →
  分析师节点注册。有 key 且亿信路径满足 → 行为与今日逐字节一致。
- **R2（Python 预抓回退）**：`_prefetch` 在亿信源不可用/全部失败/全部无结果时，
  回退 `web_search`（DuckDuckGo）预抓（`_searcher` 注入点，house style 无 mock）；
  回退也失败/空 → 保留现有固定回退文本。有 key 且亿信有结果 → 走亿信，零变化。
- **R3（TS server 代理）**：`server.mjs` 新增 `GET /web-search?q=…` 同源代理端点
  （Node 侧跑 DDG，`^\S+$` 校验 + 超时兜底 + 5xx `{error}`），浏览器 fetch 回
  `{results}` JSON。
- **R4（TS 分析师真实预抓）**：`ts/src/agents.ts` 的 `BillionsInformationAnalyst`
  桩 → 真实预抓：web 平台经 `/web-search` 代理、Node/真机直连 DDG；
  `_searcher` 注入点；查询复用 `{ticker} 最新公告/研报/新闻` 模板；全部失败/空 →
  保留现有固定回退文本（与今日逐字一致，兼容既有测试）。
- **R5（web 端解除搜索禁用）**：`App.tsx` 移除 web 平台强制 `WEB_SEARCH_DISABLED=1`，
  改为将 proxy searcher 注入 `makeWebSearchTool`（交易员工具与分析师预抓共用代理）——
  浏览器自此有可用搜索源。`WEB_SEARCH_DISABLED` 仍由用户设置面板开关控制（零配置
  默认开，与 Python 语义一致）。
- **R6（零行为变化边界）**：有 `BILLIONS_API_KEY` 且 SEARCH/TWITTER 有结果 →
  走亿信（现状）；联网搜索失败/空 → 占位文本不 raise（error-handling spec 降级
  风格）；web 搜索开关关 + 亿信关 → 分析师不注册（与今日一致）。

## 明确不做（Out of Scope）

- TDX/亿信 key 的接入或替换（用户未要求配 key，只要求免 key 兜底）。
- 推特来源的联网搜索模拟（DDG 无推特语义，回退只产出「联网搜索结果」节）。
- 亿信客户端的任何改动。
- Python 端交易员工具行为（已有 web_search 工具，不动）。

## Acceptance Criteria

- [ ] **AC1** 有 `BILLIONS_API_KEY` 且亿信有结果：Python/TS 分析师预抓走亿信，
      报告含带来源/日期条目（现有 `test_information_analyst.py` 全绿即验证）。
- [ ] **AC2** 无 key + 联网搜索开：Python `information_analyst_enabled()` 返回 True
      （注册分析师节点）；`_prefetch` 经注入 `_searcher` 产出「联网搜索结果」节，
      报告上下文含 DDG 素材；e2e 无 key 服务器渲染信息面 Tab（8 tab）。
- [ ] **AC3** 无 key + 联网搜索关：分析师不注册（7 tab，与今日逐字节一致）。
- [ ] **AC4** TS：`curl 'localhost:8090/web-search?q=600036'` 返回非空 `results`
      JSON（DDG 免 key 实测可达）；分析师预抓经注入 fake searcher 的离线单测产出
      素材节；失败/空 → 与今日相同的固定回退文本。
- [ ] **AC5** 有 key 路径的查询/图形态/报告样式与改动前逐字节一致
      （`test_query_baselines.py`、`test_graph_parallel.py` 亿信形态用例全绿）。
- [ ] **AC6** 全量回归：Python `pytest -q`（停 Streamlit）+ `ts` vitest 全绿；
      e2e 无 key 服务器断言更新为 8 tab 语义后全绿（`test_billions_tab.py`）。

## 测试影响（有意的契约变更）

- `test_role_registry.py`：`test_base_shape_without_billions_key` 需显式设
  `WEB_SEARCH_DISABLED=1` 保持 8 节点断言；新增无 key + web 开 → 9 节点用例。
- `test_graph_parallel.py`：`_with_billions_env` 增加 `WEB_SEARCH_DISABLED` 清理
  （防本机 .env 残留翻转图形状，对齐 `_BILLIONS_ENV_KEYS` 既有做法）。
- e2e `conftest.py`：`_BILLIONS_ENV_KEYS` 增补 `WEB_SEARCH_DISABLED`；
  `test_no_key_no_information_tab` 改写为「无 key + web 开 → 8 tab 含信息面分析
  （mock 内容）」（mock_committee 已含 `information_analysis` 报告，仅改断言）。
- `test_information_analyst.py`：`_ENV_KEYS` 增补 `WEB_SEARCH_DISABLED`；新增
  无 key + 注入 `_searcher` 的回退用例、亿信全失败回退用例、双失败保留回退文本用例。
