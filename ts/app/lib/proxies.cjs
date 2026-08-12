// TDX 采集(/tdx-collect)与 Web 搜索(/web-search)代理共享实现 —— metro dev
// 中间件(metro.config.js)与生产 server(server.mjs)复用同一份 校验/互斥/超时/
// 回包 逻辑,两处行为必须一致(对齐 lib/logs-server.cjs 的收敛模式)。
// CJS 原因:metro.config.js 是 CJS(require);server.mjs 是 ESM(import)——CJS
// 模块两者都能加载。
// .ts 依赖(node-tdx-market 采集链 + ddgSearcher)要求 Node 带
// --experimental-strip-types 启动:dev 见 package.json "start"(node --experimental-
// strip-types .../expo/bin/cli start),生产见 server.mjs 启动命令。缺 flag 时
// require(.ts) 抛 MODULE_NOT_FOUND。node ≥23.6 默认开启可省略。
'use strict';

const { TdxClient } = require('node-tdx-market');
const { collectAll } = require('../../src/tdx/quoteClient.ts');
const { f10MarketFor, getCompanyInfoCategory, getCompanyInfoContent } = require('../../src/tdx/f10Client.ts');
const { ddgSearcher } = require('../../src/webSearch.ts');

// ─── LLM 同源代理(/llm-proxy/*)─────────────────────────────────────────────
// 网页请求同源代理 → 转发配置的 LLM base → 补 CORS 头(绕开浏览器跨域,
// 对齐 Streamlit 服务端调用 LLM 的架构)。dev(Metro)与生产(server.mjs)共用。
// 注意:R4 流式透传改造只改这一处(pipe upstream.body),双入口同步生效。
async function handleLlmProxy(req, res) {
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
    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'application/json',
    });
    // R4 流式透传:pipe upstream.body 分块转发,不整体缓冲(await text 曾致
    // 浏览器一次性收到 SSE);upstream 断开 → for-await 抛错,走下方兜底 destroy。
    if (upstream.body) {
      for await (const chunk of upstream.body) {
        res.write(chunk);
      }
    }
    res.end();
  } catch (err) {
    // writeHead 后抛错(上游流中断/客户端断开)不可再 writeHead——destroy 兜底,
    // 防客户端挂起(原缓冲实现无此路径);未 writeHead 的错误路径保持 502 JSON。
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `LLM 代理转发失败:${String(err?.message ?? err)}` } }));
  }
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

async function handleTdxCollect(req, res) {
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

async function handleWebSearch(req, res) {
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

module.exports = { handleLlmProxy, handleTdxCollect, handleWebSearch };
