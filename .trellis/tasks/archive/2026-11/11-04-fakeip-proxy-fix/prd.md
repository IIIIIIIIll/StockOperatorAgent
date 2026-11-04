# PRD: fake-IP 代理环境 LLM 恒 403(SSRF 防线误拦 + 错误分流)

## 现象

用户在设置面板配好 LLM 三键(火山方舟 `ark.cn-beijing.volces.com`,
model `deepseek-v4.1-flash`)后点「保存配置」,恒显示
`LLM 不可达:认证失败(HTTP 403)——检查 API Key`,换 key 无效。

## 根因(2026-11-04 实证)

1. 用户机器处于 **fake-IP 代理环境**(Clash/mihomo):`getent hosts
   ark.cn-beijing.volces.com` → `198.18.18.50`(RFC 2544 benchmark 占位段)。
2. `app/lib/proxies.cjs` 的 SSRF 防线把 198.18/15 判为保留段 →
   `pinPublicHost()` 返回 null → `/llm-proxy` 直接回 403,**请求未出本机**
   (7ms;直连同一 host 实为 401/72ms)。
3. `app/lib/settings.ts` 的 `classifyChatResponse` 把任何 401/403 JSON
   一律显示为「认证失败 —— 检查 API Key」,并丢弃响应体 → 代理拒绝被误认为
   key 错误,用户无法自诊断。

## 修复

- `proxies.cjs`:新增 `isFakeIpAddress()`(198.18.0.0/15,含 IPv4-mapped 形);
  `pinPublicHost` 对 fake-IP 占位地址放行,其余私网判定不变(混合应答按最严)。
  用户已显式确认接受该放宽(内网使用 198.18/15 的边缘风险)。
- `settings.ts`:`classifyChatResponse` 导出以便测试;401/403 分流 ——
  代理信封 `{error: string}` → 「代理拒绝(HTTP n):原因」;上游
  `{error:{code,message}}` → 「认证失败」+ code/message;纯文本 → 截断透传。
- 同步 `.trellis/spec/ts/events-streaming.md` 安全契约节。

## 验收(已通过)

- [x] `test/proxies.test.ts`:`https://198.18.18.50/v1` 经代理放行(200);
      `isFakeIpAddress` 边界(198.17/198.20/10.x/127.x/::1 均 false);真私网仍 403。
- [x] `test/settings-llm-classify.test.ts`:代理拒绝 / 上游认证失败 / 明文 403 / 200 四路。
- [x] 实机:同 DNS 下 `/llm-proxy` 由 `403(7ms,本地拒绝)` 变为
      `401(93ms,Ark AuthenticationError)`;UI 显示
      `认证失败(HTTP 401)——检查 API Key(上游:AuthenticationError: The API key format is incorrect...)`。
- [x] `npx vitest run` 731 passed / 0 failed;`npx tsc --noEmit` 0 error。

## Notes

- 用户侧动作:重启托管进程(server.mjs 或 expo start)以加载新 `proxies.cjs`;
  web 产物需重新 export 才能拿到新的提示文案。
- 未采用方案:DoH 反查真实 A 记录后再判私网(保留校验能力,但多一次外部依赖)、
  域名白名单 env(最小面但需手工配置)——用户选择直接放行段。
