// 同源代理/静态服务的共同安全头 —— 单源(CR-51)。
// 之前 app/server.mjs 与 app/lib/proxies.cjs 各写一份相同 CSP,注释却声称
// 「单份策略防漂移」;测试只 toContain 片段,单边改动不会红。收敛到此文件,
// 两端 require/import 同一个对象。
//
// style-src 'unsafe-inline' 为 expo-reset 内联 <style>(dist/index.html 实测),
// img-src data: 供内联图元;script-src 由 default-src 'self' 继承(无内联脚本)。
// frame-ancestors 'self' 防本地 SPA 被第三方 iframe 嵌入(clickjacking,2026-08-27)。
const SEC_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; connect-src 'self' https:; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'self'",
  'X-Content-Type-Options': 'nosniff',
  // 代理响应永不缓存(含 SSRF 判定后的敏感载荷);serveStatic 会用自身
  // Cache-Control 覆盖(no-cache / immutable)。
  'Cache-Control': 'no-store',
};

module.exports = { SEC_HEADERS };
