// 投资委员会 —— 移植自 Python core/investment_committee.py + role_registry.py
// 4 阶段形状：START → 专家∥ → 多空初稿（N 入边 join）→ 对抗修订（双入边
// join，追加写 opinions key）→ 经理（[-1] 读修订版）→ END
// 信息面分析师为条件节点：启用谓词关 → 完全不注册
import { addMessages, Annotation, END, MemorySaver, START, StateGraph } from '@langchain/langgraph';
import { HumanMessage } from '@langchain/core/messages';
import { webSearchEnabled, makeWebSearchTool } from './webSearch';
import type { ToolLike } from './toolLoop';
import type { LlmLike } from './agents';
import type { ProgressUpdater } from './progress';
import {
  BearishTrader, BillionsInformationAnalyst, BullishTrader,
  FundamentalAnalysisExpert, InvestmentManager, TechnicalIndicatorAnalyst, TrendAnalysisExpert,
} from './agents';

// ─── 角色注册表（对齐 Python Role dataclass） ─────────────────────────────

export type RoleKind = 'expert' | 'trader' | 'manager';

export interface Role {
  nodeName: string;
  kind: RoleKind;
  stateKey?: string;
  tabTitle?: string;
  opinion?: boolean;
  enabled: () => boolean;
  factory: (llm: LlmLike, config: unknown, progressUpdater: ProgressUpdater | null, tools: ToolLike[]) => unknown;
  reviseNodeName?: string;
}

export function envDisabledBool(name: string): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return false;
  return !['0', 'false', 'no'].includes(v.toLowerCase());
}

export function billionsEnabled(cap: string): boolean {
  if (envDisabledBool('BILLIONS_DISABLED')) return false;
  return !envDisabledBool(`BILLIONS_${cap}_DISABLED`);
}

export function informationAnalystEnabled(): boolean {
  return billionsEnabled('ANALYST') && (billionsEnabled('SEARCH') || billionsEnabled('TWITTER'));
}

type AgentFactory = (llm: LlmLike, config: unknown, progress: ProgressUpdater | null, tools: ToolLike[]) => unknown;

const expert = (cls: new (llm: LlmLike, config: unknown, progress: ProgressUpdater | null) => unknown): AgentFactory =>
  (llm, config, progress, _tools) => new cls(llm, config, progress);

const trader = (cls: new (llm: LlmLike, config: unknown, progress: ProgressUpdater | null, tools: ToolLike[]) => unknown): AgentFactory =>
  (llm, config, progress, tools) => new cls(llm, config, progress, tools);

export const ROLES: Role[] = [
  { nodeName: 'fundamental_analysis_expert', kind: 'expert', stateKey: 'fundamental_analysis', tabTitle: '基本面分析', enabled: () => true, factory: expert(FundamentalAnalysisExpert) },
  { nodeName: 'trend_analysis_expert', kind: 'expert', stateKey: 'trend_analysis', tabTitle: '趋势分析', enabled: () => true, factory: expert(TrendAnalysisExpert) },
  { nodeName: 'technical_indicator_analyst', kind: 'expert', stateKey: 'technical_indicator_analysis', tabTitle: '技术指标分析', enabled: () => true, factory: expert(TechnicalIndicatorAnalyst) },
  { nodeName: 'information_analyst', kind: 'expert', stateKey: 'information_analysis', tabTitle: '信息面分析', enabled: informationAnalystEnabled, factory: expert(BillionsInformationAnalyst) },
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
) {
  if (!_llm) throw new Error('M2: _llm required (makeLlm 接入见 M3)');
  const llm = _llm;
  const tools: ToolLike[] = webSearchEnabled() ? [makeWebSearchTool()] : [];
  const roles = enabledRoles();
  const graph = new StateGraph(StateAnnotation);
  for (const role of roles) {
    const agent = role.factory(llm, config, progressUpdater, tools) as Record<string, (state: unknown) => Promise<Record<string, unknown>>>;
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
