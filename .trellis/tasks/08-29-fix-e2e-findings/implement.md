# Implement: 修复 F1/F2/tsconfig + finnhub 验证

## 阶段 1:实现（派发 trellis-implement）

1. [ ] F1:`src/billionsClient.ts` 构造器 fetch 裸调用包装。
2. [ ] F2-客户端:`src/mcp.ts` `makeProxyMcpFetch(base)` + `app/lib/runner.ts`
      `makeMcpIntel` web 分支注入。
3. [ ] F2-服务端:`app/lib/proxies.cjs` `handleTdxMcp`（固定目标/白名单/SSE 透传/
      Mcp-Session-Id/413/502/504）;`app/metro.config.js` + `app/server.mjs` 挂载。
4. [ ] tsconfig 防护:`tools/restore-app-tsconfig.mjs` + app/package.json "web" +
      release.yml export 后调用。
5. [ ] 测试:billions-client（F1 this 回归）/ mcp（proxy fetch 组装）/
      proxies（handleTdxMcp 六路径）。

## 阶段 2:门控验证

6. [ ] `npx vitest run` 全绿;`npx tsc --noEmit` 0 错误;chart 双门。
7. [ ] export 后 tsconfig 被改写 → restore 脚本恢复 → git 干净（防复发实证）。

## 阶段 3:E2E 重验（web us AAPL,含 finnhub）

8. [ ] 构建 + 托管;注入 settings（三键 + TDX + 亿信 + finnhub key + 全开关）。
9. [ ] AAPL us 全流程:亿信无 Illegal invocation;MCP 代理转发实证（情报段落/
      代理日志）;finnhub 行业字段实证;D15 终态。
10. [ ] 报告:findings 修复状态 + finnhub 验证结果;密钥掩码。

## 阶段 4:收尾

11. [ ] trellis-check → commit → 归档。

## 验证命令速查

- 门控:`npx vitest run`;`npx tsc --noEmit`;`cd app && npm run chart:build && npm run chart:check`。
- 托管:`cd app && node --experimental-strip-types server.mjs`（默认 127.0.0.1:8090,
  env 注入根 .env 键）。
- 注入校验:reload 后 localStorage 回显掩码 + 无「演示模式」。

## 回滚点

各改动独立可回退;Node/RN 直连路径不变,web 代理失败降级同旧。
