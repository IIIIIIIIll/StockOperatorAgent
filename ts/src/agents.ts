// AgentNode —— 移植自 Python agents/base.py（08-09-agent-base-class）
// 不变管道：prompt 壳 + bind_tools 回退 + revise 第二条链 + 节点骨架
// 查询构建为差异化部分——M2 简版（含 info_section 条件段结构），
// M3 逐字对齐 Python agents/（test_query_baselines 契约）
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import type { RunnableLike } from '@langchain/core/runnables';
import { system_prompt, fundamental_analysis_expert_message, trend_analysis_expert_message, technical_indicator_analyst_message, information_analyst_message, bullish_trader_message, bearish_trader_message, bullish_revise_message, bearish_revise_message, investment_manager_message } from './prompt.ts';
import { getLastBusinessDay } from './gates.ts';
import { invokeWithRetry } from './retry.ts';
import { invokeWithTools, type ToolLike } from './toolLoop.ts';
import { pushReport, safeProgress, type ProgressUpdater } from './progress.ts';
import { defaultSearcher, summarizeResults, webSearchEnabled, type SearchResult } from './webSearch.ts';

export interface LlmLike {
  invoke(payload: unknown, config?: unknown): Promise<{ content: string }>;
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

  /** 专家骨架：进度 → 直调 invokeWithRetry → push_report → state dict。 */
  async completeExpert(
    queryText: string,
    stateKey: string,
    { startMsg, doneMsg, logLabel }: CompleteOptions,
  ): Promise<Record<string, unknown>> {
    const query: Array<[string, string]> = [['human', queryText]];
    safeProgress(this.progressUpdater, startMsg);
    const response = (await invokeWithRetry(this.llm as LlmLike, { query }, this.config)) as {
      content: unknown;
    };
    const content = typeof response.content === 'string' ? response.content : String(response.content);
    safeProgress(this.progressUpdater, doneMsg);
    pushReport(this.progressUpdater, stateKey, content);
    return { messages: [query[0], response], [stateKey]: content };
  }

  /** 工具角色骨架（trader 初稿/修订 + manager）：工具循环 → push_report。 */
  async completeWithTools(
    queryText: string,
    stateKey: string,
    { chain, maxToolRounds, startMsg, doneMsg, logLabel }: CompleteOptions & {
      chain?: unknown;
      maxToolRounds?: number;
    },
  ): Promise<Record<string, unknown>> {
    safeProgress(this.progressUpdater, startMsg);
    const { response, messages } = await invokeWithTools(
      (chain ?? this.llm) as never,
      queryText,
      this.config,
      { tools: this.tools, maxToolRounds, progressUpdater: this.progressUpdater },
    );
    safeProgress(this.progressUpdater, doneMsg);
    const content = typeof response.content === 'string' ? response.content : String(response.content);
    pushReport(this.progressUpdater, stateKey, content);
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
    });
  }
}

export class BillionsInformationAnalyst extends AgentNode {
  constructor(
    llm: LlmLike,
    config: unknown,
    progressUpdater: ProgressUpdater | null = null,
    private _searcher: (query: string) => Promise<SearchResult[]> = defaultSearcher(),
  ) {
    super(llm, config, progressUpdater, [], information_analyst_message);
  }
  async information_analyst(state: StateLike) {
    // 对齐 Python information_analyst.py：嵌股票信息 + 素材上下文；
    // 联网搜索回退（08-10-web-search-fallback，R4）：web 开 → 固定 1 次
    // `{ticker} 最新新闻` 查询（缺省 defaultSearcher：浏览器走 /web-search
    // 代理、Node/真机直连 DDG）；失败/空 → 固定回退文本（与今日逐字一致，
    // 不 raise——error-handling spec 降级风格）。web 关 → 不触网直接回退。
    let context = '（本次运行未检索到任何信息面素材：所有来源均不可用或未启用）';
    if (webSearchEnabled()) {
      try {
        const summary = summarizeResults(await this._searcher(`${target(state)} 最新新闻`));
        if (summary.startsWith('【联网搜索结果】')) context = summary;
      } catch {
        // 降级：保持固定回退文本
      }
    }
    return this.completeExpert(
      `\n        请基于以下已检索到的信息面素材，给出你对股票代码${target(state)}的信息面分析报告\n        股票信息: \n        ${stockInfo(state)}\n        \n        检索到的信息面素材: \n        ${context}\n        `,
      'information_analysis', {
      startMsg: '信息面分析师开始分析...', doneMsg: '信息面分析师完成分析', logLabel: 'Information Analyst',
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
    });
  }
  async bullish_revise(state: StateLike) {
    const own = String((state['bullish_opinions'] as Array<{ content: string }>)?.at(-1)?.content ?? '');
    const opp = String((state['bearish_opinions'] as Array<{ content: string }>)?.at(-1)?.content ?? '');
    return this.completeWithTools(
      `\n        现在请检视空方交易员对你多头初稿的质疑，给出股票代码${target(state)}的修订版完整多头观点：\n        空方交易员观点: \n        ${opp}\n        \n        你的初稿多头观点: \n        ${own}\n        \n`,
      'bullish_opinions',
      { chain: this.reviseLlm, maxToolRounds: 3, startMsg: '多方修订开始...', doneMsg: '多方修订完成', logLabel: 'Bullish Revise' },
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
    });
  }
  async bearish_revise(state: StateLike) {
    const own = String((state['bearish_opinions'] as Array<{ content: string }>)?.at(-1)?.content ?? '');
    const opp = String((state['bullish_opinions'] as Array<{ content: string }>)?.at(-1)?.content ?? '');
    return this.completeWithTools(
      `\n        现在请检视多方交易员对你空头初稿的质疑，给出股票代码${target(state)}的修订版完整空头观点：\n        多方交易员观点: \n        ${opp}\n        \n        你的初稿空头观点: \n        ${own}\n        \n`,
      'bearish_opinions',
      { chain: this.reviseLlm, maxToolRounds: 3, startMsg: '空方修订开始...', doneMsg: '空方修订完成', logLabel: 'Bearish Revise' },
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
      { startMsg: '投资经理开始终审...', doneMsg: '投资经理完成终审', logLabel: 'Investment Manager' },
    );
  }
}
