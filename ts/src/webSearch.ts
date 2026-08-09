// 联网搜索工具 —— 移植自 Python core/llms/tools/web_search.py
// 供应商：TAVILY_API_KEY 配置 → Tavily（主选）；未配置 → 空结果占位
// （Python 侧 DDG 降级——langchain_community 系 sunset，TS 侧 M4 决定是否移植；
// 本模块降级语义：查询失败/空结果 → 占位文本不 raise，图不中断）
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
  // 无 key：返回空（Python 侧 DDG 降级，TS 侧待 M4 决定）
  return async () => [];
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
