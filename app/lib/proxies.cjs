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
const { YahooClient } = require('../../src/yahoo/yahooClient.ts');
const { collectYahooPayload, getCachedA3, invalidateA3Cache } = require('../../src/yahoo/deviceYahooCollect.ts');
const { yahooMarketOfTicker } = require('../../src/yahoo/webYahooCollect.ts');
const dns = require('node:dns');
const net = require('node:net');

// ─── S5:代理响应安全头(CSP 供参考/文档面;JSON 响应核心是 nosniff+no-store;
// 静态面 CSP 同值,见 server.mjs serveStatic)──────────────────────────────
// style-src 'unsafe-inline' 为 expo-reset 内联 <style>(dist/index.html 实测),
// img-src data: 供内联图元;script-src 由 default-src 'self' 继承(无内联脚本)。
// frame-ancestors 'self' 防本地 SPA 被第三方 iframe 嵌入(clickjacking,2026-08-27 note)。
const SEC_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; connect-src 'self' https:; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store', // 代理响应永不缓存(含 SSRF 判定后的敏感载荷)
};

// ─── 请求体上限(W2,对齐 logs-server MAX_BODY_BYTES)────────────────────────
// 64KB → 1MB(2026-08-16 desktop-app 实证:投资经理终审上下文 = 6 份报告 +
// 修订轮 + 联网搜索结果,真实全链 >64KB 撞 413;1MB 仍挡滥用,文本 JSON 无
// 上传面,LLM API 上下文远超此量)。
const MAX_BODY_BYTES = 1024 * 1024;

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
    const g = expandIpv6Groups(low);
    // S3 补漏(2026-08-27 实证):hex 形 IPv4-mapped —— 原实现只认顶部 dotted-quad
    // 正则,`::ffff:7f00:1`(=127.0.0.1)等 hex 形落入本分支被放行。::ffff:0:0/96
    // 的标准形(g[5]=ffff,内嵌 32 位在末两组)与宽容变体 `::ffff:0:X:Y`
    // (g[4]=ffff、g[5]=0,内嵌位同样在末两组)一律提取内嵌 IPv4 为 dotted quad,
    // 递归复用上方同一 IPv4 黑名单(单源判定,与 dotted-quad 形等价)。
    const mappedStd =
      g[0] === '0000' && g[1] === '0000' && g[2] === '0000' && g[3] === '0000' && g[4] === '0000' && g[5] === 'ffff';
    const mappedLoose =
      g[0] === '0000' && g[1] === '0000' && g[2] === '0000' && g[3] === '0000' && g[4] === 'ffff' && g[5] === '0000';
    if (mappedStd || mappedLoose) {
      // S3 补漏(2026-08-28 实证):dotted-quad 全写形 —— `0:0:0:0:0:ffff:8.8.8.8`
      // (=公网 8.8.8.8)末组含 '.',旧 hex 路径 parseInt('8.8.8.8',16)=NaN →
      // 0.0.0.0 误封。末组(内嵌 32 位的两种落点)含 '.' 时按 dotted-quad
      // 直接复用上方同一 IPv4 黑名单;纯 hex 保持原提取;含 '.' 但非合法
      // IPv4 → 保守拒绝。
      const dotted = [g[6], g[7]].find((s) => typeof s === 'string' && s.includes('.'));
      if (dotted !== undefined) {
        if (!net.isIPv4(dotted)) return true;
        return isPrivateAddress(dotted);
      }
      const hi = parseInt(g[6], 16);
      const lo = parseInt(g[7], 16);
      return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    // N-12(2026-08-29 终审):RFC 4291 弃用的 IPv4-compatible ::/96 —— `::7f00:1`
    // (=127.0.0.1)等内嵌 IPv4 原实现(仅 ffff 标记形走 mapped)落入下方被判公网,
    // 放行私网目标。前 6 组全 0 即 ::/96(本处可达时 mappedStd/mappedLoose 均未
    // 命中,不遮蔽);末两组 hex 即内嵌 IPv4,提取后递归复用上方同一 IPv4 黑名单
    // (单源判定,与 mapped 路径等价)。不整段封 ::/96:`::808:808`(=8.8.8.8)等
    // 公网内嵌地址经提取自然放行。dotted-quad 尾形(`::192.168.1.1`)与 mapped
    // 分支同款处理:Node isIPv6 接受该形,纯 hex 路径 parseInt 得 NaN → 0.0.0.0
    // 会误封公网 `::8.8.8.8`。'::'/'::1' 已在上方提前返回,不落入本分支。
    if (g[0] === '0000' && g[1] === '0000' && g[2] === '0000' && g[3] === '0000' && g[4] === '0000' && g[5] === '0000') {
      const dotted = [g[6], g[7]].find((s) => typeof s === 'string' && s.includes('.'));
      if (dotted !== undefined) {
        if (!net.isIPv4(dotted)) return true;
        return isPrivateAddress(dotted);
      }
      const hi = parseInt(g[6], 16);
      const lo = parseInt(g[7], 16);
      return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    // S3:隧道/保留段(前缀按展开组比较,容忍 RFC5952 压缩形)——
    // 6to4 2002::/16、Teredo 2001::/32、文档 2001:db8::/32、NAT64 64:ff9b::/96。
    // 注意不可整段封 2001::/16(2001:4860:: 是 Google Public DNS)。
    if (g[0] === '2002') return true;
    if (g[0] === '2001' && g[1] === '0000') return true;
    if (g[0] === '2001' && g[1] === '0db8') return true;
    if (g[0] === '0064' && g[1] === 'ff9b') return true;
    return false;
  }
  return true; // 无法识别 → 保守拒绝
}

/** IPv6 展开为 8 组定宽 4 位十六进制(处理 :: 压缩;供前缀比较)。 */
function expandIpv6Groups(ip) {
  const dc = ip.indexOf('::');
  let groups;
  if (dc === -1) {
    groups = ip.split(':');
  } else {
    const head = dc === 0 ? [] : ip.slice(0, dc).split(':');
    const tailPart = ip.slice(dc + 2);
    const tail = tailPart === '' ? [] : tailPart.split(':');
    groups = [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail];
  }
  return groups.map((s) => s.padStart(4, '0'));
}

/** S3:host 全地址公网校验 —— 解析一次,任一地址私网/解析失败 → null(保守拒发);
 *  全部公网 → 返回地址列表(调用方仅判 null)。
 *  注(TOCTOU 残余,2026-08-27 实证):全局 fetch(undici 6.x)不接受 init 里的
 *  lookup 选项(实测忽略,仍自行解析),且仓库无独立 undici 包可构造 dispatcher
 *  注入 connect.lookup —— 「把已校验 IP 钉进建连」在当前栈不可实现,故此处只
 *  校验不固定;校验与建连之间的 DNS 翻转窗口需攻击者控制宿主 DNS,记录为接受
 *  的残余(重定向逐跳重新解析+校验,见 handleLlmProxy M2 循环)。 */
async function pinPublicHost(u) {
  let addrs;
  try {
    addrs = await dns.promises.lookup(u.hostname, { all: true, verbatim: true });
  } catch {
    return null; // 解析失败 → 保守拒绝(不发)
  }
  if (addrs.length === 0 || addrs.some(({ address }) => isPrivateAddress(address))) return null;
  return addrs;
}

/** host 解析后任一地址私网 → false(防 hostname 指向内网/DNS 重绑定的 SSRF;
 *  判定与 pinPublicHost 单源)。 */
async function isPublicHost(u) {
  return (await pinPublicHost(u)) !== null;
}

// ─── LLM 同源代理(/llm-proxy/*)─────────────────────────────────────────────
// 网页请求同源代理 → 转发浏览器配置的 LLM base(经 C2 SSRF 校验;服务端转发
// 调用 LLM,对齐 Streamlit 架构)。同源即免跨域:页面由本 server 托管(metro
// dev 中间件/server.mjs 共用本 handler),/llm-proxy 与页面同 origin 不涉
// CORS——全文件不设任何 Access-Control 头,响应仅透传上游 Content-Type。
// 注意:R4 流式透传改造只改这一处(pipe upstream.body),双入口同步生效。
async function handleLlmProxy(req, res, _fetch = fetch) {
  try {
    // W2:请求体超 MAX_BODY_BYTES,413 并终止读取(对齐 logs-server MAX_BODY_BYTES 模式)
    const parts = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        res.writeHead(413, { 'Content-Type': 'application/json', ...SEC_HEADERS });
        res.end(JSON.stringify({ error: 'LLM 代理请求体超过 1MB 限制' }));
        return;
      }
      parts.push(chunk);
    }
    // F02:分块 Buffer 收集 + 一次性 decode——逐块 `body += chunk` 按块独立 UTF-8
    // 解码,多字节 CJK 跨块边界即乱码;concat 后单次 toString 保完整。不用
    // setEncoding('utf8')(会把 1MB 上限从字节数变成字符数,F34 类问题)。
    const body = Buffer.concat(parts).toString('utf8');
    const { base, ...payload } = JSON.parse(body);
    // C2:base 仅 http(s) + 公网 host;X-LLM-Base 头优先,其次 body.base
    // (浏览器端用户配置透传是设计意图,保留机制、加 SSRF 防线)
    const baseUrl = normalizeBaseUrl(req.headers['x-llm-base'] || base);
    if (!baseUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json', ...SEC_HEADERS });
      res.end(JSON.stringify({ error: 'LLM 代理目标 base 非法(需 http(s):// 且不含 userinfo)' }));
      return;
    }
    // S3:全地址公网校验(任一私网/解析失败 → 403;固定查询器不可用见 pinPublicHost 注)
    const pinned = await pinPublicHost(baseUrl);
    if (!pinned) {
      res.writeHead(403, { 'Content-Type': 'application/json', ...SEC_HEADERS });
      res.end(JSON.stringify({ error: 'LLM 代理目标被拒:仅允许公网 host(拒绝内网/环回地址)' }));
      return;
    }
    // 尾斜杠归一,避免 base 带 / 时拼出双斜杠
    let target = `${baseUrl.origin}${baseUrl.pathname.replace(/\/+$/, '')}/${req.url.slice('/llm-proxy/'.length)}`;
    const forwardOpts = {
      method: 'POST',
      // S6:转发头白名单(仅透传 Content-Type + Authorization)。X-SOA-Token 是
      // server 端 S6 gate 专用头,白名单天然排除、绝不可随转发泄漏给 LLM 上游
      // (回归测试见 test/proxies.test.ts)。
      headers: {
        'Content-Type': 'application/json',
        Authorization: req.headers.authorization || '',
      },
      body: JSON.stringify(payload),
      // M2:SSRF 3xx 绕过防护 —— 绝不自动跟随(307/308 会原样带 method+body
      // 转发到内网);逐跳手动校验见下方循环
      redirect: 'manual',
    };
    let upstream = await _fetch(target, forwardOpts);
    // M2:逐跳重定向处理 —— location 解析 → 新 host 重新解析+公网校验 → 手动跟随;
    // 目标私网/非法 location/非 http(s)/超 5 跳 → 拒发。
    const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
    // M2 补漏(2026-08-27 实证):断链路径(缺 Location/超 5 跳/Location 非法/非
    // http(s))此前 break 后照常透传无 Location 的 3xx,再 pipe 已 cancel 的
    // upstream.body 抛错 → res.destroy() 半截响应,浏览器拿不到承诺的 502 JSON。
    // 现统一 rejectRedirect:与下方「重定向目标被拒」同一 502 JSON 形态。
    const rejectRedirect = (msg) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.writeHead(502, { 'Content-Type': 'application/json', ...SEC_HEADERS });
      res.end(JSON.stringify({ error: { message: msg } }));
    };
    let hops = 0;
    while (REDIRECT_CODES.has(upstream.status)) {
      const location = upstream.headers.get('location');
      await upstream.body?.cancel?.(); // 3xx body 不消费 → 释放连接
      if (!location || hops >= 5) {
        rejectRedirect('LLM 代理转发失败:重定向链无效(缺 Location 或超 5 跳)');
        return;
      }
      let next;
      try {
        next = new URL(location, target);
      } catch {
        rejectRedirect('LLM 代理转发失败:重定向 Location 非法');
        return;
      }
      if (next.protocol !== 'http:' && next.protocol !== 'https:') {
        rejectRedirect('LLM 代理转发失败:重定向目标协议非法(仅支持 http/https)');
        return;
      }
      if (next.hostname !== baseUrl.hostname) {
        const hop = await pinPublicHost(next);
        if (!hop) {
          rejectRedirect('LLM 代理转发失败:重定向目标被拒(仅允许公网 host)');
          return;
        }
      }
      target = next.href;
      hops += 1;
      upstream = await _fetch(target, forwardOpts);
    }
    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'application/json',
      ...SEC_HEADERS,
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
    res.writeHead(502, { 'Content-Type': 'application/json', ...SEC_HEADERS });
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

async function doCollect(ticker, opts = {}) {
  const client = new TdxClient({ connectTimeout: 8000, requestTimeout: 12000 });
  client.on('error', () => {});
  await client.connect();
  try {
    const cats = await getCompanyInfoCategory(client, f10MarketFor(ticker), ticker);
    // C8 freshness:同季业绩已入库 → 跳过财务分析节(股本结构节仍拉,capital 不缺失)
    const f10Text = opts.skipF10 ? '' : await fetchF10Section(client, ticker, cats, '财务分析');
    const capitalText = await fetchF10Section(client, ticker, cats, '股本结构');
    // C8 freshness:同日已采集 → 跳过日K+xdxr(collectAll 仍拉快照/名称,部分 fresh 不整体短路)
    const collected = await collectAll(
      client,
      ticker,
      // H2:meta 读写为无操作(有意为之):代理无状态,不做名称等缓存——与真机
      // deviceCollect 的 nameKey 持久缓存不同,名称随每次采集重拉;浏览器侧入库
      // 时(applyCollectedToStore)再写入自己的 store meta,不在此引入存储面。
      { get: () => null, set: () => {} },
      { skipDaily: opts.skipDaily === true },
    );
    return {
      ticker,
      name: collected.name,
      bars: collected.bars,
      snapshot: collected.snapshot,
      f10Text,
      capitalText, // 股本结构文本(万股),浏览器 parseCapitalStructure 解析
      skipDaily: opts.skipDaily === true, // 浏览器据此保留既有日K/lastDataUpdate
    };
  } finally {
    client.disconnect();
  }
}

async function handleTdxCollect(req, res, _collect = doCollect) {
  let url;
  try {
    url = new URL(req.url, 'http://x');
  } catch {
    // F30:畸形 req.url(如非法 IPv6 字面)new URL 抛错 → 400,不崩进程
    res.writeHead(400, { 'Content-Type': 'application/json', ...SEC_HEADERS });
    res.end(JSON.stringify({ error: '非法请求 URL' }));
    return;
  }
  const ticker = url.searchParams.get('ticker') ?? '';
  // C8 freshness:浏览器按 store 现有数据判定后传跳过标记(仅 '1' 生效,其余按全量)
  const skipDaily = url.searchParams.get('skipDaily') === '1';
  const skipF10 = url.searchParams.get('skipF10') === '1';
  if (!/^\d{6}$/.test(ticker)) {
    res.writeHead(400, { 'Content-Type': 'application/json', ...SEC_HEADERS });
    res.end(JSON.stringify({ error: `无效 ticker:${ticker}(需 6 位数字)` }));
    return;
  }
  if (collecting) {
    res.writeHead(429, { 'Content-Type': 'application/json', ...SEC_HEADERS });
    res.end(JSON.stringify({ error: '已有采集进行中,请稍后重试' }));
    return;
  }
  collecting = true;
  let settled = false;
  const send = (status, obj) => {
    if (settled) return;
    settled = true;
    res.writeHead(status, { 'Content-Type': 'application/json', ...SEC_HEADERS });
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
    const result = await _collect(ticker, { skipDaily, skipF10 });
    send(200, result);
  } catch (err) {
    send(502, { error: `TDX 采集失败:${String(err?.message ?? err)}` });
  } finally {
    clearTimeout(timer);
    collecting = false; // await _collect 已返回 → 真 settle,此刻才放锁
  }
}

// ─── Yahoo 采集代理(/yahoo-collect)──────────────────────────────────────────
// 港美股数据链(web 端同 /tdx-collect 的代理语义):Node 侧 YahooClient 直连
// (chart 免 crumb;quoteSummary 走 A3 cookie + crumb 两跳),浏览器 fetch 回写
// InMemoryStore。gate:正则(格式)+ yahooMarketOfTicker(hk/us 市场语义,与
// webYahooCollect 单源,双校验互为兜底——600036 等 CN 6 位数字被拒);HK 候选 hkSymbolCandidates 逐个 chart
// 试探(result 存在即定符号,全败 502);quoteSummary 失败降级(crumb 失效场景,
// 概览仅 chart meta 字段 + reports 空,不整体失败——chart 失败才中止)。
// 独立互斥 collectingYahoo(与 TDX 采集互不阻塞);45s 超时仅提前回 504,
// 锁保持到真正 settle(W4 同款,防后台采集并发泄漏);timer 在 finally clear。
const YAHOO_COLLECT_TIMEOUT_MS = 45_000;
let collectingYahoo = false;

const YAHOO_TICKER_RE = /^([A-Z0-9]{1,5}(\.HK)?|[A-Z][A-Z0-9.-]{0,9})$/i;

/** 代理 gate 的布尔市场判定(adapter):仅 hk/us → true;非法/cn/未判定(即
 *  yahooMarketOfTicker 抛错)→ false。判定核心与 webYahooCollect.ts 同名函数
 *  单源(E9 去重,防两处正则漂移);调用点仅本 gate 一处。 */
function isYahooMarket(ticker) {
  try {
    yahooMarketOfTicker(ticker);
    return true;
  } catch {
    return false;
  }
}

async function doYahooCollect(ticker, opts = {}) {
  // 采集流共享 deviceYahooCollect.collectYahooPayload(候选试探/chart 分页/
  // quoteSummary 降级/合成,server/真机/探针三端单一实现)。
  // cookieProvider 传 getter + 失效钩子(C3 方案 B′,无预取):quoteSummary 401
  // 二次自愈时 invalidateA3Cache 清模块级缓存,getCachedA3 重读 → 下次 crumb
  // 链取新 A3;缓存空 → YahooClient 自身 fc 请求状态码无关解析(fc.yahoo.com
  // 实测 404 亦回 Set-Cookie A3),单请求路径。
  const client = new YahooClient(undefined, getCachedA3, invalidateA3Cache);
  return collectYahooPayload(client, ticker, { skipDaily: opts.skipDaily === true });
}

async function handleYahooCollect(req, res, _collect = doYahooCollect) {
  // body JSON {ticker}(对齐 MAX_BODY_BYTES 上限;非法/空 body → ticker '' → 400)
  const parts = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      res.writeHead(413, { 'Content-Type': 'application/json', ...SEC_HEADERS });
      res.end(JSON.stringify({ error: 'Yahoo 采集请求体超过 1MB 限制' }));
      return;
    }
    parts.push(chunk);
  }
  // F02:分块 Buffer 收集 + 一次性 decode(同 handleLlmProxy;不用 setEncoding)
  const body = Buffer.concat(parts).toString('utf8');
  let ticker = '';
  try {
    const parsed = JSON.parse(body || '{}');
    ticker = typeof parsed?.ticker === 'string' ? parsed.ticker : '';
  } catch {
    ticker = '';
  }
  // C8 freshness:浏览器按 store 现有数据判定后传跳过标记(仅 '1' 生效,缺省全量)
  let url;
  try {
    url = new URL(req.url, 'http://x');
  } catch {
    // F30:畸形 req.url → 400,不崩进程
    res.writeHead(400, { 'Content-Type': 'application/json', ...SEC_HEADERS });
    res.end(JSON.stringify({ error: '非法请求 URL' }));
    return;
  }
  const skipDaily = url.searchParams.get('skipDaily') === '1';
  if (!YAHOO_TICKER_RE.test(ticker) || !isYahooMarket(ticker)) {
    res.writeHead(400, { 'Content-Type': 'application/json', ...SEC_HEADERS });
    res.end(JSON.stringify({ error: '非法代码' }));
    return;
  }
  if (collectingYahoo) {
    res.writeHead(429, { 'Content-Type': 'application/json', ...SEC_HEADERS });
    res.end(JSON.stringify({ error: '已有采集进行中,请稍后重试' }));
    return;
  }
  collectingYahoo = true;
  let settled = false;
  const send = (status, obj) => {
    if (settled) return;
    settled = true;
    res.writeHead(status, { 'Content-Type': 'application/json', ...SEC_HEADERS });
    res.end(JSON.stringify(obj));
  };
  // W4 同款:超时 timer 仅提前回 504 通知客户端,不主动打断采集;锁保持到
  // _collect 真正 settle(下方 await 返回)才释放。与 TDX(底层 client 无
  // AbortSignal)不同,Yahoo 链每请求已带超时(U4 fetchWithTimeout,单请求
  // 40s < 本定时器 45s;HK 候选试探/chart 分页为多请求串行,总时长 N×40s
  // 仍有界)→ _collect 必在有限时间 settle,锁必然释放(429 窗口有界),
  // 无需代理侧 abort。
  const timer = setTimeout(() => {
    send(504, { error: `Yahoo 采集超时(${YAHOO_COLLECT_TIMEOUT_MS / 1000}s),后台任务继续直至结束` });
  }, YAHOO_COLLECT_TIMEOUT_MS);
  try {
    const result = await _collect(ticker, { skipDaily });
    send(200, result);
  } catch (err) {
    send(502, { error: String(err?.message ?? err) });
  } finally {
    clearTimeout(timer);
    collectingYahoo = false; // await _collect 已返回 → 真 settle,此刻才放锁
  }
}

// ─── Web 搜索代理 ────────────────────────────────────────────────────────────
// 浏览器直连 DDG 有反爬/CORS 限制 → 本 server(Node)执行查询回包 {results}
// JSON(对齐 Python web_search 工具语义;免 key)。q 校验(非空 + ≤200 字符
// + 无控制字符);20s 超时兜底;失败/超时/参数非法 → 5xx {error}。
const SEARCH_TIMEOUT_MS = 20_000;

async function handleWebSearch(req, res, _ddg = ddgSearcher) {
  let url;
  try {
    url = new URL(req.url, 'http://x');
  } catch {
    // F30:畸形 req.url → 400,不崩进程
    res.writeHead(400, { 'Content-Type': 'application/json', ...SEC_HEADERS });
    res.end(JSON.stringify({ error: '非法请求 URL' }));
    return;
  }
  const q = url.searchParams.get('q') ?? '';
  // q 校验:非空 + ≤200 字符 + 无控制字符。禁空白是错的——分析师自身查询
  // 模板含空格("600036 最新新闻",src/agents.ts _QUERY_TEMPLATES),曾致
  // DDG 回退恒 400(08-16-desktop-app 实证:web/桌面同路径)。
  if (!q || q.length > 200 || /[\x00-\x1f\x7f]/.test(q)) {
    res.writeHead(400, { 'Content-Type': 'application/json', ...SEC_HEADERS });
    res.end(JSON.stringify({ error: `无效 q 参数:${q}(需非空、≤200 字符、无控制字符)` }));
    return;
  }
  let settled = false;
  const send = (status, obj) => {
    if (settled) return;
    settled = true;
    res.writeHead(status, { 'Content-Type': 'application/json', ...SEC_HEADERS });
    res.end(JSON.stringify(obj));
  };
  try {
    const results = await Promise.race([
      _ddg(q),
      new Promise((_, reject) =>
        setTimeout(() => reject(Object.assign(new Error('搜索超时(20s)'), { timedOut: true })), SEARCH_TIMEOUT_MS),
      ),
    ]);
    send(200, { results });
  } catch (err) {
    send(err?.timedOut ? 504 : 502, { error: `web 搜索失败:${String(err?.message ?? err)}` });
  }
}

// ─── TDX MCP 同源代理(/tdx-mcp)─────────────────────────────────────────────
// F2:web 端浏览器直连通达信 MCP 服务器受 CORS 限制 → 同源代理转发
// (TdxMcpClient 经 makeProxyMcpFetch 走本端点,src/mcp.ts)。目标写死
// mcp.tdx.com.cn:3001/mcp——无用户输入 target,零 SSRF 面(不需要
// normalizeBaseUrl/pinPublicHost)。请求体 1MB 上限(W2 同款)、Buffer 原样
// 转发(不 JSON.parse);请求头白名单(S6 纪律,与 src/mcp.ts FORWARD 同名单,
// 双端单源防漂移);响应 R4 同款流式透传(SSE 逐块);60s 超时仅提前回 504
// 通知客户端,不打断 in-flight(W4 语义);redirect manual(固定目标不应跳转)。
const TDX_MCP_TARGET = 'https://mcp.tdx.com.cn:3001/mcp';
const TDX_MCP_TIMEOUT_MS = 60_000;
const TDX_MCP_FORWARD_HEADERS = new Set(['tdx-api-key', 'content-type', 'accept', 'mcp-session-id']);

async function handleTdxMcp(req, res, _fetch = fetch) {
  try {
    // W2 同款:请求体超 MAX_BODY_BYTES → 413 并终止读取(对齐 handleLlmProxy 形态)
    const parts = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        res.writeHead(413, { 'Content-Type': 'application/json', ...SEC_HEADERS });
        res.end(JSON.stringify({ error: 'TDX MCP 请求体超过 1MB 限制' }));
        return;
      }
      parts.push(chunk);
    }
    // Buffer 原样转发(不 JSON.parse——body 是 JSON-RPC,服务端无需理解)
    const body = Buffer.concat(parts);
    // S6 同款白名单:仅透传 tdx-api-key/content-type/accept/mcp-session-id
    // (小写比较,原键名写入转发头;其余头拒绝——含 X-SOA-Token/Authorization)
    const forwardHeaders = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (value !== undefined && TDX_MCP_FORWARD_HEADERS.has(name.toLowerCase())) {
        forwardHeaders[name] = value;
      }
    }
    // W4 语义:60s 超时 timer 仅提前回 504 通知客户端,不打断 in-flight
    // (上游流/连接无法从服务端取消);timer 在 finally clear。
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        res.writeHead(504, { 'Content-Type': 'application/json', ...SEC_HEADERS });
        res.end(JSON.stringify({ error: `TDX MCP 转发超时(${TDX_MCP_TIMEOUT_MS / 1000}s)` }));
      }
    }, TDX_MCP_TIMEOUT_MS);
    try {
      const upstream = await _fetch(TDX_MCP_TARGET, {
        method: 'POST',
        headers: forwardHeaders,
        body,
        redirect: 'manual',
      });
      if (res.headersSent) return; // 504 已回(超时后才返回),不再 writeHead
      // R4 同款流式透传:writeHead 后 for-await chunk → res.write(SSE 逐块);
      // Mcp-Session-Id 透传(客户端会话续接);Content-Type 透传上游。
      const sid = upstream.headers.get('Mcp-Session-Id');
      res.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') || 'application/json',
        ...(sid ? { 'Mcp-Session-Id': sid } : {}),
        ...SEC_HEADERS,
      });
      if (upstream.body) {
        for await (const chunk of upstream.body) {
          res.write(chunk);
        }
      }
      res.end();
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    // writeHead 后抛错(上游流中断/客户端断开)不可再 writeHead——destroy 兜底,
    // 防客户端挂起;未 writeHead 的错误路径保持 502 JSON。
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.writeHead(502, { 'Content-Type': 'application/json', ...SEC_HEADERS });
    res.end(JSON.stringify({ error: { message: `TDX MCP 转发失败:${String(err?.message ?? err)}` } }));
  }
}

// ─── 亿信同源代理(/billions-proxy)───────────────────────────────────────────
// web 端亿信 CORS 根治:亿信实际 POST 响应不带 Access-Control-Allow-Origin
// (预检 204 有、实际响应无,08-29 实证),浏览器直连被 CORS 拦截(status 0/
// Failed to fetch)→ 同源代理转发(BillionsClient 经 makeProxyBillionsFetch
// 走本端点,src/billionsClient.ts)。固定 host openapi.billionsintelligence.com
// + path 白名单四端点 → 零 SSRF 面(目标不可由客户端指向其他 host)。
// 头白名单(S6 纪律,与 src/billionsClient.ts FORWARD 同名单:x-api-key/
// content-type/accept);响应 JSON 透传(亿信非流式);redirect manual。
const BILLIONS_TARGET_ORIGIN = 'https://openapi.billionsintelligence.com';
const BILLIONS_ALLOWED_PATHS = new Set(['/api/v1/fin_db', '/api/v2/search', '/api/v2/twitter/search', '/api/v2/fetch']);
const BILLIONS_FORWARD_HEADERS = new Set(['x-api-key', 'content-type', 'accept']);

async function handleBillionsProxy(req, res, _fetch = fetch) {
  try {
    // 固定 host + path 白名单(非白名单路径 → 403;畸形 URL → 400 不崩进程)
    let path;
    try {
      // 挂载点前缀剥离(server.mjs/metro 以 req.url.startsWith('/billions-proxy')
      // 路由,handler 收到的 url 含此前缀;真实目标 path 在其后)
      path = new URL(req.url, 'http://x').pathname.replace(/^\/billions-proxy/, '') || '/';
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json', ...SEC_HEADERS });
      res.end(JSON.stringify({ error: '非法请求 URL' }));
      return;
    }
    if (!BILLIONS_ALLOWED_PATHS.has(path)) {
      res.writeHead(403, { 'Content-Type': 'application/json', ...SEC_HEADERS });
      res.end(JSON.stringify({ error: `亿信代理路径被拒:${path}(白名单四端点)` }));
      return;
    }
    // W2 同款:请求体超 MAX_BODY_BYTES → 413 并终止读取
    const parts = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        res.writeHead(413, { 'Content-Type': 'application/json', ...SEC_HEADERS });
        res.end(JSON.stringify({ error: '亿信代理请求体超过 1MB 限制' }));
        return;
      }
      parts.push(chunk);
    }
    // Buffer 原样转发(不 JSON.parse——body 是 JSON-RPC 风格,服务端无需理解)
    const body = Buffer.concat(parts);
    const forwardHeaders = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (value !== undefined && BILLIONS_FORWARD_HEADERS.has(name.toLowerCase())) {
        forwardHeaders[name] = value;
      }
    }
    const upstream = await _fetch(`${BILLIONS_TARGET_ORIGIN}${path}`, {
      method: 'POST',
      headers: forwardHeaders,
      body,
      redirect: 'manual',
    });
    const text = await upstream.text(); // 亿信响应为 JSON(非流式),整体缓冲
    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'application/json',
      ...SEC_HEADERS,
    });
    res.end(text);
  } catch (err) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.writeHead(502, { 'Content-Type': 'application/json', ...SEC_HEADERS });
    res.end(JSON.stringify({ error: { message: `亿信代理转发失败:${String(err?.message ?? err)}` } }));
  }
}

module.exports = {
  handleLlmProxy,
  handleTdxCollect,
  handleYahooCollect,
  handleWebSearch,
  handleTdxMcp,
  handleBillionsProxy,
  // 测试/复用导出(新增,不删旧)
  MAX_BODY_BYTES, // W2 上限
  COLLECT_TIMEOUT_MS, // W4 超时
  YAHOO_COLLECT_TIMEOUT_MS, // Yahoo 采集超时
  TDX_MCP_TARGET, // F2 固定目标(零 SSRF 面)
  TDX_MCP_TIMEOUT_MS, // F2 超时
  BILLIONS_TARGET_ORIGIN, // 亿信固定目标(零 SSRF 面)
  isYahooMarket, // E9 布尔谓词(与 yahooMarketOfTicker 单源;测试等价回归)
  normalizeBaseUrl, // C2 base 校验
  isPrivateAddress,
  isPublicHost,
};
