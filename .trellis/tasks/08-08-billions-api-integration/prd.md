# 亿信 API 全端点接入

## Goal

将亿信 Fin 开放平台 4 端点接入 StockOperatorAgent，为决策补充信息面（公告/研报/
新闻/推特）检索、网页全文与自然语言金融问数能力。**因 API 配额与成本限制（用户
2026-08-08 明确要求），全部能力必须可选、可单独关闭；未启用时现有 agent 流程
零行为变化。**

## Background / Confirmed Facts

### 亿信 API（官方文档研究，2026-08-08，详见 research/billions-api.md）

- 网关 `https://openapi.billionsintelligence.com/api`，全部 `POST`，鉴权
  `X-API-KEY` 请求头（官方强调勿写入代码仓库）
- HTTP 200 仅表示已处理；业务成败看 `success` + `result[].status`；错误码
  401/403/422/429/500/502/504；客户端超时建议 ≥120s（expert 档后端等待 110s）
- 4 端点：`fin-db`(v1，自然语言问数，`query`+`data_sources` auto 路由，返回
  Markdown 表格)、`search`(v2，`source` web/academic/image/video/announcement/
  report/expert，`search_mode` fast/advanced/expert，`count` 1-50，`time_range`)、
  `twitter`(v2/twitter/search，三档深度，返回 username/view_count 等)、
  `fetch`(v2，`url` 或公告 `doc_id`，分页模式，200k 字符截断)
- 免费额度：twitter 30 次/天/用户、fetch url 30 次/天/用户；search/fin-db 按
  套餐计费；429 为配额上限
- 已知限制：report/expert 的 `doc_id` 全文未开放（仅 announcement 可全文）；
  研报 `extra.institution` 为机构名、无作者；响应字段允许缺失，调用方需容错

### 项目现状（Explore 结论，2026-08-08）

- agent 流程：3 专家（读 `stock_information`，无工具）→ 多空交易员对抗（绑
  `web_search`）→ 投资经理（绑 `web_search`）；工具循环 `tool_loop.py` 15 轮
  上限、失败占位不崩溃；prompt 已含"可使用联网搜索工具"引导语
- 前置数据槽：`build_stock_information`（`investment_committee.py:20-50`）拼接
  4 段文本（个股信息/趋势/财务指标/实时情报），全专家可见；`web_search` 模式：
  `_searcher` 注入、失败占位、`WEB_SEARCH_DISABLED` 开关（`("","0","false","no")`
  语义）、`_llm`/`today` 等注入点、无 mock 框架、e2e FakeGraph 镜像
- 密钥约定：`.env` + 调用点 `os.getenv` + 缺失占位降级（`TDX_API_KEY` 模式）；
  仅 `DEEPSEEK_API_KEY` 被 UI 检查；日志不记录密钥

## Requirements

- **R1 客户端层**：`BillionsClient` 薄包装 4 端点（httpx、`X-API-KEY`、显式超时、
  响应字段归一化），失败不抛异常、按 data_source 约定降级
- **R2 可选性（用户硬性要求）**：
  - 主闸 `BILLIONS_API_KEY`：未配置 → 全部亿信能力关闭，现有流程零变化
  - 总闸 `BILLIONS_DISABLED` + 能力级开关
    `BILLIONS_{FINDB,SEARCH,TWITTER,FETCH,ANALYST}_DISABLED`（truthy 语义对齐
    `WEB_SEARCH_DISABLED`）
  - LLM 工具每次 run 调用硬上限（默认 search 3 / twitter 2 / fetch 3，可 env 覆盖）
- **R3 fin-db 前置槽位**：`get_billions_financial_intel(ticker)` 追加为
  `stock_information` 第 5 段（开关开时）
- **R4 LLM 工具三件套**：billions_search / billions_twitter / billions_fetch 绑
  多空交易员 + 投资经理（复用 tool_loop 与 web_search 模式：注入点、占位降级、
  计数上限）
- **R5 信息面分析师**：新 graph 节点（与 3 专家并行），**确定性预抓 + LLM 总结**
  （用户选定）：公告/研报/新闻/推特各 1 次检索（fast、count=5、time_range
  past 3 months），失败源跳过；LLM 撰写带来源的信息面报告；输出
  `information_analysis` State key + 独立报告 Tab
- **R6 密钥与日志纪律**：`.env`/`.env.example` 新增 `BILLIONS_API_KEY`；调用点
  读取；不写日志、不入库、不进 UI 检查
- **R7 测试**：注入点风格（`_client`/`_searcher`/`_fetcher`/`_llm`）、离线 golden
  单测、工具计数上限测试、分析师 LLM 注入测试、e2e 新 Tab 镜像 + 无 key 时
  不出现新 Tab

## Out of Scope

- report/expert 的 `doc_id` 全文（上游未开放）
- image/video/academic 的专门接线或默认检索序列（search 工具 `source` 枚举天然
  支持，本期不做专门产品化）
- 检索结果持久化到 ZODB（只进对话上下文与报告文本）
- 套餐/费率自动切换、用量报表
- 信息面分析师启用而 search/twitter 均关闭的组合（视为分析师不可用，不产出）

## Acceptance Criteria

- [ ] AC1 未配置 `BILLIONS_API_KEY`：全部亿信功能静默关闭；committee 图结构与
      今天一致（无分析师节点/边、tools 列表不变、无新 Tab）；现有全量测试
      （基线 0F/308P/20S）+ e2e 零回归
- [ ] AC2 配置 key 且开关开启：4 端点可调；billions 工具可被 LLM 调用并返回带
      来源的检索结果；信息面分析师产出带来源/日期的 Markdown 报告，进入独立
      Tab；fin-db 段出现在 `stock_information`
- [ ] AC3 每个能力独立开关：关闭后对应工具不绑定 / 分析师节点不入图 /
      前置段为空串，其余能力不受影响
- [ ] AC4 错误降级：429/401/5xx/超时/网络错误 → `logger.warning` + 占位文本，
      不崩溃、不阻塞 agent 流程；fin-db 失败不写入 `stock_information`
- [ ] AC5 调用上限：单次 run 内每工具调用超上限后返回占位提示，不再发真实请求
- [ ] AC6 测试覆盖：client 离线 golden、工具注入/计数测试、分析师 LLM 注入
      测试、fin-db 前置段注入测试、e2e 新 Tab 镜像 + 零真实 API 调用审计断言
