// 亿信检索工具三件套（billions_search / billions_twitter / billions_fetch）
// —— 移植自 Python core/llms/tools/billions_{search,twitter,fetch}.py。
// 多头/空头交易员与投资经理经 LLM 工具调用（toolLoop bindTools 语义）按需
// 检索公告/研报/新闻/推特/全文，结果以 ToolMessage 回流参与生成。
//
// 约定（对齐 Python + error-handling 降级风格，与 webSearch 同形状）：
// - 开关关 / 无 BILLIONS_API_KEY → 工厂返回 undefined（图装配不绑定，
//   现有 agent 流程零行为变化）
// - 调用硬上限：闭包计数器，单次 run 内超限 → 占位提示，不再发真实请求
// - 查询失败 / 无返回结果 → 占位文本，不 raise（模型继续生成，图不中断）
// - 客户端懒加载（构造注入 client 或 apiKey；无 key 环境零副作用）
import type { ToolLike } from './toolLoop.ts';
import { warn } from './log.ts';
import { BillionsClient, type FetchLike } from './billionsClient.ts';
import { billionsEnabled } from './committee.ts';
import { envValue } from './env.ts';

export const BILLIONS_DEFAULT_MAX: Record<BillionsCapKey, number> = {
  SEARCH: 3,
  TWITTER: 2,
  FETCH: 3,
};

/** 亿信响应 result[].content[] 条目收集（非 dict 脏条目跳过，字段缺失容错）。
 *  对齐 Python _items.collect_content_items。 */
export function collectContentItems(data: Record<string, unknown>): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = [];
  for (const entry of (data.result ?? []) as unknown[]) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const content = (entry as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        items.push(item as Record<string, unknown>);
      }
    }
  }
  return items;
}

function _extra(item: Record<string, unknown>): Record<string, unknown> {
  const e = item.extra;
  return typeof e === 'object' && e !== null && !Array.isArray(e) ? (e as Record<string, unknown>) : {};
}

/** 单条检索结果 → Markdown 行；无有效字段（无标题且无链接）→ null。
 *  对齐 Python billions_search._format_item。 */
export function formatSearchItem(item: Record<string, unknown>): string | null {
  const title = String(item.title ?? '');
  const link = String(item.link ?? '');
  if (!(title || link)) return null;
  const extra = _extra(item);
  const parts: string[] = [];
  if (title && link) parts.push(`[${title}](${link})`);
  else if (link) parts.push(link);
  else parts.push(title);
  if (item.date !== undefined && item.date !== null && item.date !== '') parts.push(String(item.date));
  if (extra.institution) parts.push(String(extra.institution));
  if (extra.doc_id) parts.push(`doc_id: ${extra.doc_id}`);
  let line = parts.join(' — ');
  if (item.snippet) line += `(${item.snippet})`;
  return `- ${line}`;
}

/** search 响应 → 带标题的 Markdown 列表；无有效条目 → 占位文本（不 raise）。 */
export function summarizeSearchResults(data: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const item of collectContentItems(data)) {
    const line = formatSearchItem(item);
    if (line !== null) lines.push(line);
  }
  if (!lines.length) return '（亿信检索失败：无返回结果）';
  return `【亿信检索结果】\n${lines.join('\n')}`;
}

/** 单条推文 → Markdown 行；无正文 → null。对齐 Python billions_twitter._format_tweet。 */
export function formatTweetItem(item: Record<string, unknown>): string | null {
  const snippet = String(item.snippet ?? '');
  if (!snippet) return null;
  const extra = _extra(item);
  let username = extra.username !== undefined && extra.username !== null ? String(extra.username) : '';
  if (!username) {
    const title = String(item.title ?? '');
    if (title.startsWith('@')) username = title.split(':', 1)[0];
  }
  if (username && !username.startsWith('@')) username = `@${username}`;
  const parts: string[] = [];
  if (username) parts.push(username);
  if (extra.view_count !== undefined && extra.view_count !== null) parts.push(`${extra.view_count} 次浏览`);
  if (item.date !== undefined && item.date !== null && item.date !== '') parts.push(String(item.date));
  let line = `${parts.join(' — ')} — ${snippet}`;
  if (item.link) line += ` [${item.link}]`;
  return `- ${line}`;
}

/** twitter 响应 → 带标题的 Markdown 列表；无有效条目 → 占位文本。 */
export function summarizeTweets(data: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const item of collectContentItems(data)) {
    const line = formatTweetItem(item);
    if (line !== null) lines.push(line);
  }
  if (!lines.length) return '（亿信推特检索失败：无返回结果）';
  return `【亿信推特结果】\n${lines.join('\n')}`;
}

/** fetch 响应 → 标题 + Markdown 正文；无正文 → 占位文本。 */
const FETCH_MAX_CONTENT_CHARS = 3000;
export function formatFetch(data: Record<string, unknown>): string {
  const title = String(data.title ?? '');
  let content = String(data.content ?? '');
  if (!content) return '（亿信全文抓取失败：无返回内容）';
  if (content.length > FETCH_MAX_CONTENT_CHARS) {
    content = content.slice(0, FETCH_MAX_CONTENT_CHARS) + `\n（内容过长，已截断至前 ${FETCH_MAX_CONTENT_CHARS} 字符）`;
  }
  const header = title ? `【亿信网页全文】${title}` : '【亿信网页全文】';
  return `${header}\n${content}`;
}

/** 亿信工具公共骨架（对齐 Python _capped.capped_call）：上限判定 → 计数 →
 *  try/except 降级占位（不 raise）。fn 可为 async（client 调用为网络请求）。 */
async function cappedCall(
  counter: number[],
  maxCalls: number,
  capText: string,
  failFmt: string,
  warnMsg: string,
  fn: () => string | Promise<string>,
): Promise<string> {
  if (counter[0] >= maxCalls) return capText.replace('{max_calls}', String(maxCalls));
  counter[0] += 1;
  try {
    return await fn();
  } catch (err) {
    warn(`${warnMsg} ${String(err)}`);
    return failFmt.replace('{exc}', String((err as Error).message ?? err));
  }
}

/** 亿信能力键（对齐 env BILLIONS_{CAP}_MAX_CALLS 与 settings.caps 三值）。 */
export type BillionsCapKey = 'SEARCH' | 'TWITTER' | 'FETCH';

interface BillionsToolOpts {
  /** 测试注入点（house style 无 mock 框架）——BillionsClient 形状。 */
  client?: BillionsClient;
  /** 构造注入覆盖 env BILLIONS_API_KEY（web 端 key 在 localStorage）。 */
  apiKey?: string;
  /** 单次 run 调用硬上限；缺省读 env BILLIONS_{CAP}_MAX_CALLS 或默认值。
   *  单工具工厂等价于对应能力的注入；三件套工厂由 maxCallsByCap 按能力路由。 */
  maxCalls?: number;
  /** 分能力上限（settings.caps 接线）：search→SEARCH、twitter→TWITTER、
   *  fetch→FETCH，优先于 maxCalls 与 env/默认；字段缺失或非法值（NaN/<=0/
   *  非数字）回退 env/默认。 */
  maxCallsByCap?: Partial<Record<BillionsCapKey, number>>;
  /** fetch 注入（透传 client；仅测试用）。 */
  fetch?: FetchLike;
}

/** 能力开关 + 主闸 key 判定（对齐 Python billions_enabled：主闸 key 存在 且
 *  总闸开 且 能力闸开）。开关面读 config（committee.billionsEnabled：总闸
 *  billions + 能力闸 cap 字段；未注入时 fromEnv 反推 BILLIONS_{CAP}_DISABLED）；
 *  key 判定在此单点承担（apiKey 构造注入 > env BILLIONS_API_KEY）。 */
function billionsCapEnabled(cap: string, apiKey?: string | null): boolean {
  if (!apiKey && !envValue('BILLIONS_API_KEY')) return false;
  return billionsEnabled(cap);
}

/** 上限解析：注入(caps/maxCalls) → env → 默认；注入非法值(NaN/<=0/非数字)回退。
 *  默认面单一来源 = BILLIONS_DEFAULT_MAX（cap 已收窄为 BillionsCapKey，索引必然命中）。 */
function maxCallsFor(cap: BillionsCapKey, injected?: number): number {
  if (injected !== undefined && Number.isFinite(injected) && injected > 0) return injected;
  const env = envValue(`BILLIONS_${cap}_MAX_CALLS`);
  if (env !== undefined && env !== '' && /^\d+$/.test(env)) return Number(env);
  return BILLIONS_DEFAULT_MAX[cap];
}

function makeClient(opts: BillionsToolOpts): BillionsClient {
  return opts.client ?? new BillionsClient({ apiKey: opts.apiKey, fetch: opts.fetch });
}

const SEARCH_SOURCES = ['web', 'academic', 'image', 'video', 'announcement', 'report', 'expert'] as const;

const SEARCH_SCHEMA = {
  type: 'object',
  properties: {
    query: { type: 'string', description: '检索查询词' },
    source: {
      type: 'string',
      enum: [...SEARCH_SOURCES],
      description: 'web 新闻网页(默认)、announcement 公告(带 doc_id)、report 研报(带机构名)、expert 专家观点、academic 学术、image/video 图片视频',
    },
    count: { type: 'number', description: '返回条数(默认 5)' },
    time_range: { type: 'string', description: '限定时间范围，如 "past 3 months"' },
    search_mode: { type: 'string', enum: ['fast', 'advanced', 'expert'], description: 'fast 快(默认) / advanced / expert 更慢更全' },
  },
  required: ['query'],
};

/** 构造亿信 search 检索工具；开关关/无 key → undefined（图装配跳过绑定）。 */
export function makeBillionsSearchTool(opts: BillionsToolOpts = {}): ToolLike | undefined {
  if (!billionsCapEnabled('SEARCH', opts.apiKey)) return undefined;
  const maxCalls = maxCallsFor('SEARCH', opts.maxCallsByCap?.SEARCH ?? opts.maxCalls);
  const calls = [0];
  return {
    name: 'billions_search',
    description: '亿信检索（公告/研报/新闻/专家观点等），可验证行业与市场的最新论据。source 语义：web 新闻网页（默认）、announcement 上市公司公告（结果带 doc_id，可配合 billions_fetch 精读全文）、report 券商研报（结果带机构名）、expert 专家观点、academic 学术、image/video 图片视频。time_range 限定时间范围（如 "past 3 months"、"past 2 weeks"）。search_mode 深度：fast 快（默认）、advanced / expert 更慢但结果更全。单次 run 内调用有次数上限，超限返回占位提示。查询失败时返回占位文本。',
    schema: SEARCH_SCHEMA,
    invoke: async (args: Record<string, unknown>) => {
      const client = makeClient(opts);
      return cappedCall(
        calls, maxCalls,
        '（已达本次运行检索上限（{max_calls} 次），请聚焦最关键的问题再检索）',
        '（亿信检索失败：{exc}）',
        '亿信 search 检索失败:',
        async () => {
          const source = String(args.source ?? 'web');
          const mode = String(args.searchMode ?? args.search_mode ?? 'fast');
          const data = await client.search(String(args.query ?? ''), {
            source,
            searchMode: mode,
            count: Number(args.count ?? 5),
            timeRange: args.timeRange !== undefined && args.timeRange !== null ? String(args.timeRange) : undefined,
          });
          return summarizeSearchResults(data);
        },
      );
    },
  };
}

const TWITTER_SCHEMA = {
  type: 'object',
  properties: {
    query: { type: 'string', description: '检索查询词' },
    count: { type: 'number', description: '返回条数(默认 5)' },
    search_mode: { type: 'string', enum: ['fast', 'advanced', 'expert'], description: 'fast 快(默认) / advanced / expert 更慢更全' },
  },
  required: ['query'],
};

/** 构造亿信 twitter 检索工具；开关关/无 key → undefined。 */
export function makeBillionsTwitterTool(opts: BillionsToolOpts = {}): ToolLike | undefined {
  if (!billionsCapEnabled('TWITTER', opts.apiKey)) return undefined;
  const maxCalls = maxCallsFor('TWITTER', opts.maxCallsByCap?.TWITTER ?? opts.maxCalls);
  const calls = [0];
  return {
    name: 'billions_twitter',
    description: '亿信推特检索（X/推特财经讨论），可了解该股票的市场舆论与实时动态。search_mode 深度：fast 快（默认）、advanced / expert 更慢但结果更全。单次 run 内调用有次数上限，超限返回占位提示。查询失败时返回占位文本。',
    schema: TWITTER_SCHEMA,
    invoke: async (args: Record<string, unknown>) => {
      const client = makeClient(opts);
      return cappedCall(
        calls, maxCalls,
        '（已达本次运行推特检索上限（{max_calls} 次），请聚焦最关键的问题再检索）',
        '（亿信推特检索失败：{exc}）',
        '亿信 twitter 检索失败:',
        async () => {
          const mode = String(args.searchMode ?? args.search_mode ?? 'fast');
          const data = await client.twitterSearch(String(args.query ?? ''), {
            searchMode: mode,
            count: Number(args.count ?? 5),
          });
          return summarizeTweets(data);
        },
      );
    },
  };
}

const FETCH_SCHEMA = {
  type: 'object',
  properties: {
    url: { type: 'string', description: '网页地址（与 doc_id 二选一）' },
    doc_id: { type: 'string', description: '来自 billions_search 结果附带的 doc_id（仅公告全文开放）' },
  },
};

/** 构造亿信 fetch 全文抓取工具；开关关/无 key → undefined。 */
export function makeBillionsFetchTool(opts: BillionsToolOpts = {}): ToolLike | undefined {
  if (!billionsCapEnabled('FETCH', opts.apiKey)) return undefined;
  const maxCalls = maxCallsFor('FETCH', opts.maxCallsByCap?.FETCH ?? opts.maxCalls);
  const calls = [0];
  return {
    name: 'billions_fetch',
    description: '亿信网页/公告全文抓取，可精读公告、研报或新闻全文内容。url（网页地址）与 doc_id（来自 billions_search 检索结果附带的 doc_id，仅公告全文开放）二选一——两者都传或都不传会失败。单次 run 内调用有次数上限，超限返回占位提示。抓取失败时返回占位文本。',
    schema: FETCH_SCHEMA,
    invoke: async (args: Record<string, unknown>) => {
      const client = makeClient(opts);
      return cappedCall(
        calls, maxCalls,
        '（已达本次运行全文抓取上限（{max_calls} 次），请聚焦最关键的内容再抓取）',
        '（亿信全文抓取失败：{exc}）',
        '亿信 fetch 全文抓取失败:',
        async () => {
          const url = args.url !== undefined && args.url !== null ? String(args.url) : undefined;
          const docId = args.doc_id !== undefined && args.doc_id !== null ? String(args.doc_id) : undefined;
          if (url !== undefined && !/^https?:\/\//.test(url)) {
            // 工具 schema 注明仅接受 http(s)；本地校验防任意协议（对齐 security F10）
            return '（亿信全文抓取失败：url 仅支持 http(s) 协议）';
          }
          const data = await client.fetchDoc({ url, docId });
          return formatFetch(data);
        },
      );
    },
  };
}

/** 亿信工具三件套（按各自开关 + 主闸 key 过滤）；全部关/无 key → 空数组。 */
export function makeBillionsTools(opts: BillionsToolOpts = {}): ToolLike[] {
  const tools: ToolLike[] = [];
  const search = makeBillionsSearchTool(opts);
  const twitter = makeBillionsTwitterTool(opts);
  const fetch = makeBillionsFetchTool(opts);
  if (search) tools.push(search);
  if (twitter) tools.push(twitter);
  if (fetch) tools.push(fetch);
  return tools;
}
