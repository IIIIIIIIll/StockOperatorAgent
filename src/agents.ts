// AgentNode —— 移植自 Python agents/base.py（08-09-agent-base-class）
// 不变管道：prompt 壳 + bind_tools 回退 + revise 第二条链 + 节点骨架
// 查询构建为差异化部分——M2 简版（含 info_section 条件段结构），
// 契约声明（C2 决策 2026-08-14）：TS 为最终实现；10 条系统提示词与
// Python prompt.py 逐字节一致；9 条查询模板接受空白差异（Python 双换行/
// 尾部缩进 vs TS 单换行），Python test_query_baselines 基线随 Python 删除。
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import type { RunnableLike } from '@langchain/core/runnables';
import { system_prompt, fundamental_analysis_expert_message, trend_analysis_expert_message, technical_indicator_analyst_message, information_analyst_message, bullish_trader_message, bearish_trader_message, bullish_revise_message, bearish_revise_message, investment_manager_message } from './prompt.ts';
import { getLastBusinessDay } from './gates.ts';
import { invokeWithRetry, streamWithRetry, type StreamableLlm } from './retry.ts';
import { invokeWithTools, type ToolLike } from './toolLoop.ts';
import { pushReport, safeProgress, safePushDelta, safePushStatus, type ProgressUpdater } from './progress.ts';
import { defaultSearcher, summarizeResults, webSearchEnabled, type SearchResult } from './webSearch.ts';
import { billionsEnabled } from './committee.ts';
import { BillionsClient } from './billionsClient.ts';
import { warn } from './log.ts';

export interface LlmLike {
  invoke(payload: unknown, config?: unknown): Promise<{ content: string }>;
  /** 可选:流式调用(方案 B agent 级流式;缺省回退 invokeWithRetry + 单次全量 delta)。 */
  stream?(payload: unknown, config?: unknown): Promise<AsyncIterable<unknown>> | AsyncIterable<unknown>;
  bindTools?(tools: ToolLike[]): LlmLike;
}

type Invokable = { invoke(payload: unknown, config?: unknown): Promise<{ content: string }> };

export type StateLike = Record<string, unknown> & {
  messages?: unknown[];
};

/** 本地今天（YYYY-MM-DD）——对齐 Python datetime.date.today() 语义。 */
export function localToday(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export interface CompleteOptions {
  startMsg: string;
  doneMsg: string;
  logLabel: string;
  /** 图节点名(区分初稿/修订轮;events.ts 经 ROLES nodeName 查表映射 roleKey)。 */
  nodeName: string;
}

export class AgentNode {
  protected llm: unknown; // prompt.pipe(llm) 链
  protected boundLlm: LlmLike;
  protected config: unknown;
  protected progressUpdater: ProgressUpdater | null;
  protected tools: ToolLike[];

  constructor(
    llm: LlmLike,
    config: unknown,
    progressUpdater: ProgressUpdater | null = null,
    tools: ToolLike[] = [],
    roleMessage: string,
  ) {
    const systemText = system_prompt
      .replace('{system_message}', roleMessage)
      .replace('{current_date}', getLastBusinessDay(localToday()));
    const prompt = ChatPromptTemplate.fromMessages([
      ['system', systemText],
      new MessagesPlaceholder('query'),
    ]);
    // 工具角色由 committee 传 tools；不支持 bindTools 的 LLM（离线测试 stub）→ 跳过绑定
    if (tools.length && typeof llm.bindTools === 'function') {
      try {
        llm = llm.bindTools(tools);
      } catch {
        // NotImplementedError 回退：保持直调
      }
    }
    this.boundLlm = llm;
    this.llm = prompt.pipe(llm as unknown as RunnableLike) as unknown as Invokable;
    this.config = config;
    this.progressUpdater = progressUpdater;
    this.tools = tools;
  }

  /** 第二条链（对抗修订轮）：复用构造时已绑定实例（双链共享）。 */
  buildChain(roleMessage: string, llm?: LlmLike): unknown {
    const systemText = system_prompt
      .replace('{system_message}', roleMessage)
      .replace('{current_date}', getLastBusinessDay(localToday()));
    const prompt = ChatPromptTemplate.fromMessages([
      ['system', systemText],
      new MessagesPlaceholder('query'),
    ]);
    return prompt.pipe((llm ?? this.boundLlm) as unknown as RunnableLike);
  }

  /** 流式调用(有 .stream())或回退直调(无 .stream() → invokeWithRetry +
   *  单次全量 delta);delta/retry 经 updater 上报(node 维度)。 */
  protected async streamOrInvoke(
    llm: unknown,
    payload: unknown,
    nodeName: string,
  ): Promise<{ content: unknown; tool_calls?: unknown }> {
    const streamable = (llm as { stream?: StreamableLlm['stream'] }).stream;
    if (typeof streamable === 'function') {
      return streamWithRetry(llm as StreamableLlm, payload, this.config, {
        onDelta: (d) => safePushDelta(this.progressUpdater, nodeName, d),
        onRetry: (_attempt) => safePushStatus(this.progressUpdater, nodeName, 'retry'),
      });
    }
    const response = (await invokeWithRetry(llm as LlmLike, payload, this.config)) as {
      content: unknown;
      tool_calls?: unknown;
    };
    const text = typeof response.content === 'string' ? response.content : String(response.content);
    if (text) safePushDelta(this.progressUpdater, nodeName, text);
    return response;
  }

  /** 专家骨架：running → 进度 → 流式直调 → 进度 → push_report → done。 */
  async completeExpert(
    queryText: string,
    stateKey: string,
    { startMsg, doneMsg, logLabel, nodeName }: CompleteOptions,
  ): Promise<Record<string, unknown>> {
    const query: Array<[string, string]> = [['human', queryText]];
    safePushStatus(this.progressUpdater, nodeName, 'running');
    safeProgress(this.progressUpdater, startMsg);
    const response = await this.streamOrInvoke(this.llm, { query }, nodeName);
    const content = typeof response.content === 'string' ? response.content : String(response.content);
    safeProgress(this.progressUpdater, doneMsg);
    pushReport(this.progressUpdater, stateKey, content);
    safePushStatus(this.progressUpdater, nodeName, 'done');
    return { messages: [query[0], response], [stateKey]: content };
  }

  /** 工具角色骨架（trader 初稿/修订 + manager）：工具循环(每轮流式) → push_report。
   *  delta 逐 chunk 透传;轮末 tool_calls 非空经 onReset 回滚该轮文本(同 'retry'
   *  通道,UI 清 partial);LLM 重试同样 'retry' 复位。 */
  async completeWithTools(
    queryText: string,
    stateKey: string,
    { chain, maxToolRounds, startMsg, doneMsg, logLabel, nodeName }: CompleteOptions & {
      chain?: unknown;
      maxToolRounds?: number;
    },
  ): Promise<Record<string, unknown>> {
    safePushStatus(this.progressUpdater, nodeName, 'running');
    safeProgress(this.progressUpdater, startMsg);
    const { response, messages } = await invokeWithTools(
      (chain ?? this.llm) as never,
      queryText,
      this.config,
      {
        tools: this.tools,
        maxToolRounds,
        progressUpdater: this.progressUpdater,
        onDelta: (d) => safePushDelta(this.progressUpdater, nodeName, d),
        onRetry: (_attempt) => safePushStatus(this.progressUpdater, nodeName, 'retry'),
        onReset: () => safePushStatus(this.progressUpdater, nodeName, 'retry'),
      },
    );
    safeProgress(this.progressUpdater, doneMsg);
    const content = typeof response.content === 'string' ? response.content : String(response.content);
    pushReport(this.progressUpdater, stateKey, content);
    safePushStatus(this.progressUpdater, nodeName, 'done');
    return { messages, [stateKey]: content };
  }

  /** 信息面分析报告条件段：key 缺失 → 空串（查询与 Python 逐字节一致）。 */
  infoSection(state: StateLike): string {
    const section = state['information_analysis'];
    if (section) {
      return `\n        信息面分析报告: \n        ${section}\n        `;
    }
    return '';
  }
}

// ─── 角色类（查询构建对齐 Python agents/chinese_mainland/*.py——f-string 逐字：
//     专家嵌 stock_information；交易员嵌三份专家报告；经理嵌报告+双方观点） ─────

function target(state: StateLike): string {
  return String(state['target_stock_ticker'] ?? '');
}

/** 专家报告文本（completeExpert 写字符串 key）。 */
function expertReport(state: StateLike, key: string): string {
  return String(state[key] ?? '');
}

/** 图前 enrichment 组装的数据文本（build_stock_information 输出）。 */
function stockInfo(state: StateLike): string {
  return String(state['stock_information'] ?? '');
}

export class FundamentalAnalysisExpert extends AgentNode {
  constructor(llm: LlmLike, config: unknown, progressUpdater: ProgressUpdater | null = null) {
    super(llm, config, progressUpdater, [], fundamental_analysis_expert_message);
  }
  async fundamental_analysis_expert(state: StateLike) {
    return this.completeExpert(
      `\n        请基于以下真实数据给出你对股票代码${target(state)}的基本面分析\n        ${stockInfo(state)}\n        `,
      'fundamental_analysis', {
      startMsg: '基本面分析师开始分析...', doneMsg: '基本面分析师完成分析', logLabel: 'Fundamental Analysis Expert',
      nodeName: 'fundamental_analysis_expert',
    });
  }
}

export class TrendAnalysisExpert extends AgentNode {
  constructor(llm: LlmLike, config: unknown, progressUpdater: ProgressUpdater | null = null) {
    super(llm, config, progressUpdater, [], trend_analysis_expert_message);
  }
  async trend_analysis_expert(state: StateLike) {
    return this.completeExpert(
      `\n        请基于以下真实数据给出你对股票代码${target(state)}的趋势分析\n        ${stockInfo(state)}\n        `,
      'trend_analysis', {
      startMsg: '趋势分析师开始分析...', doneMsg: '趋势分析师完成分析', logLabel: 'Trend Analysis Expert',
      nodeName: 'trend_analysis_expert',
    });
  }
}

export class TechnicalIndicatorAnalyst extends AgentNode {
  constructor(llm: LlmLike, config: unknown, progressUpdater: ProgressUpdater | null = null) {
    super(llm, config, progressUpdater, [], technical_indicator_analyst_message);
  }
  async technical_indicator_analyst(state: StateLike) {
    return this.completeExpert(
      `\n        请基于以下真实数据给出你对股票代码${target(state)}的技术指标分析\n        ${stockInfo(state)}\n        `,
      'technical_indicator_analysis', {
      startMsg: '技术指标分析师开始分析...', doneMsg: '技术指标分析师完成分析', logLabel: 'Technical Indicator Analyst',
      nodeName: 'technical_indicator_analyst',
    });
  }
}

// ─── 亿信预抓（08-13-ts-capability-completion R2——对齐 Python
//     information_analyst.py _prefetch + core/llms/tools/billions_*.py 条目格式）──

const _SEARCH_MODE = 'fast';
const _COUNT = 10;
const _TIME_RANGE = 'past 3 months';

/** 固定检索词（确定性预抓：每源固定 1 次，成本可预期）。 */
const _QUERY_TEMPLATES: Record<string, string> = {
  announcement: '{} 公告',
  report: '{} 券商研报',
  web: '{} 最新新闻',
  twitter: '{} 最新市场讨论',
};

/** 确定性预抓的 search 源（顺序即报告分节顺序）。 */
const _SEARCH_SOURCES = ['announcement', 'report', 'web'];

/** 源中文标签（分节头）。 */
const _SOURCE_LABELS: Record<string, string> = { announcement: '公告', report: '研报', web: '新闻' };

/** 异常 → 人类可读文本（对齐 Python str(exc)）。 */
function excMsg(exc: unknown): string {
  return exc instanceof Error ? exc.message : String(exc);
}

/** result[].content[] 条目收集（非 dict 脏条目跳过——对齐 Python
 *  core/llms/tools/_items.collect_content_items；响应契约 research：
 *  result 允许缺失，status 失败已被 client 归一化）。 */
function collectContentItems(data: Record<string, unknown>): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = [];
  const result = data['result'];
  if (!Array.isArray(result)) return items;
  for (const entry of result) {
    if (typeof entry !== 'object' || entry === null) continue;
    const content = (entry as Record<string, unknown>)['content'];
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      if (typeof item === 'object' && item !== null) items.push(item as Record<string, unknown>);
    }
  }
  return items;
}

/** 单条检索结果 → Markdown 行；无有效字段（无标题且无链接）→ null（对齐
 *  Python billions_search._format_item）。字段契约：title/link/snippet(≤500)/
 *  date(YYYY-MM-DD 可空)/extra{institution(仅 report)/doc_id(仅 announcement)}；
 *  字段允许缺失，调用方容错（脏条目跳过）。 */
function formatSearchItem(item: Record<string, unknown>): string | null {
  const title = item['title'] === undefined || item['title'] === null ? '' : String(item['title']);
  const link = item['link'] === undefined || item['link'] === null ? '' : String(item['link']);
  if (!(title || link)) return null;
  const extra = typeof item['extra'] === 'object' && item['extra'] !== null
    ? (item['extra'] as Record<string, unknown>)
    : {};
  const parts: string[] = [];
  if (title && link) parts.push(`[${title}](${link})`);
  else if (link) parts.push(link);
  else parts.push(title);
  if (item['date']) parts.push(String(item['date']));
  if (extra['institution']) parts.push(String(extra['institution'])); // 研报机构名
  if (extra['doc_id']) parts.push(`doc_id: ${extra['doc_id']}`); // 公告全文 id
  let line = parts.join(' — ');
  if (item['snippet']) line += `(${item['snippet']})`;
  return `- ${line}`;
}

/** 单条推文 → Markdown 行；无正文 → null（对齐 Python billions_twitter.
 *  _format_tweet）。字段契约：title("@user: 前缀")/link(x.com/...)/snippet
 *  (正文)/date(北京时间)/extra{username/view_count/post_id/...}。 */
function formatTweetItem(item: Record<string, unknown>): string | null {
  const snippet = item['snippet'] === undefined || item['snippet'] === null ? '' : String(item['snippet']);
  if (!snippet) return null;
  const extra = typeof item['extra'] === 'object' && item['extra'] !== null
    ? (item['extra'] as Record<string, unknown>)
    : {};
  let username = extra['username'] ? String(extra['username']) : '';
  if (!username) {
    // title 形如 "@user: 正文预览"——取 @ 前缀兜底
    const title = item['title'] === undefined || item['title'] === null ? '' : String(item['title']);
    if (title.startsWith('@')) username = title.split(':', 1)[0];
  }
  if (username && !username.startsWith('@')) username = `@${username}`;
  const parts: string[] = [];
  if (username) parts.push(username);
  if (extra['view_count'] !== undefined && extra['view_count'] !== null) parts.push(`${extra['view_count']} 次浏览`);
  if (item['date']) parts.push(String(item['date']));
  let line = parts.join(' — ') + ` — ${snippet}`;
  if (item['link']) line += ` [${item['link']}]`;
  return `- ${line}`;
}

export class BillionsInformationAnalyst extends AgentNode {
  constructor(
    llm: LlmLike,
    config: unknown,
    progressUpdater: ProgressUpdater | null = null,
    private _searcher: (query: string) => Promise<SearchResult[]> = defaultSearcher(),
    private _billionsClient?: BillionsClient,
  ) {
    super(llm, config, progressUpdater, [], information_analyst_message);
  }

  private _client: BillionsClient | undefined;

  /** 惰性加载：注入优先；缺省首次预抓时构造（构造零副作用、不触网）。 */
  private _getClient(): BillionsClient {
    if (this._client === undefined) {
      this._client = this._billionsClient ?? new BillionsClient();
    }
    return this._client;
  }

  /** 单次 search 预抓 → 带来源标签的分节；失败/无有效条目 → 注明（不 raise）。 */
  private async _searchSection(client: BillionsClient, ticker: string, source: string): Promise<string> {
    try {
      const data = await client.search(
        _QUERY_TEMPLATES[source].replace('{}', ticker),
        { source, searchMode: _SEARCH_MODE, count: _COUNT, timeRange: _TIME_RANGE },
      );
      const lines: string[] = [];
      for (const item of collectContentItems(data)) {
        const line = formatSearchItem(item);
        if (line !== null) lines.push(line);
      }
      if (!lines.length) {
        warn(`亿信 ${source} 检索成功但无有效结果: ${ticker}`);
        return `【${_SOURCE_LABELS[source]}无返回结果】`;
      }
      return `【${_SOURCE_LABELS[source]}检索结果】\n${lines.join('\n')}`;
    } catch (exc) {
      warn(`亿信 ${source} 检索失败（${ticker}）: ${excMsg(exc)}`);
      return `【${_SOURCE_LABELS[source]}检索失败】${excMsg(exc)}`;
    }
  }

  /** 单次 twitter 预抓 → 带来源标签的分节；失败/无有效条目 → 注明（不 raise）。 */
  private async _twitterSection(client: BillionsClient, ticker: string): Promise<string> {
    try {
      const data = await client.twitterSearch(
        _QUERY_TEMPLATES['twitter'].replace('{}', ticker),
        { searchMode: _SEARCH_MODE, count: _COUNT },
      );
      const lines: string[] = [];
      for (const item of collectContentItems(data)) {
        const line = formatTweetItem(item);
        if (line !== null) lines.push(line);
      }
      if (!lines.length) {
        warn(`亿信 twitter 检索成功但无有效结果: ${ticker}`);
        return '【推特无返回结果】';
      }
      return `【推特检索结果】\n${lines.join('\n')}`;
    } catch (exc) {
      warn(`亿信 twitter 检索失败（${ticker}）: ${excMsg(exc)}`);
      return `【推特检索失败】${excMsg(exc)}`;
    }
  }

  /** 联网搜索回退（08-10-web-search-fallback，R2）：固定 1 次 DDG 查询
   *  （_QUERY_TEMPLATES["web"]）→ 中文摘要节。失败/空 → 占位文本
   *  （不 raise，降级语义收敛在 summarizeResults/defaultSearcher 单点）。 */
  private async _webSearchSection(ticker: string): Promise<string> {
    try {
      return summarizeResults(await this._searcher(_QUERY_TEMPLATES['web'].replace('{}', ticker)));
    } catch (exc) {
      warn(`联网搜索失败（${ticker}）: ${excMsg(exc)}`);
      return `（联网搜索失败：${excMsg(exc)}）`;
    }
  }

  /** 确定性预抓（固定次数，成本可预期）：按开关过滤源，失败源跳过。
   *
   * 真实素材判定：「检索结果】」分节标记（亿信「…检索结果」/ 联网
   * 「【联网搜索结果】」；「检索失败」「无返回结果」注明不算）。
   * - 亿信路径无真实素材且联网搜索开（R2）→ 追加 web 回退节（固定 1 次）；
   *   回退也失败/空（双失败）→ 返回空列表（调用方落固定回退文本）。
   * - 全部源关闭（SEARCH/TWITTER 均关）且 web 关 → 返回空列表且不构造
   *   client（图中不存在的组合由 committee 接线保证；此处为健壮性兜底）。
   * - 无 API key（对齐 Python 主闸）→ 亿信路径静默关闭、不发起请求。
   * - web 关时亿信失败/空注明照旧保留（现状语义，逐字节不变）。
   */
  private async _prefetch(ticker: string): Promise<string[]> {
    // 静态导入(与 committee.ts 构成 agents↔committee 循环——Metro CJS 语义下
    // exports 对象引用共享,运行时访问 live binding,无求值期 TDZ;原动态导入
    // 在 Expo dev lazy 打包下运行时解析相对 bundle root 失败,2026-08-15 改回)。
    const searchOn = billionsEnabled('SEARCH');
    const twitterOn = billionsEnabled('TWITTER');
    const webOn = webSearchEnabled();
    const sections: string[] = [];
    if (searchOn || twitterOn) {
      const client = this._getClient();
      const keyOn = client.hasApiKey; // 主闸：无 key 亿信路径静默关闭
      if (searchOn && keyOn) {
        for (const source of _SEARCH_SOURCES) {
          sections.push(await this._searchSection(client, ticker, source));
        }
      }
      if (twitterOn && keyOn) {
        sections.push(await this._twitterSection(client, ticker));
      }
    }
    let foundContent = sections.some((s) => s.includes('检索结果】'));
    if (!foundContent && webOn) {
      const webSection = await this._webSearchSection(ticker);
      sections.push(webSection);
      foundContent = webSection.startsWith('【联网搜索结果】');
    }
    if (!foundContent && webOn) {
      // 双失败（亿信无素材 + 联网回退也失败/空）→ 返回空列表，调用方落
      // 固定回退文本「所有来源均不可用或未启用」（R2，逐字不变）
      return [];
    }
    return sections;
  }

  async information_analyst(state: StateLike) {
    const ticker = target(state);
    // 对齐 Python information_analyst.py：确定性预抓（亿信三源 + twitter，
    // 开关门控；失败源注明不 raise）→ 素材上下文；亿信无真实素材且 web 开
    // → 追加联网回退节（08-10-web-search-fallback，R4）；双失败 → 固定回退
    // 文本（逐字不变，不 raise——error-handling spec 降级风格）。
    safeProgress(this.progressUpdater, '开始信息面素材检索。。。');
    const sections = await this._prefetch(ticker);
    const context = sections.length
      ? sections.join('\n\n')
      : '（本次运行未检索到任何信息面素材：所有来源均不可用或未启用）';
    return this.completeExpert(
      `\n        请基于以下已检索到的信息面素材，给出你对股票代码${ticker}的信息面分析报告\n        股票信息: \n        ${stockInfo(state)}\n        \n        检索到的信息面素材: \n        ${context}\n        `,
      'information_analysis', {
      startMsg: '信息面分析师开始分析...', doneMsg: '信息面分析师完成分析', logLabel: 'Information Analyst',
      nodeName: 'information_analyst',
    });
  }
}

export class BullishTrader extends AgentNode {
  constructor(llm: LlmLike, config: unknown, progressUpdater: ProgressUpdater | null = null, tools: ToolLike[] = []) {
    super(llm, config, progressUpdater, tools, bullish_trader_message);
    this.reviseLlm = this.buildChain(bullish_revise_message);
  }
  private reviseLlm: unknown;
  async bullish_trader(state: StateLike) {
    const info = this.infoSection(state);
    const q = `\n        现在请基于以下信息，给出你对股票代码${target(state)}的看法：\n        基本面报告: \n        ${expertReport(state, 'fundamental_analysis')}\n        \n        趋势报告: \n        ${expertReport(state, 'trend_analysis')}\n        \n        技术指标分析报告: \n        ${expertReport(state, 'technical_indicator_analysis')}\n        \n        ${info}`;
    return this.completeWithTools(q, 'bullish_opinions', {
      startMsg: '多头交易员开始分析...', doneMsg: '多头交易员完成分析', logLabel: 'Bullish Trader',
      nodeName: 'bullish_trader',
    });
  }
  async bullish_revise(state: StateLike) {
    const own = String((state['bullish_opinions'] as Array<{ content: string }>)?.at(-1)?.content ?? '');
    const opp = String((state['bearish_opinions'] as Array<{ content: string }>)?.at(-1)?.content ?? '');
    return this.completeWithTools(
      `\n        现在请检视空方交易员对你多头初稿的质疑，给出股票代码${target(state)}的修订版完整多头观点：\n        空方交易员观点: \n        ${opp}\n        \n        你的初稿多头观点: \n        ${own}\n        \n`,
      'bullish_opinions',
      { chain: this.reviseLlm, maxToolRounds: 3, startMsg: '多方修订开始...', doneMsg: '多方修订完成', logLabel: 'Bullish Revise',
        nodeName: 'bullish_revise' },
    );
  }
}

export class BearishTrader extends AgentNode {
  constructor(llm: LlmLike, config: unknown, progressUpdater: ProgressUpdater | null = null, tools: ToolLike[] = []) {
    super(llm, config, progressUpdater, tools, bearish_trader_message);
    this.reviseLlm = this.buildChain(bearish_revise_message);
  }
  private reviseLlm: unknown;
  async bearish_trader(state: StateLike) {
    const info = this.infoSection(state);
    const q = `\n        现在请基于以下信息，给出你对股票代码${target(state)}的看法：\n        基本面报告: \n        ${expertReport(state, 'fundamental_analysis')}\n        \n        趋势报告: \n        ${expertReport(state, 'trend_analysis')}\n        \n        技术指标分析报告: \n        ${expertReport(state, 'technical_indicator_analysis')}\n        \n        ${info}`;
    return this.completeWithTools(q, 'bearish_opinions', {
      startMsg: '空头交易员开始分析...', doneMsg: '空头交易员完成分析', logLabel: 'Bearish Trader',
      nodeName: 'bearish_trader',
    });
  }
  async bearish_revise(state: StateLike) {
    const own = String((state['bearish_opinions'] as Array<{ content: string }>)?.at(-1)?.content ?? '');
    const opp = String((state['bullish_opinions'] as Array<{ content: string }>)?.at(-1)?.content ?? '');
    return this.completeWithTools(
      `\n        现在请检视多方交易员对你空头初稿的质疑，给出股票代码${target(state)}的修订版完整空头观点：\n        多方交易员观点: \n        ${opp}\n        \n        你的初稿空头观点: \n        ${own}\n        \n`,
      'bearish_opinions',
      { chain: this.reviseLlm, maxToolRounds: 3, startMsg: '空方修订开始...', doneMsg: '空方修订完成', logLabel: 'Bearish Revise',
        nodeName: 'bearish_revise' },
    );
  }
}

export class InvestmentManager extends AgentNode {
  constructor(llm: LlmLike, config: unknown, progressUpdater: ProgressUpdater | null = null, tools: ToolLike[] = []) {
    super(llm, config, progressUpdater, tools, investment_manager_message);
  }
  async investment_manager(state: StateLike) {
    const opinions = state['bullish_opinions'] as Array<{ content: string }> | undefined;
    const bullish = String(opinions?.at(-1)?.content ?? '');
    const bearish = String((state['bearish_opinions'] as Array<{ content: string }> | undefined)?.at(-1)?.content ?? '');
    const info = this.infoSection(state);
    return this.completeWithTools(
      `\n        现在请基于以下信息，给出你对股票代码${target(state)}的最终投资建议：\n        基本面报告: \n        ${expertReport(state, 'fundamental_analysis')}\n        \n        趋势报告: \n        ${expertReport(state, 'trend_analysis')}\n        \n        技术指标分析报告: \n        ${expertReport(state, 'technical_indicator_analysis')}\n        \n${info}\n        多头观点: \n        ${bullish}\n        \n        空头观点: \n        ${bearish}\n        \n`,
      'final_decision',
      { startMsg: '投资经理开始终审...', doneMsg: '投资经理完成终审', logLabel: 'Investment Manager',
        nodeName: 'investment_manager' },
    );
  }
}
