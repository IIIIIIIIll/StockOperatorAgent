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
import {
  handleLlmProxy,
  handleTdxCollect,
  handleWebSearch,
  handleYahooCollect,
  handleTdxMcp,
  handleBillionsProxy,
} from './lib/proxies.cjs';
import { handleLogs } from './lib/logs-server.cjs';
import secHeaders from './lib/sec-headers.cjs';
import { isLoopbackBind, isLoopbackHostHeader, isLoopbackBindHost, proxyGate } from './lib/request-gate.cjs';
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

// S5:CSP 静态面与代理面共用 app/lib/sec-headers.cjs 单源(CR-51);
// style-src 'unsafe-inline' 为 expo-reset 内联 <style>,img-src data: 供内联图元。
export const SEC_HEADERS = secHeaders.SEC_HEADERS;

/** C1:畸形 URL(如 /%ZZ)decodeURIComponent 抛 URIError → 400 不崩 server。
 *  导出供 vitest 单测;本模块 import 侧无副作用(listen 仅主入口执行)。 */
export function serveStatic(req, res, distRoot = DIST) {
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
    let file = path.join(distRoot, urlPath === '/' ? 'index.html' : urlPath);
    // F28:锚定 DIST+sep —— 裸 startsWith 会放行 path.join 归一化后逃逸到
    // 兄弟目录的路径(如 '/a/distX/…' 共享 '/a/dist' 字符串前缀)
    if (!file.startsWith(distRoot + path.sep)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(distRoot, 'index.html'); // SPA fallback
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
    // S2 / CR-53 / S6:代理路径统一门(Origin → Sec-Fetch-Site → 非回环时 X-SOA-Token)。
    // 单源实现在 lib/request-gate.cjs —— 与 dev 入口 metro.config.js 共用,防止两处
    // 各写一份而漂移(评审 2026-11-08 S8-1/S9-3:dev 入口此前只有 Origin 判据)。
    const gate = proxyGate(req, { requireToken, accessToken: ACCESS_TOKEN });
    if (gate) {
      res.writeHead(gate.status, gate.headers);
      res.end(gate.body);
      return;
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
    if (req.method === 'POST' && req.url.startsWith('/tdx-mcp')) {
      void handleTdxMcp(req, res);
      return;
    }
    if (req.method === 'POST' && req.url.startsWith('/billions-proxy')) {
      void handleBillionsProxy(req, res);
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
  // 兜底(S9-1 评审 2026-11-08):代理 handler 内部已各自 try/catch,但任何遗漏的
  // 路径(浏览器中途断开、上游 socket 销毁)都不应该打死整个静态服务器。
  // 记录堆栈后继续服务;真正的 bug 仍能从 stderr 看到。
  process.on('unhandledRejection', (err) => {
    console.error('[soa] 未处理的 Promise rejection(已兜底,进程继续):', err instanceof Error ? (err.stack ?? err.message) : String(err));
  });
  createAppServer().listen(PORT, HOST, () => {
    console.log(`[soa] web server: http://${HOST}:${PORT} (静态 dist + /llm-proxy 代理 + /tdx-collect 采集代理 + /web-search 搜索代理 + /logs 日志汇聚)`);
  });
}
