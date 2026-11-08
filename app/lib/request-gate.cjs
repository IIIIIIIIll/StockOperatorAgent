// 代理端点入站门（单源实现）—— 生产 server.mjs 与 dev metro.config.js 共用。
// 评审 2026-11-08 S8-1/S9-3：这套门此前只在 server.mjs 里有一份，metro 的
// enhanceMiddleware 只有 Origin 判据 —— 跨站 <img>/<script> GET 不带 Origin，
// dev 入口等于零防护（而 README 让用户跑的就是 dev）。逻辑搬到 lib/ 后两个入口
// 调用同一份，防漂移。
const secHeaders = require('./sec-headers.cjs');

const SEC_HEADERS = secHeaders.SEC_HEADERS ?? secHeaders;

/** 需要门禁的代理/日志路径前缀（两个入口共用同一张表）。 */
const PROXY_PATHS = [
  '/llm-proxy/',
  '/tdx-collect',
  '/yahoo-collect',
  '/web-search',
  '/tdx-mcp',
  '/billions-proxy',
];

function isProxyPath(url) {
  if (typeof url !== 'string') return false;
  if (url === '/logs') return true;
  return PROXY_PATHS.some((p) => url.startsWith(p));
}

/** A6：Host 头是否 loopback（DNS rebinding 硬化）。localhast / 127.0.0.0/8 /
 *  [::1]（含 IPv4-mapped），端口可有可无，大小写不敏感。 */
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

/** 连接本地端点是否 loopback（判定 Host 校验启停）。 */
function isLoopbackBind(addr) {
  return typeof addr === 'string' && (addr === '::1' || addr === '::ffff:127.0.0.1' || /^127\./.test(addr));
}

/** bind host 串是否回环（决定 token 门启停）。'localhost' / 127.0.0.0/8 /
 *  '[::1]' / 裸 '::1'、'::ffff:127.0.0.1' 为真；其余（0.0.0.0、网卡 IP）为假。 */
function isLoopbackBindHost(h) {
  if (typeof h !== 'string' || h === '') return false;
  if (h === '::1' || h === '::ffff:127.0.0.1') return true;
  return isLoopbackHostHeader(h);
}

/** S2：Origin 允许列表 —— 仅接受 无 Origin / null / 本站 origin。 */
function isOriginAllowed(req) {
  const origin = req.headers?.origin;
  if (origin === undefined || origin === null || origin === 'null') return true;
  const host = req.headers?.host;
  if (typeof host !== 'string' || host === '') return false;
  const o = String(origin).toLowerCase();
  const h = String(host).toLowerCase();
  return o === `http://${h}` || o === `https://${h}`;
}

/**
 * 代理路径的入站门：Origin → Sec-Fetch-Site → 可选 token。
 * @returns {null | { status: number, body: string, headers?: Record<string,string> }}
 *          null = 放行；否则应回该状态码（body 为纯文本或 JSON）。
 */
function proxyGate(req, { requireToken = false, accessToken = '' } = {}) {
  if (!isProxyPath(req.url)) return null;
  if (!isOriginAllowed(req)) return { status: 403, body: 'Forbidden' };
  // CR-53：GET 简单请求（img/script）不带 Origin，用 Sec-Fetch-Site 补一道。
  // curl/探针无该头 → 放行，不误伤本地工具。
  const site = req.headers?.['sec-fetch-site'];
  if (site === 'cross-site' || site === 'same-site') return { status: 403, body: 'Forbidden' };
  if (requireToken) {
    const token = req.headers?.['x-soa-token'];
    if (!accessToken || token !== accessToken) {
      return {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...SEC_HEADERS },
        body: JSON.stringify({ error: '未授权:非回环监听需 X-SOA-Token(SOA_ACCESS_TOKEN)' }),
      };
    }
  }
  return null;
}

module.exports = {
  PROXY_PATHS,
  isProxyPath,
  isLoopbackHostHeader,
  isLoopbackBind,
  isLoopbackBindHost,
  isOriginAllowed,
  proxyGate,
};
