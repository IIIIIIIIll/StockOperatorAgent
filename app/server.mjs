// 生产 web server:静态服务 dist + 同源代理接线(/llm-proxy/* /tdx-collect /web-search)
// 用法:npx expo export --platform web && node --experimental-strip-types server.mjs(默认 8090)
// 代理实现全部收敛在 lib/proxies.cjs(与 metro dev 中间件共享,单份防漂移);
// 日志汇聚见 lib/logs-server.cjs。浏览器无原始 TCP,TDX 采集由本 server(Node)执行。
// createAppServer() 导出供桌面主进程复用(返回 server,listen 由调用方控制);
// serveStatic 导出供 vitest 单测;直跑入口的 listen 仅主模块执行(isMain 守卫)。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleLlmProxy, handleTdxCollect, handleWebSearch, handleYahooCollect } from './lib/proxies.cjs';
import { handleLogs } from './lib/logs-server.cjs';
import { envValue } from '../src/env.ts';

const PORT = Number(process.env.PORT || 8090);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

// S5:CSP 静态面(与 proxies.cjs SEC_HEADERS 同值,单份策略防漂移;style-src
// 'unsafe-inline' 为 expo-reset 内联 <style>,img-src data: 供内联图元)。
const SEC_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; connect-src 'self' https:; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'self'",
  'X-Content-Type-Options': 'nosniff',
};

/** C1:畸形 URL(如 /%ZZ)decodeURIComponent 抛 URIError → 400 不崩 server。
 *  导出供 vitest 单测;本模块 import 侧无副作用(listen 仅主入口执行)。 */
export function serveStatic(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }
  try {
    // F29:existsSync→statSync 竞态/读流异常同步抛出会击穿 listener → 整块
    // try/catch(500 兜底,进程存活);下面 stream 'error' 异步路径同样兜底。
    let file = path.join(DIST, urlPath === '/' ? 'index.html' : urlPath);
    // F28:锚定 DIST+sep —— 裸 startsWith 会放行 path.join 归一化后逃逸到
    // 兄弟目录的路径(如 '/a/distX/…' 共享 '/a/dist' 字符串前缀)
    if (!file.startsWith(DIST + path.sep)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(DIST, 'index.html'); // SPA fallback
    }
    // dist 未构建(CI 测试/裸跑 server)或缺 index.html:回 404 带安全头,而非
    // 直接 destroy——destroy 会以半截连接结束(客户端 fetch 报
    // UND_ERR_SOCKET: other side closed,CI 实测 08-29)。stream error
    // destroy 分支保留给 stat 之后读流中途失败(文件被删/IO 错)。
    if (!fs.existsSync(file)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SEC_HEADERS });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      ...SEC_HEADERS,
      // S5:index.html no-cache(SPA 每次校验);内容哈希命名的静态资源可长缓存
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    const stream = fs.createReadStream(file);
    stream.on('error', () => {
      // 读流中途失败(文件被删/IO 错):连接终止,不抛未处理 error 崩进程
      res.destroy();
    });
    stream.pipe(res);
  } catch {
    if (!res.headersSent) {
      res.writeHead(500);
      res.end('Internal Server Error');
    } else {
      res.destroy();
    }
  }
}

/** A6:Host 头判定(DNS rebinding 硬化)——仅接受 loopback:localhost /
 *  127.0.0.0/8 / [::1](含 IPv4-mapped ::ffff:127.0.0.1),端口可有可无,
 *  大小写不敏感;缺失或非 loopback(攻击者域名)→ false。模块私有:
 *  纯入站策略,不导出(d.ts 声明零漂移)。 */
function isLoopbackHostHeader(host) {
  if (typeof host !== 'string' || host === '') return false;
  let name = host;
  if (name[0] === '[') {
    const end = name.indexOf(']');
    if (end === -1) return false;
    const ipv6 = name.slice(1, end).toLowerCase();
    const rest = name.slice(end + 1);
    if (rest !== '' && !/^:\d{1,5}$/.test(rest)) return false;
    return ipv6 === '::1' || ipv6 === '::ffff:127.0.0.1';
  }
  const parts = name.split(':');
  if (parts.length > 2) return false; // 非方括号 IPv6 不合法
  if (parts.length === 2) {
    if (!/^\d{1,5}$/.test(parts[1]) || Number(parts[1]) > 65535) return false;
    name = parts[0];
  }
  const lower = name.toLowerCase().replace(/\.$/, ''); // 容忍 FQDN 尾点
  if (lower === 'localhost') return true;
  const octets = lower.split('.');
  return (
    octets.length === 4 &&
    octets.every((o) => /^\d{1,3}$/.test(o) && Number(o) <= 255) &&
    octets[0] === '127'
  );
}

/** 连接本地端点是否 loopback(判定 Host 校验启停;A6 见 createAppServer)。 */
function isLoopbackBind(addr) {
  return (
    typeof addr === 'string' &&
    (addr === '::1' || addr === '::ffff:127.0.0.1' || /^127\./.test(addr))
  );
}

/** S6:bind host 串是否回环(决定 token 门启停)。host 选项 / HOST env 的合法
 *  回环写法:'localhost'、127.0.0.0/8、'[::1]'(经 isLoopbackHostHeader)与
 *  裸 IPv6 回环 '::1' / '::ffff:127.0.0.1'(bind 串无方括号,isLoopbackHostHeader
 *  只认方括号形,需单列);其余('0.0.0.0'、网卡 IP 等)→ false。 */
function isLoopbackBindHost(h) {
  if (typeof h !== 'string' || h === '') return false;
  if (h === '::1' || h === '::ffff:127.0.0.1') return true;
  return isLoopbackHostHeader(h);
}

/** S2:代理端点 Origin 允许列表 —— 仅接受 无 Origin / null / 本站 origin
 *  (scheme+host 取自 Host 头,大小写不敏感)。跨站 fetch(带 Origin)→ 403 且
 *  零 CORS 头(读不到响应);表单 POST 同被拦。GET 简单请求(script/img 导航
 *  不带 Origin)不受影响。与 metro.config.js enhanceMiddleware 同款。 */
function isOriginAllowed(req) {
  const origin = req.headers.origin;
  if (origin === undefined || origin === null || origin === 'null') return true;
  const host = req.headers.host;
  if (typeof host !== 'string' || host === '') return false;
  const o = String(origin).toLowerCase();
  const h = host.toLowerCase();
  return o === `http://${h}` || o === `https://${h}`;
}

/** 生产 web server 工厂:静态服务 dist + 同源代理路由。导出供桌面主进程复用
 *  (返回 http.Server,监听与否由调用方决定)。路由体与旧模块级 createServer
 *  完全一致,行为零变化。
 *  @param opts.host 有效监听 bind host(如 '127.0.0.1')——S6 按**有效监听地址**
 *  判定是否要求 token;缺省取模块级 HOST env(直跑入口语义不变)。桌面 child
 *  显式传 '127.0.0.1',ambient HOST=0.0.0.0 无法污染回环监听。 */
export function createAppServer({ host } = {}) {
  // S6:token 要求派生自有效监听地址而非环境:host 选项优先,缺省回退 HOST env。
  // 回环判定用 isLoopbackBindHost(覆盖 '::1' 等裸 IPv6 回环 bind 串,2026-08-28)。
  const requireToken = !isLoopbackBindHost(host ?? HOST);
  return http.createServer((req, res) => {
    // A6:DNS rebinding 硬化 —— 连接经 loopback 到达时(默认 127.0.0.1 监听、
    // 桌面随机回环端口)校验入站 Host 头:攻击者域名解析到 127.0.0.1 后浏览器
    // 仍发原域名 → Host 非 loopback → 403,不打日志。允许 localhost /
    // 127.0.0.0/8 / [::1](含 IPv4-mapped),端口可有可无;X-Forwarded-Host 不信任
    // (不用)。仅作用于入站请求,proxies 转发逻辑不动;显式 HOST=0.0.0.0 远程
    // 暴露时连接本地端点非 loopback(如 192.168.x),不校验 —— Host 合法值含
    // 远程地址/域名,保持「生产远程访问显式设 HOST=0.0.0.0」既有契约。
    // 注意: 仅 http://localhost / 127.0.0.0/8 / [::1] 可直接访问;自定 hostname
    // 或反向代理(nginx → 127.0.0.1)需将入站 Host 改写为 127.0.0.1:port。
    if (isLoopbackBind(req.socket.localAddress) && !isLoopbackHostHeader(req.headers.host)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    // S2:全部 5 个代理端点统一 Origin 门(无 Origin/null/本站放行;跨站 → 403)
    const isProxyPath =
      req.url.startsWith('/llm-proxy/') ||
      req.url.startsWith('/tdx-collect') ||
      req.url.startsWith('/yahoo-collect') ||
      req.url.startsWith('/web-search') ||
      req.url === '/logs';
    if (isProxyPath && !isOriginAllowed(req)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    // S6:非回环监听(有效 bind host 非 loopback)时,代理/日志端点要求
    // X-SOA-Token == SOA_ACCESS_TOKEN(原始串比对,无 "Bearer " 前缀);
    // 未设 token → 恒 401(安全默认:宁缺勿开)。回环监听保持原行为,无需 token。
    // Authorization 头保留给 LLM 供应商 key(/llm-proxy 上游透传),本门不消费。
    if (isProxyPath && requireToken) {
      const token = req.headers['x-soa-token'];
      if (!ACCESS_TOKEN || token !== ACCESS_TOKEN) {
        res.writeHead(401, { 'Content-Type': 'application/json', ...SEC_HEADERS });
        res.end(JSON.stringify({ error: '未授权:非回环监听需 X-SOA-Token(SOA_ACCESS_TOKEN)' }));
        return;
      }
    }
    if (req.method === 'POST' && req.url.startsWith('/llm-proxy/')) {
      void handleLlmProxy(req, res);
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/tdx-collect')) {
      void handleTdxCollect(req, res);
      return;
    }
    if (req.method === 'POST' && req.url.startsWith('/yahoo-collect')) {
      void handleYahooCollect(req, res);
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/web-search')) {
      void handleWebSearch(req, res);
      return;
    }
    if (req.method === 'POST' && req.url === '/logs') {
      void handleLogs(req, res); // 日志汇聚(与 metro 中间件同实现,见 lib/logs-server.cjs)
      return;
    }
    serveStatic(req, res);
  });
}

// 监听默认仅回环 127.0.0.1(HOST env 可覆盖):同源代理/日志端点不暴露到局域网
// (SSRF/日志注入面收敛);生产远程访问显式设 HOST=0.0.0.0。
// isMain 守卫:vitest 单测 import 本模块(测 serveStatic)时跳过 listen 副作用。
// env 读取统一经 src/env.ts(envValue;server.mjs 为 Node-only 服务端,不入
// metro 图,但保持同一读取纪律)。
const HOST = envValue('HOST') || '127.0.0.1';
const ACCESS_TOKEN = envValue('SOA_ACCESS_TOKEN') ?? '';
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  createAppServer().listen(PORT, HOST, () => {
    console.log(`[soa] web server: http://${HOST}:${PORT} (静态 dist + /llm-proxy 代理 + /tdx-collect 采集代理 + /web-search 搜索代理 + /logs 日志汇聚)`);
  });
}
