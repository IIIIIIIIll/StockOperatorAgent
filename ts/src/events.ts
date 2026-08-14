// 事件流 runner —— ProgressUpdater 协议 → 订阅事件(Node 与 App 共用)
// run(ticker):采集(可注入 client)→ buildStockInformation → 委员会 →
// 最终报告;progress/report/done/error 事件按序发射。
// 08-11-ts-streaming-output:新增 token(流式文本增量)/roleStatus(角色生命周期)
// —— node 为图节点名(区分初稿/修订轮),roleKey 为 stateKey(经 ROLES 查表映射)。
import { HumanMessage } from '@langchain/core/messages';
import type { StoreLike } from './store.ts';
import { buildStockInformation } from './pipeline.ts';
import { enabledRoles, makeInvestmentCommittee } from './committee.ts';
import { makeLlm } from './llm.ts';
import type { BillionsClient } from './billionsClient.ts';
import type { ProgressUpdater, RoleStatus } from './progress.ts';
import type { PipelineDeps } from './pipeline.ts';
import type { ToolLike } from './toolLoop.ts';

export type PipelineEvent =
  | { type: 'progress'; message: string }
  | { type: 'report'; key: string; tabTitle: string; content: string }
  | { type: 'token'; roleKey: string; node: string; delta: string }
  | { type: 'roleStatus'; roleKey: string; node: string; status: RoleStatus }
  | { type: 'done'; report: FinalReport }
  | { type: 'error'; error: string };

export interface Opinion {
  key: string;
  tabTitle: string;
  content: string;
}

export interface FinalReport {
  ticker: string;
  stock_information: string; // build_stock_information 输出（采集数据 Tab）
  final_decision: string;
  opinions: Opinion[]; // 各角色报告（含多空初稿+修订版）
}

export interface RunOptions extends Omit<PipelineDeps, 'store' | 'progress'> {
  llm?: unknown; // 注入;缺省 makeLlm()
  config?: unknown;
  /** 工具注入（亿信三件套 + web_search；App 层组装，web 端 key 在 localStorage）。 */
  tools?: ToolLike[];
  /** 亿信客户端注入（web 端 localStorage key → 信息面分析师预抓三源+twitter；
   *  缺省 → 现状：分析师内部回退无 key client，亿信路径静默关闭、DDG 兜底）。 */
  billionsClient?: BillionsClient;
}

export interface PipelineRunner {
  subscribe(listener: (e: PipelineEvent) => void): () => void;
  run(ticker: string, opts?: RunOptions): Promise<FinalReport>;
}

/** LangGraph 聚合异常(如 superstep 并行节点全失败)含 errors[]——提取具体原因。 */
export function describeError(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const e = err as { message?: unknown; errors?: unknown };
    if (Array.isArray(e.errors) && e.errors.length) {
      const parts = e.errors.map((x) => {
        const m = (x as { message?: unknown })?.message;
        if (typeof m === 'string') return m;
        const s = JSON.stringify(x);
        return s ? s.slice(0, 200) : String(x);
      });
      return parts.join('; ');
    }
    if (typeof e.message === 'string') return e.message;
  }
  return String(err);
}

/** 创建 pipeline runner（Node 探针与 App 共用）。 */
export function createPipelineRunner(store: StoreLike): PipelineRunner {
  const listeners = new Set<(e: PipelineEvent) => void>();

  function emit(e: PipelineEvent): void {
    for (const fn of listeners) {
      try {
        fn(e);
      } catch {
        /* 单个订阅者异常不阻断 */
      }
    }
  }

  // node → roleKey 映射契约:初稿节点查 nodeName,修订节点查 reviseNodeName
  // (同 stateKey);查不到 → 原样用 node(events 仍可消费)。
  const updater: ProgressUpdater = {
    info: (message) => emit({ type: 'progress', message }),
    pushReport: (key, content) => {
      const role = enabledRoles().find((r) => r.stateKey === key);
      emit({ type: 'report', key, tabTitle: role?.tabTitle ?? key, content });
    },
    pushDelta: (node, delta) => {
      const role = enabledRoles().find((r) => r.nodeName === node || r.reviseNodeName === node);
      emit({ type: 'token', roleKey: role?.stateKey ?? node, node, delta });
    },
    pushStatus: (node, status) => {
      const role = enabledRoles().find((r) => r.nodeName === node || r.reviseNodeName === node);
      emit({ type: 'roleStatus', roleKey: role?.stateKey ?? node, node, status });
    },
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async run(ticker, opts = {}) {
      try {
        emit({ type: 'progress', message: `开始分析 ${ticker}...` });

        // 1. 组装 stock_information(图前 enrichment 唯一组装点;数据已由
        //    Node 侧采集写入 store —— 见 tools/probe.mts;App 端注入/预载)
        const info = buildStockInformation(ticker, {
          ...opts,
          store,
          progress: updater,
        });

        // 2. 委员会(事件经 updater 实时发射)
        const config = opts.config ?? { configurable: { thread_id: '1' } };
        const llm = opts.llm ?? makeLlm();
        const graph = makeInvestmentCommittee(config, updater, llm as never, opts.tools, { billionsClient: opts.billionsClient });
        const initial = {
          messages: [new HumanMessage(`请帮我分析一下 ${ticker}`)],
          target_stock_ticker: ticker,
          stock_information: info,
        };
        // 迭代流以执行图（LangGraph JS 惰性执行;事件经 updater 实时发射）
        for await (const _chunk of await graph.stream(initial, config as never)) {
          /* 节点已完成;报告已由 pushReport 事件发出 */
        }
        const state = await graph.getState(config as never);
        const values = state.values as Record<string, unknown>;

        // 3. 最终报告对象
        const opinions: Opinion[] = [];
        for (const r of enabledRoles()) {
          const v = values[r.stateKey ?? ''];
          if (Array.isArray(v)) {
            for (const m of v as Array<{ content?: unknown }>) {
              if (typeof m?.content === 'string') {
                opinions.push({ key: r.stateKey!, tabTitle: r.tabTitle!, content: m.content });
              }
            }
          } else if (typeof v === 'string' && r.kind !== 'manager') {
            opinions.push({ key: r.stateKey!, tabTitle: r.tabTitle!, content: v });
          }
        }
        const report: FinalReport = {
          ticker,
          stock_information: info,
          final_decision: typeof values.final_decision === 'string' ? values.final_decision : '',
          opinions,
        };
        emit({ type: 'done', report });
        return report;
      } catch (err) {
        const message = describeError(err);
        emit({ type: 'error', error: message });
        throw err;
      }
    },
  };
}
