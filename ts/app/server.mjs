// 生产 web server:静态服务 dist + LLM 同源代理(/llm-proxy/*) + TDX 采集代理(/tdx-collect)
// 用法:npx expo export --platform web && node --experimental-strip-types server.mjs(默认 8090)
// 网页请求同源代理 → 转发配置的 LLM base → 补 CORS 头(绕开浏览器跨域,
// 对齐 Streamlit 服务端调用 LLM 的架构)。dev 模式见 metro.config.js。
// 浏览器无原始 TCP,TDX 行情/快照/F10 采集由本 server(Node)执行 → /tdx-collect 回包。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TdxClient } from 'node-tdx-market';
import { collectAll } from '../src/tdx/quoteClient.ts';
import { f10MarketFor, getCompanyInfoCategory, getCompanyInfoContent } from '../src/tdx/f10Client.ts';
import { ddgSearcher } from '../src/webSearch.ts';
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

async function llmProxy(req, res) {
  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { base, ...payload } = JSON.parse(body);
    const baseUrl = req.headers['x-llm-base'] || base;
    const target = `${baseUrl}/${req.url.slice('/llm-proxy/'.length)}`;
    const upstream = await fetch(target, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: req.headers.authorization || '',
      },
      body: JSON.stringify(payload),
    });
    const text = await upstream.text();
    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'application/json',
    });
    res.end(text);
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `LLM 代理转发失败:${String(err?.message ?? err)}` } }));
  }
}

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

// ─── TDX 采集代理 ────────────────────────────────────────────────────────────
// 对齐 tools/probe.mts 数据链:F10 财务分析节 + collectAll(快照/全量日K/名称)。
// 并发互斥(单连接够用);45s 总超时兜底;失败 → 5xx {error},浏览器端中止分析。
const COLLECT_TIMEOUT_MS = 45_000;
let collecting = false;

async function fetchF10Section(client, ticker, cats, namePart) {
  const market = f10MarketFor(ticker); // pytdx: 0=深 1=沪(inferExchange 对齐)
  const section = cats.find((c) => c.name.includes(namePart));
  if (!section) return '';
  return getCompanyInfoContent(client, market, ticker, section.filename, section.start, section.length);
}

async function doCollect(ticker) {
  const client = new TdxClient({ connectTimeout: 8000, requestTimeout: 12000 });
  client.on('error', () => {});
  await client.connect();
  try {
    const cats = await getCompanyInfoCategory(client, f10MarketFor(ticker), ticker);
    const f10Text = await fetchF10Section(client, ticker, cats, '财务分析');
    const capitalText = await fetchF10Section(client, ticker, cats, '股本结构');
    const collected = await collectAll(client, ticker, { get: () => null, set: () => {} });
    return {
      ticker,
      name: collected.name,
      bars: collected.bars,
      snapshot: collected.snapshot,
      f10Text,
      capitalText, // 股本结构文本(万股),浏览器 parseCapitalStructure 解析
    };
  } finally {
    client.disconnect();
  }
}

async function tdxCollect(req, res) {
  const url = new URL(req.url, 'http://x');
  const ticker = url.searchParams.get('ticker') ?? '';
  if (!/^\d{6}$/.test(ticker)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `无效 ticker:${ticker}(需 6 位数字)` }));
    return;
  }
  if (collecting) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '已有采集进行中,请稍后重试' }));
    return;
  }
  collecting = true;
  let settled = false;
  const send = (status, obj) => {
    if (settled) return;
    settled = true;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  try {
    const result = await Promise.race([
      doCollect(ticker),
      new Promise((_, reject) =>
        setTimeout(() => reject(Object.assign(new Error('采集超时(45s)'), { timedOut: true })), COLLECT_TIMEOUT_MS),
      ),
    ]);
    send(200, result);
  } catch (err) {
    send(err?.timedOut ? 504 : 502, { error: `TDX 采集失败:${String(err?.message ?? err)}` });
  } finally {
    collecting = false;
  }
}

// ─── Web 搜索代理 ────────────────────────────────────────────────────────────
// 浏览器直连 DDG 有反爬/CORS 限制 → 本 server(Node)执行查询回包 {results}
// JSON(对齐 Python web_search 工具语义;免 key)。q 校验(非空 + ≤200 字符
// + 无空白);20s 超时兜底;失败/超时/参数非法 → 5xx {error}。
const SEARCH_TIMEOUT_MS = 20_000;

async function webSearch(req, res) {
  const url = new URL(req.url, 'http://x');
  const q = url.searchParams.get('q') ?? '';
  if (!q || q.length > 200 || !/^\S+$/.test(q)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `无效 q 参数:${q}(需非空、≤200 字符、无空白)` }));
    return;
  }
  let settled = false;
  const send = (status, obj) => {
    if (settled) return;
    settled = true;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  try {
    const results = await Promise.race([
      ddgSearcher(q),
      new Promise((_, reject) =>
        setTimeout(() => reject(Object.assign(new Error('搜索超时(20s)'), { timedOut: true })), SEARCH_TIMEOUT_MS),
      ),
    ]);
    send(200, { results });
  } catch (err) {
    send(err?.timedOut ? 504 : 502, { error: `web 搜索失败:${String(err?.message ?? err)}` });
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/llm-proxy/')) {
    void llmProxy(req, res);
    return;
  }
  if (req.method === 'GET' && req.url.startsWith('/tdx-collect')) {
    void tdxCollect(req, res);
    return;
  }
  if (req.method === 'GET' && req.url.startsWith('/web-search')) {
    void webSearch(req, res);
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
