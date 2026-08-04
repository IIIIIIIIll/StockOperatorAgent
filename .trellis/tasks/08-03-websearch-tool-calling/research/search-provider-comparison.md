# Research: 工具调用型联网搜索数据源选型对比（A 股场景，LangChain 1.3.x）

- **Query**: 为 A 股分析系统（Python + langchain 1.3.14 + langgraph 1.2.10 + langgraph-prebuilt 1.1.0，默认 LLM = DeepSeek 官方 API）选择工具调用型联网搜索数据源；查询以中文为主；运行网络在中国
- **Scope**: external（供应商官网/定价页/LangChain 官方文档/GitHub）+ 本网络实测
- **Date**: 2026-08-03
- **方法**: 本任务没有 exa MCP 工具，改用 curl + `ddgs`（DuckDuckGo 官方 SDK，PyPI 9.14.4）做外部检索；所有关键事实均抓取来源页面原文；"本网络实测" 标记 = 在项目运行机器上直接跑出来的结果；langchain-community 0.4.2 wheel 已下载并直接检查源码

---

## 0. 先决事实：LangChain 1.x 时代的集成生态现状（决定一切选型）

| 事实 | 证据 |
|---|---|
| 官方文档已迁移到 docs.langchain.com，python.langchain.com 直接 308 重定向过去 | 本网络实测（HTTP 308 → docs.langchain.com） |
| 1.x 文档中**有搜索工具集成页的仅 4 家**：Tavily（langchain-tavily）、Exa（langchain-exa）、Perplexity（langchain-perplexity）、Google；**DuckDuckGo / Bing / Serper / SearxNG 在 1.x 文档中已无页面** | https://docs.langchain.com/oss/python/integrations/providers/overview 及 all_providers 页（本任务抓取） |
| **`langchain-community` 已被官方正式停更（sunset）**：GitHub 仓库已 archived，README 挂警告；issue #674（2026-05-22）声明"立即生效"停更，官方给出的替代方向 = 独立 partner 包、或直接在应用代码里实现工具、或走 MCP | https://github.com/langchain-ai/langchain-community（README 警告）; https://github.com/langchain-ai/langchain-community/issues/674 |
| 但 langchain-community 0.4.2 仍在 PyPI 上（最后上传 2026-05-22），依赖 langchain-classic>=1.0.7 + langchain-core>=1.4.0；**与本项目 langchain 1.3.14 无冲突**（pip dry-run 实测：解析出 langchain-classic 1.0.8，可正常安装） | https://pypi.org/project/langchain-community/；本机 `pip install --dry-run langchain-community` |
| community 0.4.2 wheel 内搜索工具实测仍然存在：`tools/ddg_search`（注意：旧路径 `tools/ddg` 已改名 `ddg_search`）、`tools/bing_search`、`tools/searx_search`、`tools/google_serper`、`tools/tavily_search`（后者已标 `@deprecated`）；duckduckgo 工具底层已改用新 SDK `ddgs`（旧包 `duckduckgo-search` 已死，最后发布 2025-07-06） | langchain-community-0.4.2 wheel 源码检查；https://pypi.org/project/ddgs/（9.14.4，2026-05-15 活跃） |

**含义**：本项目装 community 属于"用已停更但有存量版本的包"，能用但无未来维护；凡有 partner 包（Tavily/Exa）应优先 partner 包。

---

## 1. 供应商对比矩阵

| 维度 | Tavily | DuckDuckGo (ddgs) | Bing (Azure) | SearxNG 自建 | Exa | Serper (Google) | Baidu | DashScope enable_search（基线） |
|---|---|---|---|---|---|---|---|---|
| API key | 免费 1000 积分/月，无需信用卡；**另有 keyless 免 key 模式** | 无 key | 需 Azure key（**已不可新申请**） | 无 key | 需 key，注册送 $20 + 每月 $10 | 需 key，送 2500 次（一次性） | 无官方 API | 无（复用 DASHSCOPE_API_KEY） |
| 免费额度 | 1000 积分/月（约 1000 次 basic 搜索）；advanced 深度计 2 积分 | 无限量但反爬受限 | —（已停） | 无限（自托管成本） | $20 起 + $10/月 | 2500 次一次性 | — | 随模型 token 计费，搜索不单独计费 |
| 单价（超出免费） | $0.008/积分（PAYG） | 0 | — | 服务器成本 | $7/1k 次搜索；$1/1k 页正文 | $50/50k 积分（≈$1/1k）起，量大 $0.30/1k | — | 无额外单价 |
| 速率限制 | 开发 key 100 RPM；生产 1000 RPM；429 带 retry-after | 无官方数字；实测易触发反爬 | — | 取决于实例与引擎 | /search 10 QPS | 未公开明确数字 | 反爬墙（实测） | 模型侧限流 |
| 返回内容形态 | **title+URL+content 片段（chunk）+answer+score+可选 raw_content+images**，topic 支持 general/news/**finance**，time_range/include_domains 过滤 | title+URL+snippet（news 源带日期），无 answer/score；输出 string/json/list | （已停） | 各引擎原始 JSON，可配 categories | 语义结果+title+URL+高亮文本（text_contents_options）、可开 livecrawl/summary | Google SERP 全量 JSON（organic/knowledgeGraph/news 等） | 抓取的 HTML 需自行清洗 | **模型生成式回答（黑盒），搜索过程与结果列表不对调用方暴露** |
| 中文覆盖（A 股） | **本网络实测优**：中文财经新闻结果含 澎湃/海报新闻/证券市场周刊/21财经，带相关性 score | **本网络实测可用**：cn-zh 区域 text+news 均出中文财经结果（qq/sina/toutiao/21财经，日期 2026-07-31） | — | 引擎依赖：内置 ChinaSo（中国搜索），无 Baidu 引擎；Google/Bing 引擎从中国 IP 出站易被限 | **未验证**：官方文档无中文覆盖声明，索引为自建（以英文网为主），需实测 | Google 索引中文覆盖好（常识性，**未实测**付费 API） | 若可爬则中文覆盖最全，但**实测撞 百度安全验证 墙** | 阿里自家搜索，中文覆盖应好（未独立验证） |
| 中国网络可达（API 从本服务器发出） | api.tavily.com 可达，**keyless 实测成功** | duckduckgo.com 可达；**ddgs SDK 实测成功**；裸 html/lite 端点实测被反爬挑战拦截 | bing.com 可达但 API 已停 | 自托管（本机出站），Google 引擎大概率被封、需配置引擎白名单 | exa.ai 可达（页面 200，未测 API） | serper.dev 可达（页面 200，未测 API） | 可达但验证墙 | 项目已在用 dashscope（QwenApi 存在） |
| LangChain 1.3.x 集成现状 | **官方 partner 包 langchain-tavily 0.2.18**，`from langchain_tavily import TavilySearch`，1.x 文档有完整 usage 页，native async；community 旧路径 `TavilySearchResults` 已 @deprecated | 仅 community 路径 `tools.ddg_search.DuckDuckGoSearchResults`（0.4.2 在 wheel 中，已改名、**不在 1.x 文档**、包已停更） | community `tools.bing_search`（停更+API 已死，双重不可用） | community `tools.searx_search.SearxSearchResults` + `utilities.searx_search.SearxSearchWrapper`（停更、不在 1.x 文档） | **官方 partner 包 langchain-exa 1.1.0**，`from langchain_exa.tools import ExaSearchResults`，1.x 文档有页 | community `tools.google_serper`（停更、不在 1.x 文档） | 无任何 langchain 集成，需自写 HTTP 工具 | 非工具调用：`extra_body={"enable_search": True}` 仅 Qwen 模型生效；langgraph 侧不可见搜索调用 |
| 失败模式与降级 | 429（有 retry-after，可平滑重试）；月度积分耗尽报错；keyless 撞限 → 换 key | 反爬挑战（"Unfortunately, bots use DuckDuckGo too" 实测）、间歇空结果、封禁；ddgs 后端 auto/html/lite 可切换 | 全不可用 | 引擎级封禁/限流、JSON API 默认需在配置中显式开启、实例运维 | 429、积分耗尽 | 积分耗尽、429 | 验证码墙、IP 封禁、HTML 结构变更 | 黑盒：不可控搜索源、结果不可单独取用、仅 Qwen 路径可用 |

**矩阵结论速览**：Bing 已死（2025-08-11 全量下线）；Baidu 反爬墙（实测）；community 全家桶停更但有存量版本；1.x 官方路径只有 Tavily / Exa / Perplexity 三选。

---

## 2. 各供应商关键事实与来源（每条均可追溯）

### 2.1 Tavily —— 本轮首选（详见第 4 节）

- 定价：Free 1000 积分/月（无需信用卡）；PAYG $0.008/积分；Project 计划起步约 $40+/月；Enterprise 定制。[来源: https://tavily.com/pricing]
- **keyless 模式**：无需账号/key，请求头 `X-Tavily-Access-Mode: keyless` 即可用 Search/Extract，响应与 keyed 完全相同、仅限流。[来源: https://docs.tavily.com/documentation/keyless.md]
- 速率限制：开发 key 100 RPM、生产 1000 RPM；超限返回 `429` + `retry-after` 头（官方建议按其重试）。[来源: https://docs.tavily.com/documentation/rate-limits.md]
- 计费细节：search_depth 为 basic/fast/ultra-fast 计 1 积分、advanced 计 2 积分；`chunks_per_source` 默认 3、每 chunk ≤500 字符。[来源: https://docs.tavily.com/documentation/api-reference/endpoint/search]
- LangChain 1.x 集成（partner 包）：`pip install langchain-tavily`；工具特性表写明返回 "title, URL, content snippet, raw_content, answer, images"，标 "1,000 free searches / month"；参数 `max_results / topic(general|news|finance) / include_answer / include_raw_content / search_depth / time_range / include_domains / exclude_domains`；native async ✅。[来源: https://docs.langchain.com/oss/python/integrations/providers/tavily 与 /tools/tavily_search]
- 旧 community 路径 `langchain_community.tools.tavily_search.TavilySearchResults` 在 0.4.2 中已标 `@deprecated`（wheel 源码 line 22）——**1.x 下应使用 langchain-tavily，社区包里的旧类不该再作为新代码入口**。
- **本网络实测**（keyless + 中文查询 "贵州茅台 2026 半年报 业绩"，topic=news）：返回 4 条高质量中文财经结果（澎湃新闻、海报新闻、证券市场周刊、21财经），每条带 title/url/content 片段/score（0.72–0.79），另有 answer 与 follow_up_questions 字段（answer 为空因为未请求）。**结论：中文财经检索质量与可达性均为实测验证级别。**

### 2.2 DuckDuckGo —— 免费备选/降级路径

- 无 key、免费；LangChain 集成仅存在于 community：`from langchain_community.tools.ddg_search import DuckDuckGoSearchResults`（0.4.2 中目录已由旧名 `ddg` 改为 `ddg_search`；旧类名 `DuckDuckGoSearchTool` 已弃用为 `DuckDuckGoSearchRun`）。
- 底层依赖 **`ddgs`**（新官方 SDK "Dux Distributed Global Search"，v9.14.4，2026-05-15 仍活跃）；旧包 `duckduckgo-search` 最后版本 8.1.1（2025-07-06），已不再更新。[来源: https://pypi.org/project/ddgs/ ; https://pypi.org/project/duckduckgo-search/]
- 工具签名（wheel 实测）：`DuckDuckGoSearchResults(max_results=4 /*alias num_results*/, api_wrapper=DuckDuckGoSearchAPIWrapper(...), output_format="string|json|list", response_format="content_and_artifact")`；wrapper 参数 `region`（默认 wt-wt，cn-zh 有效）、`source`（text/news/images）、`time`、`safesearch`、`backend`（auto/html/lite）。
- **本网络实测**：
  - 裸端点 `html.duckduckgo.com/html/` 与 `lite.duckduckgo.com/lite/` 直接返回反爬挑战页（"Unfortunately, bots use DuckDuckGo too... Select all squares containing a duck"）——**直接裸 curl 不可行**；
  - 但 **ddgs SDK 实测成功**：中文查询 text（含 region='cn-zh'）与 news（region='cn-zh'）均返回 4 条中文财经结果，news 带时间戳（最近日期 2026-07-31，如 21财经/东方财富风格标题）。
- 失败模式：反爬挑战（ddgs 可切换 backend）、间歇性空结果/限流、无官方 SLA。

### 2.3 Bing（Azure Bing Search API）—— 已死，不选

- **微软官方公告：Bing Search APIs 于 2025-08-11 全量退役**，既有实例全部停用、不再接受新客户注册；官方迁移路径是 Azure AI Agents 里的 "Grounding with Bing Search"（另一产品形态，非独立搜索 API）。[来源: https://learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement]
- community `tools/bing_search.BingSearchResults` 在 0.4.2 wheel 中虽存在，但无 key 可拿、旧 key 已失效 → **双重不可用**。The Verge 亦有报道。[来源: https://www.theverge.com/news/667517/microsoft-bing-search-api-end-of-support-ai-replacement]

### 2.4 SearxNG（自托管元搜索）

- 免费、无 key；自托管（Docker/脚本安装）；文档版本 2026.8.3，**项目仍活跃维护**。[来源: https://docs.searxng.org]
- 内置引擎：Bing、DuckDuckGo、Google、Brave、Yahoo、Startpage、Kagi、**ChinaSo（中国搜索）** 等；**无 Baidu 引擎**（历史上因反爬移除）。[来源: https://docs.searxng.org/admin/engines.html，本任务抓取引擎列表]
- LangChain 集成仅 community：`SearxSearchResults(wrapper=SearxSearchWrapper(searx_host="http://localhost:8888"), num_results=5)`；wrapper 支持 `categories`；JSON API 需实例配置开启 `format=json`（默认需显式开启）。[来源: langchain-community 0.4.2 wheel 源码]
- 风险：Google/Bing 引擎从中国服务器 IP 出站大概率被风控（未实测，标注为风险）；多一层自运维成本；community 包停更。

### 2.5 Exa

- 官方 partner 包 langchain-exa 1.1.0（PyPI 2026-03-26），1.x 文档有页：`from langchain_exa.tools import ExaSearchResults` / `ExaSearchRetriever`（支持 k、type=neural/keyword/auto、livecrawl、summary、text_contents_options）。[来源: https://docs.langchain.com/oss/python/integrations/providers/exa_search]
- 定价：注册送 $20 积分（官方称约 2800 次搜索），免费层每月再送 $10；Search $7/1k 请求、Contents $1/1k 页、Answer $5/1k、Deep Search $12–15/1k。[来源: https://exa.ai/pricing ; https://exa.ai/docs/reference/pricing]
- 速率限制：/search 10 QPS、/contents 100 QPS、/answer 10 QPS。[来源: https://exa.ai/docs/reference/rate-limits]
- **中文覆盖：未找到官方任何语言/区域覆盖声明**（文档 llms.txt 检索无 "language/Chinese" 条目），其索引为自建（"The Exa Index"），面向英文网络为主——**对中文/A 股查询的覆盖度列为"未验证"，若要选需先拿 key 实测**。此为明确标注的缺口。

### 2.6 Serper（Google SERP）

- 官网首页："The World's Fastest & Cheapest Google Search API... Get 2,500 free queries, No credit card required"（本任务实测抓取）；**付费详情页 serper.dev/pricing 现已 404**（本任务实测），第三方 2026-07 调研给出：Starter $50/50k 积分（≈$1/1k）、Standard $375/500k、Scale $1,250/2.5M、Ultimate $3,750/12.5M，积分 6 个月有效，单次请求 11–100 条结果计 2 积分。[来源: https://serper.dev ; https://apiserpent.com/blog/serper-pricing-credits-explained]
- LangChain 集成仅 community `tools.google_serper.GoogleSerperResults`（停更、不在 1.x 文档）。
- 中文覆盖：Google 索引中文覆盖好（常识性判断，付费 API 未实测）。返回为完整 Google SERP JSON（organic+knowledgeGraph+news 等）。

### 2.7 Baidu —— 反爬墙实测，不推荐作为主路径

- **本网络实测**：`curl "https://www.baidu.com/s?wd=贵州茅台"`（浏览器 UA）返回 1488 字节的 **"百度安全验证"**（wappass）反爬页，无任何搜索结果 DOM——**裸 HTTP 直接不可用**。
- 无 langchain 集成、无面向开发者的公开网页搜索 API（未找到官方公开搜索 API 文档，标注：需自行确认；已知的 Baidu 商业化接口是竞价/统计类，非通用网页搜索）。
- 若要走 Baidu 覆盖，可行替代：**SearchApi**（LangChain 1.x all_providers 页收录的外部 API，支持 Google/Bing/**Baidu** 等多引擎统一接口）[来源: https://docs.langchain.com/oss/python/integrations/providers/all_providers]，但属第三方付费聚合。
- 结论：自己实现 Baidu 抓取 = 与验证码墙/封禁长期搏斗，ROI 差；A 股中文信息 Tavily/DDG 实测已可覆盖主流财经源（澎湃/21 财经/证券周刊等）。

### 2.8 DashScope enable_search（Qwen 基线，对照组）

- 官方文档：Chat Completions 兼容接口用 `extra_body={"enable_search": True}`（仅"支持联网搜索的模型"，如 qwen-plus 系）；Responses API 用 `tools=[{"type": "web_search"}]`；DashScope 原生 SDK 用 `Generation.call(..., enable_search=True)`；多模态模型必须流式调用且走 multimodal 端点。[来源: https://help.aliyun.com/zh/model-studio/web-search]
- **对照组局限（写进基线设计的理由）**：
  1. 仅 DashScope 的 Qwen 模型生效——本项目默认 LLM 是 DeepSeek，无法复用；
  2. **黑盒**：搜索在模型服务内完成，langgraph 流程中看不到工具调用、拿不到结果列表/来源结构化数据，无法做检索-增强的中间加工（如按时间/信源过滤后再喂分析）；
  3. 不可控搜索后端/无独立限流语义；
  4. 结论：作为"模型原生搜索"基线对照可以，但与本任务目标（工具调用型、可组合可观测）不属同一形态。

---

## 3. 本网络实测汇总（2026-08-03，项目机器）

| 测试 | 结果 |
|---|---|
| api.tavily.com keyless 中文财经搜索 | 成功：4 条中文财经结果 + score |
| duckduckgo.com 裸 html/lite 端点 | 反爬挑战拦截 |
| ddgs SDK text/news（region=cn-zh） | 成功：中文财经结果 + 新闻日期 |
| www.baidu.com/s 裸抓取 | 百度安全验证墙（1488B） |
| python.langchain.com | 308 → docs.langchain.com |
| pip dry-run langchain-community / langchain-tavily | 均与 langchain 1.3.14 无冲突可装 |
| exa.ai / serper.dev / docs.searxng.org / bing.com / help.aliyun.com | 页面均可达（200/302） |

---

## 4. 结论：Top-2 推荐（结合本项目场景）

### 首选：Tavily（`langchain-tavily` 0.2.18）

理由（按权重）：
1. **LangChain 1.x 官方正路**：partner 包、有 1.x 文档 usage 页、TavilySearch 是标准 Tool，可直接挂进 langgraph-prebuilt 的 agent 工具列表；community 旧类已 @deprecated，不存在"选错集成路径"问题（任务原问题 1 的答案：1.x 下用 langchain-tavily，不是 community 旧路径）。
2. **中文财经实测达标**：本网络 keyless 实测返回澎湃/21 财经/证券周刊等 A 股相关源，带 content 片段与 score——直接喂 LLM 可用，且 `topic="finance"` + `time_range` 参数契合 A 股新闻/公告/舆情场景。
3. **成本友好**：1000 积分/月免费（≈1000 次 basic 搜索，月内足够开发与低频实盘）；起步阶段连 key 都可以不申请（keyless 零配置），需要时再升级；超出后 $0.008/次也不贵。
4. **失败模式可控**：429 + retry-after 语义明确，配合项目现有降级风格（工具失败返回占位文本不 raise，见 `core/llms/tools/get_market_intel.py`）可做成 主 Tavily → 降级 DDG → 再降级占位文本 的三级链。
5. API 从本服务器发出，中国网络可达已实测。

### 次选：DuckDuckGo（community `ddg_search` + `ddgs` SDK）

理由：
1. **零成本兜底**：无 key 无配额，实测 cn-zh text+news 均出中文财经结果，作为 Tavily 的免费降级层合理。
2. 必须接受的代价：community 已停更（不随 DDG 接口变化修 bug）、不在 1.x 文档、裸端点反爬（靠 ddgs SDK 内部处理）；因此定位为"降级/备胎"，不作为唯一来源。

### 明确不选及理由

- **Bing**：2025-08-11 已全量退役，无 key 可申请（官方公告）。
- **Baidu**：裸抓取实测撞验证墙；无官方公开 API；爬虫维护成本与封禁风险不成比例。
- **SearxNG**：需自托管运维 + 中国 IP 出站引擎风控风险 + community 停更；适合有强隐私/完全可控诉求的团队，本项目无此诉求。
- **Exa**：1.x 官方包、质量口碑好，但中文覆盖**无官方证据**（未验证）且免费额度按次消耗快（$7/1k），作为 A 股中文查询主源风险未消。
- **Serper**：中文覆盖靠 Google 索引，但需付费且 community 停更、pricing 页 404（定价透明度下降）。
- **DashScope enable_search**：仅 Qwen 路径、黑盒、非工具调用——保留为对照组基线，不进入工具链。
- 补充观察：Perplexity（`langchain-perplexity`，1.x 官方包，PerplexitySearchResults）付费制（Sonar 约 $6–14/1k）[来源: https://docs.perplexity.ai/docs/getting-started/pricing]，成本结构不适合本项目的每日中文财经查询量级。

---

## 5. LangChain 1.3.x 集成代码形状（对应上面两个推荐 + 备查）

### Tavily（推荐，1.x 官方路径）

```bash
pip install langchain-tavily
export TAVILY_API_KEY=...        # 也可先不配 key，走 keyless 头
```

```python
from langchain_tavily import TavilySearch

tool = TavilySearch(max_results=5, topic="finance", time_range="month")
result = tool.invoke({"query": "贵州茅台 最新公告 业绩"})
# result.content 为 JSON 字符串：results[] 含 title/url/content/score，可选 answer/raw_content
# 与 langgraph-prebuilt 组合：agent = create_agent(model, tools=[tool])
```

keyless 兜底（未申请 key 时）：社区包不暴露 keyless 头，可用 langchain-core 的 `@tool` 包一层 requests 调 `POST https://api.tavily.com/search`，头 `X-Tavily-Access-Mode: keyless`（见第 2.1 节来源）。

### DuckDuckGo（次选，community 停更路径，使用时需自担维护）

```bash
pip install -qU langchain-community ddgs
```

```python
from langchain_community.tools.ddg_search import DuckDuckGoSearchResults
from langchain_community.utilities.duckduckgo_search import DuckDuckGoSearchAPIWrapper

tool = DuckDuckGoSearchResults(
    api_wrapper=DuckDuckGoSearchAPIWrapper(region="cn-zh", max_results=5),
    output_format="json",
)
result = tool.invoke("贵州茅台 新闻")   # JSON 字符串：title/href/snippet（news 源另有 date）
```

### 备查：SearxNG / Exa / Serper / 基线

```python
# SearxNG（community）：SearxSearchResults(wrapper=SearxSearchWrapper(searx_host="http://localhost:8888"), num_results=5)
# Exa（1.x 官方）：from langchain_exa.tools import ExaSearchResults   # 需 EXA_API_KEY
# Serper（community）：from langchain_community.tools.google_serper import GoogleSerperResults  # 需 SERPER_API_KEY
# Qwen 基线：ChatOpenAI(base_url="https://dashscope.aliyuncs.com/compatible-mode/v1", model="qwen-plus") + extra_body={"enable_search": True}
```

---

## 6. Caveats / Not Found

- **Exa 中文覆盖**：官方文档无语言/区域覆盖声明，属"未验证"，建议若考虑 Exa 先用免费 $20 实测中文财经查询。
- **SearxNG 从中国 IP 出站对 Google/Bing 引擎的表现**：未实测（本项目无自建实例），标注为风险。
- **Baidu 官方 API 是否存在**：未找到面向开发者的公开网页搜索 API 文档；此点基于检索结论（无来源），如需确证可进一步查百度智能云文档。
- **Serper 当前公开定价页 404**（实测），第三方数据（apiserpent 2026-07）仅供参考，最终以账户内报价为准。
- **Tavily keyless 限流数值**：官方仅说"free and rate-limited"，未公开具体 RPM。
- ddgs 的 region 代码表以 PyPI ddgs README 为准（cn-zh 实测有效）。
- 各价格均为抓取时点（2026-08-03）数据，供应商可能调整。

## 7. 主要来源清单

- LangChain 1.x 官方文档：docs.langchain.com（tavily / exa_search / perplexity / all_providers / tools/tavily_search 页面）
- langchain-community 停更公告：github.com/langchain-ai/langchain-community（README）+ issues/674；PyPI langchain-community 0.4.2
- Tavily：tavily.com/pricing；docs.tavily.com（rate-limits / keyless / api-reference/endpoint/search）
- DuckDuckGo：pypi.org/project/ddgs（9.14.4）；pypi.org/project/duckduckgo-search（8.1.1，停更）
- Bing：learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement；theverge.com/news/667517
- SearxNG：docs.searxng.org（admin/engines.html）
- Exa：exa.ai/pricing；exa.ai/docs/reference/rate-limits；exa.ai/docs/reference/pricing
- Serper：serper.dev；apiserpent.com/blog/serper-pricing-credits-explained
- DashScope：help.aliyun.com/zh/model-studio/web-search
- 本项目：requirements.txt（langchain==1.3.14 等）；core/llms/qwen/qwen_api.py；core/llms/tools/get_market_intel.py（降级风格参照）
