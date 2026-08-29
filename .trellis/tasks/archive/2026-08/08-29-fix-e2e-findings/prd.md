# PRD: 修复 e2e findings（F1 亿信 fetch 绑定 / F2 TDX MCP 同源代理 / tsconfig 防复发）

## Goal

修复 08-29-e2e-full-features 实证发现的产品问题，随后注入用户提供的 Finnhub key
完成 finnhub 增强路径验证。

## Scope

- **F1（产品 bug）**:web 端亿信五能力全灭——`src/billionsClient.ts` 构造器
  `this._fetch = opts.fetch ?? globalThis.fetch` 后以方法形式 `this._fetch(...)`
  调用,Chrome 强制 fetch 的 this===Window → Illegal invocation（e2e 实测复现）。
  修复为裸调用包装;注入的 fake fetch 原样保留（测试兼容）。
- **F2（web 端不可用）**:TDX MCP 浏览器直连 `mcp.tdx.com.cn:3001` 被 CORS
  阻断（预检无 ACAO 头,e2e 实测）→ 加同源 `/tdx-mcp` 代理:
  - server 侧 `app/lib/proxies.cjs` 新增 `handleTdxMcp`（固定目标转发,零 SSRF 面;
    请求头白名单 tdx-api-key/content-type/accept/mcp-session-id;响应流式透传
    SSE + content-type/Mcp-Session-Id 透传;body 上限 1MB;60s race 提前 504
    不打断 in-flight,对齐 W4）;
  - 双入口挂载（`app/metro.config.js` dev 中间件 + `app/server.mjs` 生产）;
  - 客户端 `src/mcp.ts` 新增 `makeProxyMcpFetch(base)`（web 端同源代理 fetch,
    头白名单组装,对齐 makeProxySearcher 先例）;
  - `app/lib/runner.ts` `makeMcpIntel` web 平台注入 proxy fetch（detectPlatform
    + location.origin 守卫,对齐 collectForWeb 模式）;Node/RN 维持直连。
- **tsconfig 防复发**:`expo export/start` 会把 `app/tsconfig.json` 重写为
  `extends "expo/tsconfig.base"`（破坏 vitest 转换所需内联选项,CI 无
  app/node_modules/expo 会 [TSCONFIG_ERROR];08-29 e2e 实证被覆盖一次）→
  `tools/restore-app-tsconfig.mjs` 校验恢复内联版 + 挂载到
  `app/package.json` "web" 脚本与 `.github/workflows/release.yml` export 步骤后。
- **finnhub 验证**:key `d2ps8spr01qnf9nmf77gd2ps8spr01qnf9nmf780` 已实测有效
  （profile2 返回 Apple Inc）;修复完成后注入 settings 重跑 web us AAPL 全流程
  （一次运行同时验证 F1 亿信 web 修复 + F2 MCP 代理 + finnhub companyProfile2
  合并）。

## Acceptance Criteria

- **AC-F1**:`new BillionsClient()`（不注入 fetch）在 this 敏感环境下调用不抛
  Illegal invocation;测试断言默认 fetch 以无 this 方式调用。
- **AC-F2**:/tdx-mcp 转发固定目标、白名单头、SSE 透传、Mcp-Session-Id 透传、
  413/502/504 路径有测试;web 端 makeProxyMcpFetch 组装与头过滤有测试;双入口
  挂载生效（dev + 生产）。
- **AC-TS**:restore 脚本对「被 expo 重写」与「未改写」两态正确;`npm run web`
  与 CI export 后自动恢复。
- **AC-V**:`npx vitest run` 全绿（含新增用例）、`npx tsc --noEmit` 0 错误、
  `npm run chart:build && chart:check` 通过。
- **AC-E2E**:web us AAPL 重跑——亿信请求不再 Illegal invocation（有真实响应或
  上游 502 语义）、TDX MCP 情报段落不再「查询异常」（代理转发成功或如实记录
  新失败形态）、报告含 finnhub 行业字段（companyProfile2 合并
  overview.industry）。

## Constraints

- 密钥纪律:报告/工件掩码;finnhub key 仅运行时注入。
- F3（亿信/DDG 上游 502 间歇）与 F4（环境 gotcha）非产品缺陷,不在本任务范围。
- 不引入新依赖;house style 无 mock 框架（fetch 注入点）。
- 单次 LLM 计费运行（AAPL web 重跑）;失败记因不计败。
