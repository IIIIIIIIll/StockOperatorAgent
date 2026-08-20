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
  let file = path.join(DIST, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(DIST)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIST, 'index.html'); // SPA fallback
  }
  const ext = path.extname(file);
  res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

/** 生产 web server 工厂:静态服务 dist + 同源代理路由。导出供桌面主进程复用
 *  (返回 http.Server,监听与否由调用方决定)。路由体与旧模块级 createServer
 *  完全一致,行为零变化。 */
export function createAppServer() {
  return http.createServer((req, res) => {
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
const HOST = process.env.HOST || '127.0.0.1';
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  createAppServer().listen(PORT, HOST, () => {
    console.log(`[soa] web server: http://${HOST}:${PORT} (静态 dist + /llm-proxy 代理 + /tdx-collect 采集代理 + /web-search 搜索代理 + /logs 日志汇聚)`);
  });
}
