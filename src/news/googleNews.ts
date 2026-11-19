// Google News RSS —— hk/us 实时市场情报源（对齐 cn 的 TDX MCP 情报段）。
//
// 为什么是这个源:
// - Yahoo 新闻端点已死(v1/finance/search 实测 news:[] 空数组,2026-11-19),
//   quoteSummary 无新闻模块 → hk/us 块 4 一直是「暂无实时市场情报源」占位。
// - Google News RSS 免 key、免 crumb,`/rss/search?q=…` 实测 100 条、含标题/
//   来源/时间/链接;hk 用 zh-HK 版、us 用 en-US 版(市场本地语言更贴题)。
//
// 纯 TS + fetch-only(无 node:/DOM 依赖,浏览器/RN/Node 三端同一实现;web 端
// CORS 走同源 /news-feed 代理,见 makeProxyNewsFetch)。解析用正则而非 DOM:
// RN(Hermes)无 DOMParser,RSS 结构又足够规整(仅 <item> 展开)。
import { fetchWithTimeout } from '../yahoo/yahooClient.ts';
import { marketInfo, type Market } from '../market.ts';
import { decodeEntities } from '../webSearch.ts';

/** 直连出网单请求超时（量级对齐 webSearch 的 20s;RSS 单请求,无串行链）。 */
const NEWS_TIMEOUT_MS = 20_000;

/** 单次情报段最多条数（LLM 上下文成本 vs 覆盖面的折中;对齐 webSearch 5 条的
 *  量级、略放宽——新闻标题短,8 条仍远小于财务段）。 */
export const NEWS_LIMIT = 8;

/** 时效上限(月):超期条目丢弃。E2E 实测(2026-11-19,0700.HK)Google News 的
 *  relevance 排序会混进 2017/2020 的老文章(8 条里 3 条)——RSS 本身不保证
 *  时间序,喂给 LLM 的「近期新闻」必须自己截。 */
export const NEWS_MAX_AGE_MONTHS = 18;

export interface NewsItem {
  title: string;
  link: string;
  /** 原始 pubDate(RFC822);无法解析 → ''。 */
  published: string;
  source: string;
}

/** 市场 → Google News 本地化参数（hk 中文版 / us 英文版）。 */
function localeOf(market: Market): string {
  return market === 'hk' ? 'hl=zh-HK&gl=HK&ceid=HK:zh-Hant' : 'hl=en-US&gl=US&ceid=US:en';
}

/** 查询串：代码 + 公司名（有名字时 OR 并联，覆盖「0700.HK」与公司名两种写法）。
 *  HK 保留 '.HK' 后缀（Yahoo/雅虎财经报道就用这个形），数字前导零不剥；
 *  US 直接用原 ticker（不拼 '.HK'）。 */
export function newsQueryFor(ticker: string, name: string | null): string {
  const symbol = ticker;
  const bare = name === null || name === '' || name === ticker ? '' : ` OR "${name}"`;
  return `"${symbol}"${bare}`;
}

/** RSS 请求 URL（market 决定语言/地区参数）。 */
export function googleNewsUrl(query: string, market: Market): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&${localeOf(market)}`;
}

/** 固定标签 → 预编译正则（不用动态 RegExp 拼接：只这四种标签，静态表
 *  既免转义也可能避开动态正则的安全面）。 */
const TAG_RES = {
  title: /<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/,
  link: /<link(?:\s[^>]*)?>([\s\S]*?)<\/link>/,
  pubDate: /<pubDate(?:\s[^>]*)?>([\s\S]*?)<\/pubDate>/,
  source: /<source(?:\s[^>]*)?>([\s\S]*?)<\/source>/,
} as const;

/** 取 <tag>…</tag> 内容（容忍 CDATA 与属性；无 → ''）。 */
function tagText(block: string, name: keyof typeof TAG_RES): string {
  const m = TAG_RES[name].exec(block);
  if (!m) return '';
  return (m[1] ?? '').replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
}

/** Google News 标题形如「标题 - 来源」；有 <source> 时去掉重复尾缀。
 *  (实体解码后比较——来源名里含 & 的情况实测存在。) */
function cleanTitle(title: string, source: string): string {
  const suffix = ` - ${source}`;
  if (source !== '' && title.endsWith(suffix)) return title.slice(0, -suffix.length);
  return title;
}

/** RSS XML → NewsItem[]（最多 limit 条；无 <item> → []，不抛）。
 *  只做结构性容错：缺 title 的条目丢弃（无标题无法喂 LLM）。 */
export function parseGoogleNewsRss(xml: string, limit: number = NEWS_LIMIT): NewsItem[] {
  const items: NewsItem[] = [];
  const blocks = xml.split('<item>').slice(1);
  for (const raw of blocks) {
    if (items.length >= limit) break;
    const block = raw.split('</item>')[0] ?? '';
    const source = decodeEntities(tagText(block, 'source'));
    const title = cleanTitle(decodeEntities(tagText(block, 'title')), source);
    if (title === '') continue;
    items.push({ title, link: tagText(block, 'link'), published: tagText(block, 'pubDate'), source });
  }
  return items;
}

/** RFC822 pubDate → 'YYYY-MM-DD'(解析失败 → ''，不猜)。 */
export function newsDate(published: string): string {
  if (published === '') return '';
  const ts = Date.parse(published);
  if (Number.isNaN(ts)) return '';
  return new Date(ts).toISOString().slice(0, 10);
}

/** 直连拉取（RN 真机 / Node 探针 / server 代理内部复用）。
 *
 * @param query newsQueryFor 产物（或任意检索串）
 * @param market 决定语言/地区
 * @param opts.fetchImpl 注入（测试/代理）;缺省全局 fetch
 * @throws Error 网络失败/非 2xx（调用方 catch → 占位文本，不中断分析）
 */
export async function fetchGoogleNews(
  query: string,
  market: Market,
  opts?: { fetchImpl?: typeof fetch; limit?: number },
): Promise<NewsItem[]> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const resp = await fetchWithTimeout(
    fetchImpl,
    googleNewsUrl(query, market),
    { headers: { 'User-Agent': 'Mozilla/5.0' } },
    NEWS_TIMEOUT_MS,
    'Google News',
  );
  if (!resp.ok) throw new Error(`Google News HTTP ${resp.status}`);
  const limit = opts?.limit ?? NEWS_LIMIT;
  // 先按放宽的条数解析（时效过滤会丢掉老文章），过滤后再截到 limit ——
  // 否则 limit 先砍会把「8 条里 3 条过期」变成只剩 5 条
  const parsed = parseGoogleNewsRss(await resp.text(), Math.max(limit * 4, 20));
  return filterRecentNews(parsed).slice(0, limit);
}

/** 时效过滤：published 可解析且早于 cutoff → 丢弃；published 缺失/不可解析
 *  → 保留（判不了龄就不替用户决定，宁多勿错删）。
 *
 * @param now 参考时刻（测试注入）
 * @param maxAgeMonths 时效上限月数（缺省 NEWS_MAX_AGE_MONTHS = 18） */
export function filterRecentNews(
  items: NewsItem[],
  now: Date = new Date(),
  maxAgeMonths: number = NEWS_MAX_AGE_MONTHS,
): NewsItem[] {
  // 30 天/月常量近似（新闻时效判定不需要日历精度，避免引入时区/闰月分支）
  const cutoff = now.getTime() - maxAgeMonths * 30 * 24 * 3600 * 1000;
  return items.filter((item) => {
    const ts = Date.parse(item.published);
    if (Number.isNaN(ts)) return true;
    return ts >= cutoff;
  });
}

/** 新闻列表 → 中文情报段（无条目 → 空串，调用方回退占位文本）。 */
export function newsIntelText(items: NewsItem[], ticker: string, market: Market): string {
  if (!items.length) return '';
  const lines = [`【近期新闻（${marketInfo(market).label} ${ticker} · Google News，${items.length} 条）】`];
  for (const item of items) {
    const date = newsDate(item.published);
    const from = item.source === '' ? '' : `（${item.source}）`;
    lines.push(`- ${date === '' ? '' : `${date} `}${item.title}${from}`);
  }
  return lines.join('\n');
}

/** 浏览器 → server 同源 /news-feed（Yahoo/搜索代理同款语义;绕开 CORS）。
 *  S6:X-SOA-Token 仅在 EXPO_PUBLIC_SOA_ACCESS_TOKEN 存在时附带（远程模式
 *  要求;EXPO_PUBLIC_* 直接成员访问以便 babel 静态内联，见 webSearch 先例）。 */
export function makeProxyNewsFetch(
  base: string,
  _fetch: typeof fetch = fetch,
): (query: string, market: Market) => Promise<NewsItem[]> {
  return async (query, market) => {
    const soaToken = process.env.EXPO_PUBLIC_SOA_ACCESS_TOKEN;
    const url = `${base}/news-feed?q=${encodeURIComponent(query)}&market=${encodeURIComponent(market)}`;
    const resp = await fetchWithTimeout(
      _fetch,
      url,
      soaToken ? { headers: { 'X-SOA-Token': soaToken } } : {},
      NEWS_TIMEOUT_MS,
      'Google News 代理',
    );
    if (!resp.ok) throw new Error(`news-feed 代理 HTTP ${resp.status}`);
    const body = (await resp.json()) as { items?: NewsItem[] };
    return body.items ?? [];
  };
}
