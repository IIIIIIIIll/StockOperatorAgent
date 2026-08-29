# 修复报告:F1/F2/F5 + finnhub 验证(2026-08-29)

任务:08-29-fix-e2e-findings · 修复 e2e findings + finnhub 验证

## 1. 修复清单

### F1(产品 bug):web 亿信 fetch 绑定 —— 已修
- `src/billionsClient.ts` 构造器:`this._fetch = opts.fetch ?? ((input, init) => fetch(input, init))`
  (裸调用,this===undefined,满足 Chrome fetch 约束;注入 fake 零变化)。
- 验证:重跑 web AAPL——亿信错误从 `Illegal invocation` 变为 `Failed to fetch`
  (fetch 正常发出,暴露真实网络层);单测新增 this 捕获用例。

### F2(web TDX MCP CORS 阻断):同源 /tdx-mcp 代理 —— 已修
- `src/mcp.ts` `makeProxyMcpFetch(base)`:白名单头(tdx-api-key/content-type/
  accept/mcp-session-id)同源代理 fetch。
- `app/lib/runner.ts` `makeMcpIntel`:web 平台注入 proxy fetch(Node/RN 直连不变)。
- `app/lib/proxies.cjs` `handleTdxMcp`:固定目标零 SSRF 面 + W2 1MB 上限 +
  头白名单 + R4 SSE 流式透传 + Mcp-Session-Id 透传 + 60s race 504 不打断
  in-flight + 502 归一化。
- 双入口挂载(metro.config.js dev + server.mjs 生产)。
- **端到端实证**:`/tdx-mcp` initialize 200 + SSE 握手(wenda-mcp-server 1.0.0);
  会话 ID 透传后 tools/call 200 + 真实 TDX 行情(600036 实时/所属行业/主力净额/
  概念)。单测 7 例(固定目标/白名单/流式/会话头/413/502/504)。

### F5(新增发现):web 亿信实际响应无 CORS 头 —— 已修
- 诊断:亿信 OPTIONS 预检 204 有 ACAO 头、**实际 POST 响应无 ACAO** → 浏览器
  CORS 拦截(status 0/Failed to fetch);fin_db 偶发 200(响应带头)。
- 修复:`src/billionsClient.ts` `makeProxyBillionsFetch(base)`(URL 改写 +
  头白名单 x-api-key/content-type/accept);`app/lib/runner.ts` `webBillionsFetch()`
  单点判定 + 三处接线(makeBillionsIntel / assembleTools / useAnalysis 工厂);
  `app/lib/proxies.cjs` `handleBillionsProxy`(固定 host + path 白名单四端点
  零 SSRF 面 + 头白名单 + 1MB + 502);双入口挂载。
- **端到端实证**:`/billions-proxy/api/v2/search` 200 + 真实搜索结果
  (招商银行 600036 条目);无 key → 401 透传真实上游错误。单测 4 例。

### tsconfig 防复发 —— 已修
- `tools/restore-app-tsconfig.mjs`:expo export/start 把 app/tsconfig.json 重写为
  extends 模板时原样恢复内联版(两态实测:未改写→跳过;改写→字节级恢复)。
- 挂载:app/package.json "web" 脚本 + release.yml export 步骤后。
- 本次两次 export 均未改写(注释行命中不影响),防复发路径 agent 已往返实证。

## 2. finnhub 验证(用户提供 key)

- key `d2ps8spr01qnf9nmf77gd2ps8spr01qnf9nmf780` 实测有效(profile2 直接调用
  返回 Apple Inc 完整数据;非重复粘贴)。
- **web us AAPL 全流程重跑(第 6 次 LLM 运行)**:D15 终态 ✓ 分析完成(60 步)
  + 全角色完成 + 真实 LLM;finnhub `companyProfile2?symbol=AAPL` 浏览器直连
  **200(915ms,CORS 无阻)**;`mergeFinnhubIndustry`(us+key → profile2 →
  overview.industry 合并)代码路径确认执行;报告含 Apple/USD 数据。
- 采集链其余:Yahoo 代理 11519 根日K。

## 3. 门控

- `npx vitest run`:684 passed / 2 skipped(新增 10+4 例)。
- `npx tsc --noEmit`:0 错误。
- `npm run chart:build && chart:check`:OK,F31 镜像一致。
- git 状态:仅预期文件;app/tsconfig.json 零 diff。

## 4. 遗留说明

- 亿信上游间歇 502(F3)与 DDG 间歇 502:上游问题,应用侧优雅降级(未修,非缺陷)。
- TDX MCP/亿信代理的**分析内完整链路**(下次 cn 全流程可实证:web 情报段应出现
  真实 MCP 数据、亿信素材应入信息面)——本次以 curl 端到端 + 单测覆盖,
  浏览器客户端侧由 makeProxyMcpFetch/makeProxyBillionsFetch 单测覆盖。
- 安卓侧(无 CORS)本次未重跑——F1/F2/F5 均为 web 平台问题,安卓不受影响
  (上轮已实证安卓亿信正常)。

## 5. 资产

- assets/tdx-mcp-init.json、tdx-mcp-tools-call.json(MCP 代理真实查询)
- assets/billions-proxy-search.json(亿信代理真实搜索)
- assets/web-us-fix-final.txt(AAPL 重验报告全文)
- 密钥全掩码;finnhub key 仅运行时注入。
