// 生产 web server:静态服务 dist + 同源代理接线(/llm-proxy/* /tdx-collect /web-search)
// 用法:npx expo export --platform web && node --experimental-strip-types server.mjs(默认 8090)
// 代理实现全部收敛在 lib/proxies.cjs(与 metro dev 中间件共享,单份防漂移);
// 日志汇聚见 lib/logs-server.cjs。浏览器无原始 TCP,TDX 采集由本 server(Node)执行。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleLlmProxy, handleTdxCollect, handleWebSearch } from './lib/proxies.cjs';
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

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
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

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/llm-proxy/')) {
    void handleLlmProxy(req, res);
    return;
  }
  if (req.method === 'GET' && req.url.startsWith('/tdx-collect')) {
    void handleTdxCollect(req, res);
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

server.listen(PORT, () => {
  console.log(`[soa] web server: http://localhost:${PORT} (静态 dist + /llm-proxy 代理 + /tdx-collect 采集代理 + /web-search 搜索代理 + /logs 日志汇聚)`);
});
