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
const dns = require('node:dns');
const net = require('node:net');

// ─── 请求体上限(W2,对齐 logs-server MAX_BODY_BYTES)────────────────────────
const MAX_BODY_BYTES = 64 * 1024;

// ─── LLM base SSRF 防线(C2)───────────────────────────────────────────────
// X-LLM-Base 头 / body.base 是浏览器端用户配置(多提供商透传是设计意图,
// 见 ts/src/llm.ts createLlm 注释)——不丢弃机制;防线改为转发前校验目标:
// ① scheme 仅 http(s);② 拒绝 userinfo;③ host 经 DNS 解析后任一地址落入
// 私网/环回/链路本地/保留段(127.x 10.x 172.16-31.x 192.168.x 169.254.x
// 0.0.0.0 ::1 fe80::/10 fc00::/7 等)→ 拒发;解析失败 → 保守拒绝。
// 校验失败回 400(格式非法)/403(策略拒绝),双入口(metro dev + 生产)同步生效。

/** 解析并校验 base:http(s) + 无 userinfo + host 非空 → URL;否则 null。 */
function normalizeBaseUrl(raw) {
  if (typeof raw !== 'string' || raw === '') return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (!u.hostname) return null;
  return u;
}

/** IP 是否私网/环回/链路本地/保留段(SSRF 黑名单;IPv4-mapped IPv6 按内嵌 IPv4 判定)。 */
function isPrivateAddress(ip) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) ip = mapped[1];
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT 100.64/10
    if (p[0] === 169 && p[1] === 254) return true; // 链路本地/云 metadata 169.254.169.254
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 198 && (p[1] === 18 || p[1] === 19)) return true; // benchmark 198.18/15
    return false;
  }
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    if (low === '::' || low === '::1') return true;
    if (/^fe[89a-f]/.test(low) || /^f[cd]/.test(low)) return true; // fe80::/10 链路本地 + fc00::/7 ULA
    return false;
  }
  return true; // 无法识别 → 保守拒绝
}

/** host 解析后任一地址私网 → false(防 hostname 指向内网/DNS 重绑定的 SSRF)。 */
async function isPublicHost(u) {
  let addrs;
  try {
    addrs = await dns.promises.lookup(u.hostname, { all: true, verbatim: true });
  } catch {
    return false; // 解析失败 → 保守拒绝(不发)
  }
  return addrs.length > 0 && addrs.every(({ address }) => !isPrivateAddress(address));
}

// ─── LLM 同源代理(/llm-proxy/*)─────────────────────────────────────────────
// 网页请求同源代理 → 转发浏览器配置的 LLM base(经 C2 SSRF 校验)→ 补 CORS 头
// (绕开浏览器跨域,对齐 Streamlit 服务端调用 LLM 的架构)。dev(Metro)与生产
// (server.mjs)共用。注意:R4 流式透传改造只改这一处(pipe upstream.body),
// 双入口同步生效。
async function handleLlmProxy(req, res, _fetch = fetch) {
  try {
    // W2:请求体 ≤64KB,超限 413 并终止读取(对齐 logs-server MAX_BODY_BYTES 模式)
    let body = '';
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'LLM 代理请求体超过 64KB 限制' }));
        return;
      }
      body += chunk;
    }
    const { base, ...payload } = JSON.parse(body);
    // C2:base 仅 http(s) + 公网 host;X-LLM-Base 头优先,其次 body.base
    // (浏览器端用户配置透传是设计意图,保留机制、加 SSRF 防线)
    const baseUrl = normalizeBaseUrl(req.headers['x-llm-base'] || base);
    if (!baseUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'LLM 代理目标 base 非法(需 http(s):// 且不含 userinfo)' }));
      return;
    }
    if (!(await isPublicHost(baseUrl))) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'LLM 代理目标被拒:仅允许公网 host(拒绝内网/环回地址)' }));
      return;
    }
    // 尾斜杠归一,避免 base 带 / 时拼出双斜杠
    const target = `${baseUrl.origin}${baseUrl.pathname.replace(/\/+$/, '')}/${req.url.slice('/llm-proxy/'.length)}`;
    const upstream = await _fetch(target, {
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
// 并发互斥(单连接够用);45s 超时仅提前回 504,锁保持到真正 settle(W4,防后台
// 采集并发泄漏);失败 → 5xx {error},浏览器端中止分析。
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

async function handleTdxCollect(req, res, _collect = doCollect) {
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
  // W4:超时 timer 仅提前回 504 通知客户端,不打断 doCollect(底层 TdxClient
  // 无 AbortSignal 支持,取消不了 in-flight TCP,见 node-tdx-market client.d.ts);
  // 锁保持到 doCollect 真正 settle(下方 await 返回)才释放——杜绝旧实现
  // "超时回包后 finally 已放锁、后台采集仍在跑"的并发泄漏。timer 在 finally clear。
  const timer = setTimeout(() => {
    send(504, { error: `TDX 采集超时(${COLLECT_TIMEOUT_MS / 1000}s),后台任务继续直至结束` });
  }, COLLECT_TIMEOUT_MS);
  try {
    const result = await _collect(ticker);
    send(200, result);
  } catch (err) {
    send(502, { error: `TDX 采集失败:${String(err?.message ?? err)}` });
  } finally {
    clearTimeout(timer);
    collecting = false; // await _collect 已返回 → 真 settle,此刻才放锁
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

module.exports = {
  handleLlmProxy,
  handleTdxCollect,
  handleWebSearch,
  // 测试/复用导出(新增,不删旧)
  MAX_BODY_BYTES, // W2 上限
  COLLECT_TIMEOUT_MS, // W4 超时
  normalizeBaseUrl, // C2 base 校验
  isPrivateAddress,
  isPublicHost,
};
