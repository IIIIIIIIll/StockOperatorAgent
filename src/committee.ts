// 投资委员会 —— 移植自 Python core/investment_committee.py + role_registry.py
// 4 阶段形状：START → 专家∥ → 多空初稿（N 入边 join）→ 对抗修订（双入边
// join，追加写 opinions key）→ 经理（[-1] 读修订版）→ END
// 信息面分析师为条件节点：启用谓词关 → 完全不注册
import { addMessages, Annotation, END, MemorySaver, START, StateGraph } from '@langchain/langgraph';
import { HumanMessage } from '@langchain/core/messages';
import { webSearchEnabled, makeWebSearchTool } from './webSearch.ts';
import type { ToolLike } from './toolLoop.ts';
import type { LlmLike } from './agents.ts';
import type { ProgressUpdater } from './progress.ts';
import {
  BearishTrader, BillionsInformationAnalyst, BullishTrader,
  FundamentalAnalysisExpert, InvestmentManager, TechnicalIndicatorAnalyst, TrendAnalysisExpert,
} from './agents.ts';
import type { BillionsClient } from './billionsClient.ts';
import { envValue } from './env.ts';
import { getCapabilitySwitches, type CapabilitySwitches } from './switches.ts';

// ─── 角色注册表（对齐 Python Role dataclass） ─────────────────────────────

export type RoleKind = 'expert' | 'trader' | 'manager';

export interface CommitteeDeps {
  /** 亿信客户端注入（web 端 localStorage key → 信息面分析师预抓三源+twitter）。
   *  缺省 → 现状：分析师内部回退 new BillionsClient()（无 key，亿信路径静默
   *  关闭，DDG 兜底）。安全：key 仅存于 client 私有字段——不落日志、不经
   *  服务端代理，浏览器端直连（billionsClient.ts 契约）。 */
  billionsClient?: BillionsClient;
}

export interface Role {
  nodeName: string;
  kind: RoleKind;
  stateKey?: string;
  tabTitle?: string;
  opinion?: boolean;
  enabled: () => boolean;
  factory: AgentFactory;
  reviseNodeName?: string;
}

/** env-only 兜底判定(存在且非 ""/"0"/"false"/"no" → 禁用):Node 直配 env
 *  场景(无 app 层注入)仍工作;消费面已改走 config(getCapabilitySwitches)。 */
export function envDisabledBool(name: string): boolean {
  const v = envValue(name);
  if (v === undefined || v === '') return false;
  return !['0', 'false', 'no'].includes(v.toLowerCase());
}

/** 亿信能力开关 → config(语义 enabled):主闸(billions) 且 能力闸(cap 小写
 *  字段);未注入时 fromEnv 从 BILLIONS_{CAP}_DISABLED 反推。cap: FINDB/
 *  SEARCH/TWITTER/FETCH/ANALYST。无 key 约束(现状)——key 判定在
 *  billionsTools.billionsCapEnabled 单点承担。 */
const BILLIONS_CAP_FIELD: Record<string, keyof CapabilitySwitches> = {
  FINDB: 'findb',
  SEARCH: 'search',
  TWITTER: 'twitter',
  FETCH: 'fetch',
  ANALYST: 'analyst',
};

export function billionsEnabled(cap: string): boolean {
  const s = getCapabilitySwitches();
  const field = BILLIONS_CAP_FIELD[cap];
  return s.billions && (field ? s[field] : false);
}

/** 契约公式（implement.md Step 8）：亿信路径（ANALYST 且 SEARCH/TWITTER 至少一者）
 * 或联网路径（webSearchEnabled）——三谓词均读 config(面板/注入;Node 直配 env
 * 由 fromEnv 反推),web 开时经 /web-search/DDG 兜底预抓。 */
export function informationAnalystEnabled(): boolean {
  return billionsEnabled('ANALYST') && (billionsEnabled('SEARCH') || billionsEnabled('TWITTER') || webSearchEnabled());
}

type AgentFactory = (
  llm: LlmLike, config: unknown, progress: ProgressUpdater | null, tools: ToolLike[], deps?: CommitteeDeps,
) => unknown;

const expert = (cls: new (llm: LlmLike, config: unknown, progress: ProgressUpdater | null) => unknown): AgentFactory =>
  (llm, config, progress, _tools, _deps) => new cls(llm, config, progress);

const trader = (cls: new (llm: LlmLike, config: unknown, progress: ProgressUpdater | null, tools: ToolLike[]) => unknown): AgentFactory =>
  (llm, config, progress, tools, _deps) => new cls(llm, config, progress, tools);

/** 信息面分析师工厂：透传亿信 client 注入（web 端 localStorage key → 预抓
 *  三源+twitter 生效）。单独工厂而非 expert()：构造器第 5 参 _billionsClient
 *  仅此类支持；无 deps → 与 expert() 路径一致（无 key client 回退，DDG 兜底）。 */
const informationAnalyst: AgentFactory = (llm, config, progress, _tools, deps) =>
  new BillionsInformationAnalyst(llm, config, progress, undefined, deps?.billionsClient);

export const ROLES: Role[] = [
  { nodeName: 'fundamental_analysis_expert', kind: 'expert', stateKey: 'fundamental_analysis', tabTitle: '基本面分析', enabled: () => true, factory: expert(FundamentalAnalysisExpert) },
  { nodeName: 'trend_analysis_expert', kind: 'expert', stateKey: 'trend_analysis', tabTitle: '趋势分析', enabled: () => true, factory: expert(TrendAnalysisExpert) },
  { nodeName: 'technical_indicator_analyst', kind: 'expert', stateKey: 'technical_indicator_analysis', tabTitle: '技术指标分析', enabled: () => true, factory: expert(TechnicalIndicatorAnalyst) },
  { nodeName: 'information_analyst', kind: 'expert', stateKey: 'information_analysis', tabTitle: '信息面分析', enabled: informationAnalystEnabled, factory: informationAnalyst },
  { nodeName: 'bullish_trader', kind: 'trader', stateKey: 'bullish_opinions', tabTitle: '看涨观点', opinion: true, enabled: () => true, factory: trader(BullishTrader), reviseNodeName: 'bullish_revise' },
  { nodeName: 'bearish_trader', kind: 'trader', stateKey: 'bearish_opinions', tabTitle: '看跌观点', opinion: true, enabled: () => true, factory: trader(BearishTrader), reviseNodeName: 'bearish_revise' },
  { nodeName: 'investment_manager', kind: 'manager', stateKey: 'final_decision', tabTitle: '最终结论', enabled: () => true, factory: trader(InvestmentManager) },
];

export function enabledRoles(): Role[] {
  return ROLES.filter((r) => r.enabled());
}

export function reportRoles(roles?: Role[]): Role[] {
  const selected = roles ?? enabledRoles();
  return selected.filter((r) => r.stateKey !== undefined && r.tabTitle !== undefined);
}

export function buildNodeNames(roles: Role[]): string[] {
  const names = roles.filter((r) => r.kind === 'expert' || r.kind === 'trader').map((r) => r.nodeName);
  names.push(...roles.filter((r) => r.kind === 'trader' && r.reviseNodeName).map((r) => r.reviseNodeName!));
  names.push(roles.find((r) => r.kind === 'manager')!.nodeName);
  return names;
}

export function buildEdges(roles: Role[]): Array<[string, string]> {
  const experts = roles.filter((r) => r.kind === 'expert');
  const traders = roles.filter((r) => r.kind === 'trader');
  const manager = roles.find((r) => r.kind === 'manager')!;
  const edges: Array<[string, string]> = experts.map((r) => ['START', r.nodeName]);
  for (const trader of traders) {
    for (const expert of experts) edges.push([expert.nodeName, trader.nodeName]);
  }
  for (const trader of traders) {
    for (const t of traders) edges.push([t.nodeName, trader.reviseNodeName!]);
  }
  for (const trader of traders) edges.push([trader.reviseNodeName!, manager.nodeName]);
  edges.push([manager.nodeName, 'END']);
  return edges;
}

// ─── State 注解（对齐 Python utils/state.py） ─────────────────────────────

export const StateAnnotation = Annotation.Root({
  messages: Annotation({ reducer: addMessages, default: () => [] }),
  target_stock_ticker: Annotation<string>(),
  stock_information: Annotation<string>(),
  fundamental_analysis: Annotation<string>(),
  trend_analysis: Annotation<string>(),
  technical_indicator_analysis: Annotation<string>(),
  information_analysis: Annotation<string>(),
  bullish_opinions: Annotation({ reducer: addMessages, default: () => [] }),
  bearish_opinions: Annotation({ reducer: addMessages, default: () => [] }),
  final_decision: Annotation<string>(),
});

export type CommitteeState = typeof StateAnnotation.State;

// ─── 图装配 ───────────────────────────────────────────────────────────────

export function makeInvestmentCommittee(
  config: unknown,
  progressUpdater: ProgressUpdater | null = null,
  _llm: LlmLike | null = null,
  _tools?: ToolLike[] | null,
  deps?: CommitteeDeps,
) {
  if (!_llm) throw new Error('M2: _llm required (makeLlm 接入见 M3)');
  const llm = _llm;
  // 工具注入（08-13-ts-capability-completion）：_tools 提供则使用调用方组装
  // 的工具列表（web 端亿信 key 在 localStorage，App 层组装 web_search +
  // 亿信三件套后注入）；缺省走 webSearch 开关（现状行为逐字节不变）。
  // deps 注入（phaseout C1）：deps.billionsClient 带 web 端 localStorage key
  // → 信息面分析师预抓三源+twitter 生效；缺省 → 现状（无 key 回退）。
  const tools: ToolLike[] = _tools ?? (webSearchEnabled() ? [makeWebSearchTool()] : []);
  const roles = enabledRoles();
  const graph = new StateGraph(StateAnnotation);
  for (const role of roles) {
    const agent = role.factory(llm, config, progressUpdater, tools, deps) as Record<string, (state: unknown) => Promise<Record<string, unknown>>>;
    graph.addNode(role.nodeName, (state: CommitteeState) => agent[role.nodeName](state));
    if (role.reviseNodeName) {
      graph.addNode(role.reviseNodeName, (state: CommitteeState) => agent[role.reviseNodeName!](state));
    }
  }
  for (const [from, to] of buildEdges(roles)) {
    graph.addEdge(from === 'START' ? START : (from as never), to === 'END' ? END : (to as never));
  }
  // 对齐 Python：InMemorySaver checkpointer（thread_id 由调用方 config 携带）
  return graph.compile({ checkpointer: new MemorySaver() });
}

export async function* makeInvestmentDecision(
  targetTicker: string,
  stockInformation: string,
  config?: unknown,
  _llm?: LlmLike | null,
): AsyncGenerator {
  const threadConfig = config ?? { configurable: { thread_id: '1' } };
  const graph = makeInvestmentCommittee(threadConfig, null, _llm);
  const initial = {
    messages: [new HumanMessage(`请帮我分析一下 ${targetTicker}`)],
    target_stock_ticker: targetTicker,
    stock_information: stockInformation,
  };
  yield* (await graph.stream(initial, threadConfig));
}
