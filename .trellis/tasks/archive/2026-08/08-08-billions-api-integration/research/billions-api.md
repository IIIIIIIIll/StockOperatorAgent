# 亿信 Fin 开放平台 API 参考（研究存档，2026-08-08）

来源：`https://openapi.billionsintelligence.com/.well-known/api-catalog` 及 4 份
OpenAPI 规范。控制台：`https://openapi.billionsintelligence.com/console/`。

## 通用

- Base：`https://openapi.billionsintelligence.com/api`，全部 `POST`，
  `Content-Type: application/json`
- 鉴权：`X-API-KEY` 头（控制台创建，官方强调勿入库）；无 key/未订阅 → 401/403
- 语义：HTTP 200 仅表示已处理，业务成败看 `success` + `result[].status`；
  失败响应体 `{"success": false, "error": "..."}`
- 错误码：400 非 JSON / 401 key 无效 / 403 未订阅 / 422 参数校验 /
  429 限流配额 / 500 / 502 网关 / 504 后端超时（可重试）
- 慢档位（advanced/expert）后端等待可达 110s → 客户端超时建议 ≥120s
- 免费额度：twitter 30 次/天/用户；fetch url 30 次/天/用户；search/fin-db 按套餐

## 1. fin-db — POST /api/v1/fin_db（operationId queryFinDb）

| 字段 | 类型 | 说明 |
|---|---|---|
| query | string | 必填，1-2000 字符，自然语言问题 |
| data_sources | string\|string[] | 默认 "auto"；枚举：`A股财务行情数据库`/`海外财务行情数据库`/`宏观行业数据库`/`auto` |

响应：`{success, result:[{query, content(Markdown 表格), status, source}], error}`
示例 `{"query":"紫金矿业2024年12月20日当日的最高价(元)是多少？","data_sources":["A股财务行情数据库"]}`
官方 curl：`-H "X-API-KEY: $FIN_API_KEY"`，超时建议 120s。

## 2. search — POST /api/v2/search

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| query | string | — | 必填 |
| source | string | "web" | web/academic/image/video/announcement/report/expert |
| search_mode | string | "fast" | fast / advanced / expert |
| count | int | 10 | 1-50 |
| timeout | int | 15 | 1-120 服务端等待秒 |
| time_range | string | 无 | 如 "past 3 days"/"past 2 weeks"/"past 1 month" |

响应 `result[0].content[]`：`{title, link, snippet(≤500 字符), date(YYYY-MM-DD,
可空), extra:{doc_id(仅 announcement 开放), institution(仅 report 有)}`
- 研报无作者字段，机构看 `institution`；字段可能缺失，调用方容错
- 场景建议：公告 → announcement；研报 → report；专家观点 → expert
- 配额：time_range 优先于 count 控制结果量；advanced/expert 更慢，客户端
  超时 >120s

## 3. twitter — POST /api/v2/twitter/search

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| query | string | — | 必填 |
| search_mode | string | "fast" | fast(timeout 15)/advanced(60)/expert(110) |
| count | int | 10 | 1-50 |

响应 `result[0].content[]`：`{title("@user: 前缀"), link(x.com/...),
snippet(正文), date(北京时间), extra:{username, author_name, post_id,
view_count, profile_image_url}}`
- 旧路径 `POST /v2/search?source=twitter` 兼容保留
- 失败语义：上游超时 → HTTP 200 + `success:false` + `error`，可重试
- 免费期 30 次/天/用户，超限 429 次日恢复

## 4. fetch — POST /api/v2/fetch

| 字段 | 类型 | 说明 |
|---|---|---|
| url | string | http(s) 公共 URL；与 doc_id 互斥（二选一，都有/都无 → 422） |
| doc_id | string | search 结果 `extra.doc_id`，原样传入；announcement 全套餐可用；report/expert → 403 SOURCE_NOT_LICENSED |
| keyword | string | 仅配 doc_id；定位含关键词页 |
| page | int | ≥1，分页模式；超范围返回最后一页 |
| max_chars | int | 500-12000，默认 6000；显式传值进入分页模式 |

响应：`{success, type(web/document), id, source, title, content(Markdown,
分页前缀 [Page N/M]), pages[], total_pages, total_chars, truncated(>200k 截断),
error, code(INVALID_ARGUMENT/INVALID_DOC_ID/SOURCE_NOT_LICENSED/URL_NOT_ALLOWED/
UPSTREAM_ERROR)}`
- 官方 Python 示例：search timeout=60 → fetch timeout=90
- 建议流程：`/v2/search` → 取 link 或 doc_id → `/v2/fetch`

## 官方 Python 调用模式

```python
BASE = 'https://openapi.billionsintelligence.com/api'
HEADERS = {'X-API-KEY': os.environ['FIN_API_KEY']}
found = requests.post(f'{BASE}/v2/search', headers=HEADERS, json={
    'query': '宁德时代 固态电池 进展', 'source': 'web', 'count': 5}, timeout=60).json()
doc = requests.post(f'{BASE}/v2/fetch', headers=HEADERS, json={
    'url': found['result'][0]['content'][0]['link']}, timeout=90).json()
```
