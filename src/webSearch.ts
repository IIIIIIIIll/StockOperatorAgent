// 联网搜索工具 —— 移植自 Python core/llms/tools/web_search.py
// 供应商：TAVILY_API_KEY 配置 → Tavily（可选主选）；未配置 → DuckDuckGo
// html 端点（免 key，region cn-zh，对齐 Python ddgs 语义）。降级语义：
// 查询失败/空结果 → 占位文本不 raise，图不中断。
// 直连出网(Tavily/DDG)每请求 20s 超时(C6,fetchWithTimeout label 归一文案);
// 浏览器同源代理分支(makeProxySearcher)不加超时——server /web-search race 兜底。
import { detectPlatform } from './log.ts';
import { envValue } from './env.ts';
import { getCapabilitySwitches } from './switches.ts';
import type { ToolLike } from './toolLoop.ts';
import { fetchWithTimeout } from './yahoo/yahooClient.ts';

/** 直连出网单请求超时(C6):20s/请求(html → vqd → news.js 最坏串行 3 请求,
 *  全链上界 ~60s 仍有界);量级对齐 server /web-search 的整体 20s race
 *  (app/lib/proxies.cjs SEARCH_TIMEOUT_MS)。 */
const FETCH_TIMEOUT_MS = 20_000;

export interface SearchResult {
  title: string;
  link: string;
  snippet: string;
  date?: string;
  url?: string; // Tavily 原生字段（归一化时映射到 link）
}

/** web 搜索能力开关(语义 enabled):config.webSearch(面板/注入;Node 直配 env
 *  由 fromEnv 反推 WEB_SEARCH_DISABLED)。消费点惰性读——禁止模块级求值。 */
export function webSearchEnabled(): boolean {
  return getCapabilitySwitches().webSearch;
}

/** 结果 dict 列表 → 中文摘要文本；无有效条目 → 占位（对齐 Python _summarize_results）。 */
export function summarizeResults(results: SearchResult[]): string {
  const lines: string[] = [];
  for (const item of results) {
    const title = item.title ?? '';
    const link = item.link ?? item.url ?? '';
    const snippet = item.snippet ?? '';
    if (!(title || link || snippet)) continue;
    const parts: string[] = [];
    if (title) parts.push(`标题：${title}`);
    if (link) parts.push(`链接：${link}`);
    if (snippet) parts.push(`摘要：${snippet}`);
    if (item.date) parts.push(`日期：${item.date}`);
    lines.push(`- ${parts.join('；')}`);
  }
  if (!lines.length) return '（联网搜索失败：无返回结果）';
  return `【联网搜索结果】\n${lines.join('\n')}`;
}

function tavilySearcher(apiKey: string): (query: string) => Promise<SearchResult[]> {
  return async (query: string) => {
    const resp = await fetchWithTimeout(
      fetch,
      'https://api.tavily.com/search',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey, query, max_results: 5 }),
      },
      FETCH_TIMEOUT_MS,
      'Tavily',
    );
    if (!resp.ok) throw new Error(`Tavily HTTP ${resp.status}`);
    const data = (await resp.json()) as { results?: Array<{ title: string; url: string; content: string }> };
    return (data.results ?? []).map((r) => ({ title: r.title, link: r.url, snippet: r.content }));
  };
}

/** 同源代理 searcher（浏览器分支：fetch /web-search → {results} JSON；
 * 非 ok / results 缺失或空 → throw，由调用方降级（error-handling spec）。
 * 不加超时——server 端整体 race 兜底,C6 有意豁免的分支。 */
export function makeProxySearcher(
  base: string,
  _fetch: typeof fetch = fetch,
): (query: string) => Promise<SearchResult[]> {
  return async (query: string) => {
    const resp = await _fetch(`${base}/web-search?q=${encodeURIComponent(query)}`);
    if (!resp.ok) throw new Error(`web-search 代理 HTTP ${resp.status}`);
    const data = (await resp.json()) as { results?: SearchResult[] };
    const results = data.results;
    if (!results?.length) throw new Error('web-search 代理无返回结果');
    return results;
  };
}

// 浏览器全局（ts/ 为 node-only lib 无 DOM 类型；仅 detectPlatform()==='web'
// 分支访问——平台判定收敛到 log.ts isWebEnv,此处不再自写 typeof 守卫）。
declare const window: { location?: { origin?: string } } | undefined;

/** 缺省 searcher：浏览器 → 同源 /web-search 代理；Node/真机 → Tavily 优先 / DDG。
 *  惰性：函数体每次调用重读 env（非模块级单例）。EXPO_PUBLIC_TAVILY_API_KEY
 *  必须直接成员访问（真机 release 经 babel-preset-expo 静态内联——architecture
 *  契约 6 豁免）；TAVILY_API_KEY(Node/server 路径)经 envValue 单点。 */
export function defaultSearcher(): (query: string) => Promise<SearchResult[]> {
  if (detectPlatform() === 'web' && window?.location?.origin) {
    return makeProxySearcher(window.location.origin);
  }
  // EXPO_PUBLIC_ 前缀真机可达(Metro 内联);未配时回退 TAVILY_API_KEY(Node/server 路径现状)。
  const key = process.env.EXPO_PUBLIC_TAVILY_API_KEY ?? envValue('TAVILY_API_KEY');
  if (key) return tavilySearcher(key);
  return ddgSearcher;
}

// ─── DuckDuckGo(免 key;html 端点,对齐 Python ddgs 的 cn-zh 语义) ──────────

/** HTML 实体解码(无 DOM 依赖,浏览器/RN/Node 通用)。 */
export function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&hellip;/g, '…')
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCharCode(Number(code)));
}

/** 去 HTML 标签 + 解码实体。 */
export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

/** DDG 重定向链接 → 真实 URL(//duckduckgo.com/l/?uddg=<encoded>)。 */
export function decodeDdgUrl(href: string): string {
  const full = href.startsWith('//') ? `https:${href}` : href;
  try {
    const u = new URL(full);
    const uddg = u.searchParams.get('uddg');
    if (uddg) return decodeURIComponent(uddg);
  } catch {
    /* 保留原样 */
  }
  return full;
}

/** 解析 html.duckduckgo.com/html 响应(合成 HTML 可离线测)。 */
export function parseDdgHtml(html: string): SearchResult[] {
  const titles: Array<{ link: string; title: string }> = [];
  const aRe = /class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = aRe.exec(html)) !== null) {
    titles.push({ link: decodeDdgUrl(m[1]), title: stripTags(m[2]) });
  }
  const snippets: string[] = [];
  const snRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  while ((m = snRe.exec(html)) !== null) {
    snippets.push(stripTags(m[1]));
  }
  return titles.map((t, i) => ({ ...t, snippet: snippets[i] ?? '' }));
}

/** DDG 前端页 vqd 令牌（news.js JSON API 请求头所需；对齐 ddgs _get_vqd）。 */
async function fetchVqd(query: string, _fetch: typeof fetch = fetch): Promise<string> {
  const resp = await fetchWithTimeout(_fetch, `https://duckduckgo.com/?q=${encodeURIComponent(query)}`, {}, FETCH_TIMEOUT_MS, 'DuckDuckGo');
  if (!resp.ok) throw new Error(`DuckDuckGo 前端 HTTP ${resp.status}`);
  const html = await resp.text();
  const m = /vqd="([^"]+)"/.exec(html);
  if (!m) throw new Error('DuckDuckGo vqd 令牌获取失败');
  return m[1];
}

/** news.js JSON 端点（免 key;region cn-zh 对齐 ddgs news 引擎——html 端点
 * 被反爬拦截时的回退：vqd + 现代 JSON API，2026-08-11 本机实测无需 TLS
 * 指纹技巧即可返回结果）。date 为 unix 秒 → YYYY-MM-DD。 */
async function ddgNewsSearcher(query: string, _fetch: typeof fetch = fetch): Promise<SearchResult[]> {
  const vqd = await fetchVqd(query, _fetch);
  const params = new URLSearchParams({ l: 'cn-zh', o: 'json', noamp: '1', q: query, vqd, p: '-1' });
  const resp = await fetchWithTimeout(_fetch, `https://duckduckgo.com/news.js?${params.toString()}`, {}, FETCH_TIMEOUT_MS, 'DuckDuckGo');
  if (!resp.ok) throw new Error(`DuckDuckGo news HTTP ${resp.status}`);
  const data = (await resp.json()) as { results?: Array<{ title?: string; url?: string; excerpt?: string; date?: number }> };
  const results = (data.results ?? []).map((r) => ({
    title: r.title ?? '',
    link: r.url ?? '',
    snippet: r.excerpt ?? '',
    ...(r.date ? { date: new Date(r.date * 1000).toISOString().slice(0, 10) } : {}),
  }));
  if (!results.length) throw new Error('DuckDuckGo 无返回结果');
  return results;
}

/** DuckDuckGo 查询(免 key;region cn-zh 对齐 Python ddgs)：html 端点优先，
 * 被反爬拦截（异常页无 result__a）→ 回退 vqd + news.js JSON API。 */
export async function ddgSearcher(query: string): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query, kl: 'cn-zh' });
  const resp = await fetchWithTimeout(
    fetch,
    'https://html.duckduckgo.com/html/',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    },
    FETCH_TIMEOUT_MS,
    'DuckDuckGo',
  );
  if (!resp.ok) throw new Error(`DuckDuckGo HTTP ${resp.status}`);
  const results = parseDdgHtml(await resp.text());
  if (!results.length) return ddgNewsSearcher(query); // 反爬异常页 → news.js 回退
  return results;
}

/** web_search 工具 OpenAI function description（对齐 Python make_web_search_tool docstring）。 */
const WEB_SEARCH_DESCRIPTION =
  '联网搜索(DuckDuckGo 中文财经源,cn-zh),可验证行业与市场的最新论据(如新闻、公告、政策)。查询失败时返回占位文本。';

/** web_search 工具 JSON Schema（OpenAI function parameters 形态）——{name,schema}
 *  命中 @langchain/core isStructuredToolParams，bindTools 自动转 OpenAI function
 *  （type:'function' 包装），修复裸 {name,invoke} 透传导致的 400。 */
const WEB_SEARCH_SCHEMA = {
  type: 'object',
  properties: {
    query: { type: 'string', description: '搜索查询词' },
  },
  required: ['query'],
};

/** 构造 web_search 工具（对齐 Python make_web_search_tool：_searcher 注入点）。 */
export function makeWebSearchTool(_searcher?: (query: string) => Promise<SearchResult[]>): ToolLike {
  const search = _searcher ?? defaultSearcher();
  return {
    name: 'web_search',
    description: WEB_SEARCH_DESCRIPTION,
    schema: WEB_SEARCH_SCHEMA,
    invoke: async (args: Record<string, unknown>) => {
      try {
        return summarizeResults(await search(String(args.query ?? '')));
      } catch (err) {
        return `（联网搜索失败：${(err as Error).message}）`;
      }
    },
  };
}
