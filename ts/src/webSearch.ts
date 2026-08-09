// 联网搜索工具 —— 移植自 Python core/llms/tools/web_search.py
// 供应商：TAVILY_API_KEY 配置 → Tavily（可选主选）；未配置 → DuckDuckGo
// html 端点（免 key，region cn-zh，对齐 Python ddgs 语义）。降级语义：
// 查询失败/空结果 → 占位文本不 raise，图不中断。
import type { ToolLike } from './toolLoop.ts';

export interface SearchResult {
  title: string;
  link: string;
  snippet: string;
  date?: string;
  url?: string; // Tavily 原生字段（归一化时映射到 link）
}

/** env 判定：存在且值非 ""/"0"/"false"/"no" → 禁用（对齐 Python env_disabled）。 */
export function envDisabled(name: string): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return false;
  return !['0', 'false', 'no'].includes(v.toLowerCase());
}

export function webSearchEnabled(): boolean {
  return !envDisabled('WEB_SEARCH_DISABLED');
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
    const resp = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, query, max_results: 5 }),
    });
    if (!resp.ok) throw new Error(`Tavily HTTP ${resp.status}`);
    const data = (await resp.json()) as { results?: Array<{ title: string; url: string; content: string }> };
    return (data.results ?? []).map((r) => ({ title: r.title, link: r.url, snippet: r.content }));
  };
}

function defaultSearcher(): (query: string) => Promise<SearchResult[]> {
  const key = process.env.TAVILY_API_KEY;
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

/** DuckDuckGo html 端点查询(免 key;region cn-zh 对齐 Python ddgs)。 */
async function ddgSearcher(query: string): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query, kl: 'cn-zh' });
  const resp = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!resp.ok) throw new Error(`DuckDuckGo HTTP ${resp.status}`);
  const results = parseDdgHtml(await resp.text());
  if (!results.length) throw new Error('DuckDuckGo 无返回结果');
  return results;
}

/** 构造 web_search 工具（对齐 Python make_web_search_tool：_searcher 注入点）。 */
export function makeWebSearchTool(_searcher?: (query: string) => Promise<SearchResult[]>): ToolLike {
  const search = _searcher ?? defaultSearcher();
  return {
    name: 'web_search',
    invoke: async (args: Record<string, unknown>) => {
      try {
        return summarizeResults(await search(String(args.query ?? '')));
      } catch (err) {
        return `（联网搜索失败：${(err as Error).message}）`;
      }
    },
  };
}
