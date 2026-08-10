# 设计：信息面分析师接入免费联网搜索回退（web-search proxy + DDG）

## 目标形态

信息面分析师的素材来源从「仅亿信」扩展为「亿信优先、免费联网搜索兜底」：

```
_prefetch(ticker)
├─ 亿信路径（SEARCH/TWITTER 开关开且有结果）→ 公告/研报/新闻/推特 4 节（现状）
├─ 亿信不可用/全部失败/全部无结果 → 联网搜索路径（DDG，免 key）
│    ├─ Python: web_search 工具（DuckDuckGo cn-zh）
│    └─ TS web: /web-search 同源代理 → Node 侧 DDG
└─ 联网搜索也失败/空 → 现有固定回退文本（逐字不变）
```

启用谓词（装配与 Tab 共用单点）从「亿信 ANALYST 且 SEARCH/TWITTER」放宽为
「亿信路径 **或** 联网搜索路径」：

```python
def information_analyst_enabled() -> bool:
    billions_path = billions_enabled("ANALYST") and (
        billions_enabled("SEARCH") or billions_enabled("TWITTER"))
    web_path = web_search_enabled()          # DuckDuckGo 免 key
    return billions_path or web_path
```

- 有 key + 亿信开 → 走亿信（现状逐字节不变，AC1/AC5）。
- 无 key + 联网搜索开（默认）→ 注册分析师，预抓走 DDG（AC2）。
- 无 key + 联网搜索关 → 不注册（7 tab，与今日一致，AC3）。

## 数据流（TS web 版）

```
浏览器 App.tsx
  └─ runner.run → makeInvestmentDecision
       └─ BillionsInformationAnalyst.information_analyst
            └─ _prefetch: searcher(query)
                 ├─ web: fetch('/web-search?q={ticker} 最新新闻')   ← 同源代理
                 │        server.mjs /web-search → ddgSearcher (Node) → {results}
                 └─ Node/真机: ddgSearcher 直连（或 Tavily，若配 key）
            └─ completeExpert(query 含素材节) → information_analysis State key
```

## 边界与兼容

- **字节一致性**：亿信路径的查询构建/报告上下文/State key 全部不动；联网回退的
  失败占位文本与现有 `（本次运行未检索到任何信息面素材：所有来源均不可用或未启用）`
  逐字一致（TS 桩文本与 Python 无素材文本本就相同）。
- **开关语义**：`WEB_SEARCH_DISABLED` 是唯一联网总闸（Python `web_search_enabled()`
  与 TS `webSearchEnabled()` 语义对齐）。亿信开关族不变；亿信路径优先于联网路径。
- **成本**：回退仅在亿信无素材时触发（固定 1–3 次 DDG 查询，免费、无配额）。
- **e2e**：`mock_committee.MOCK_REPORTS` 已含 `information_analysis`（08-08 Step 5），
  FakeGraph 无条件吐全量 State——无 key 服务器现会渲染信息面 Tab（8 tab）。
