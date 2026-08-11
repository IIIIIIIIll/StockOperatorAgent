# 实施：信息面分析师接入免费联网搜索回退（web-search proxy + DDG）

## Step 1 — Python 开关解析：新增 `billions_cap_switch`（`utils/billions_config.py`）

- 新增 `billions_cap_switch(capability) -> bool`：**无主闸 key 约束**的能力开关
  （总闸 `BILLIONS_MASTER` 覆盖 + env `BILLIONS_DISABLED`/`BILLIONS_{cap}_DISABLED`），
  语义与 `billions_enabled` 的开关部分逐字一致，仅剔除 `BILLIONS_API_KEY` 硬约束。
- `test/utils/test_billions_config.py`：新增 2 用例（覆盖层开/关 + env 真值语义）。

**验证**：`python3 -m pytest test/utils/test_billions_config.py -q`

## Step 2 — Python 启用谓词（`core/role_registry.py`）

- `information_analyst_enabled()` 改为：`billions_cap_switch("ANALYST")` 且
  （`billions_enabled("SEARCH") or billions_enabled("TWITTER") or web_search_enabled()`）。
  import `web_search_enabled`（`core.llms.tools.web_search`，无环）。
- `test/core/test_role_registry.py`：`_ENV_KEYS` 增补 `WEB_SEARCH_DISABLED`
  （先全清再应用）；`test_base_shape_without_billions_key` 显式
  `{"WEB_SEARCH_DISABLED": "1"}`（web 关 → 8 节点 16 边保持）；新增
  `test_web_fallback_shape_without_billions_key`（web 开 → 9 节点 19 边 =
  `_ANALYST_NODES`/`_ANALYST_EDGES`）；`test_analyst_off_switches_off_shape`
  （ANALYST 关 → 8 节点，web 开也不注册）。

**验证**：`python3 -m pytest test/core/test_role_registry.py -q`

## Step 3 — Python 分析师预抓回退（`agents/chinese_mainland/information_analyst.py`）

- 构造新增 `_searcher=None`（house style 注入点，kwarg，位置不变）；
  `self._web_tool = None` 懒加载：`make_web_search_tool(_searcher=self._searcher)`
  （复用单点实现，不复制 `_summarize_results`）。
- `_prefetch`：亿信路径照旧收集 sections + 跟踪 `found_content`
  （`"检索结果】" in section` 判真实条目）；`not found_content and
  web_search_enabled()` → `_web_search_section(ticker)`（`_QUERY_TEMPLATES["web"]`
  查询 1 次，`tool.invoke({"query": ...})`，失败/空 → 占位文本不 raise）。
- `test/agents/test_information_analyst.py`：`_ENV_KEYS` 增补 `WEB_SEARCH_DISABLED`；
  新增：① 无 key + web 开 + 注入 fake searcher → 查询含【联网搜索结果】+ 素材条目，
  client 零构造；② 亿信全空（client 返回空 content）+ web 开 → 亿信「无返回结果」
  注明 + 联网节并存；③ 双失败 → 现有固定回退文本逐字保留。

**验证**：`python3 -m pytest test/agents/test_information_analyst.py test/core/llms/tools/test_web_search.py -q`

## Step 4 — Python 图并行测试（`test/integration/test_graph_parallel.py`）

- `_with_billions_env`：清理集增补 `WEB_SEARCH_DISABLED`；既有 base 形态用例
  （`test_join_supplies_all_reports_to_traders` 等 8 节点/17 messages 断言）传
  `{"WEB_SEARCH_DISABLED": "1"}` 显式 web 关；新增
  `TestGraphWebFallbackShape`（无 key + web 开 + `_with_fake_client` + 注入
  searcher → 9 节点、messages 19、预抓含联网节）。
- `test_query_baselines.py` 不动（显式 state 驱动，与图形状无关）。

**验证**：`python3 -m pytest test/integration/test_graph_parallel.py test/agents/test_query_baselines.py -q`

## Step 5 — e2e 同步（`test/e2e/conftest.py` + `test_billions_tab.py`）

- `_BILLIONS_ENV_KEYS`/env 构造增补 `WEB_SEARCH_DISABLED`（跨运行确定性）。
- `test_no_key_no_information_tab` 改写为「无 key + web 开 → 8 tab 含信息面分析
  （mock 内容 `信息面分析（mock）`）」（FakeGraph 无条件吐全量 State，仅改断言 +
  docstring；AC1 措辞从「无 key 零变化」更新为「无 key 且 web 关 → 7 tab」）。

**验证**：`python3 -m pytest test/e2e/test_billions_tab.py -v`（需停 Streamlit）

## Step 6 — TS 搜索层（`ts/src/webSearch.ts`）

- 导出 `ddgSearcher`（server.mjs 用）；新增 `makeProxySearcher(base,
  _fetch = fetch)`（`${base}/web-search?q=…` → `{results}` JSON，非 ok/无 results
  → throw）；`defaultSearcher()` 浏览器（`typeof window !== 'undefined'`）→
  `makeProxySearcher(window.location.origin)`，Node → Tavily/DDG（现状）。
- `ts/test/web-search.test.ts`：`makeProxySearcher` 注入 fake fetch 断言 URL 与
  结果归一化；`defaultSearcher` 浏览器分支不可测（Node 环境）→ 仅测注入路径。

**验证**：`cd ts && npx vitest run test/web-search.test.ts`

## Step 7 — TS server 代理（`ts/app/server.mjs`）

- `GET /web-search`：`q` 非空 + 长度 ≤ 200 → `ddgSearcher(q)`（import
  `../src/webSearch.ts`）→ `{results}`；超时 20s 兜底；失败 → 502 `{error}`；
  路由挂到现有 `http.createServer` 分支（对齐 `/tdx-collect` 模式）。

**验证**：`node --experimental-strip-types server.mjs` 后
`curl 'localhost:8090/web-search?q=600036'` 返回非空 results（免 key DDG）。

## Step 8 — TS 分析师预抓（`ts/src/agents.ts` + `ts/src/committee.ts` + `ts/app/App.tsx`）

- `BillionsInformationAnalyst`：构造新增 `_searcher?`（缺省 `defaultSearcher()`）；
  `information_analyst` 预抓 `{ticker} 最新新闻` 1 次 → `summarizeResults` →
  素材上下文；失败/空 → 与今日相同的固定回退文本（逐字不变）。查询模板沿用
  Python `_QUERY_TEMPLATES["web"]` 语义。
- `committee.ts` `informationAnalystEnabled()`：`billionsEnabled('ANALYST') &&
  (billionsEnabled('SEARCH') || billionsEnabled('TWITTER') || webSearchEnabled())`。
- `App.tsx`：删除 web 平台强制 `WEB_SEARCH_DISABLED=1` 块（浏览器现经 `/web-search`
  代理有可用搜索源；开关仍由设置面板 `applySwitchesToEnv` 控制）。
- `ts/test/agents.test.ts`：新增分析师预抓离线用例（注入 fake searcher → 素材节
  入查询；searcher 抛错 → 固定回退文本）；`ts/test/committee.test.ts` 谓词用例。

**验证**：`cd ts && npx vitest run test/agents.test.ts test/committee.test.ts`

## Step 9 — spec 更新 + 全量回归

- `.trellis/spec/agents/index.md`（分析师预抓 web 回退、谓词新形态）、
  `core/index.md`（role_registry 谓词）、`error-handling.md`（联网回退降级
  不 raise）、`testing.md`（web 回退注入点 + e2e 8 tab 语义）、
  `architecture.md`（分析师条件接线补充联网路径）；README 亿信段补一句
  「未配置时信息面分析师经免费联网搜索兜底」。
- 全量：`python3 -m pytest -q`（停 Streamlit）+ `cd ts && npx vitest run`。
- `python3 ./.trellis/scripts/add_session.py` 记录 + commit。
