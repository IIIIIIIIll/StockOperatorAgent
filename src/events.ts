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
import type { Market } from './market.ts';
import type { ProgressUpdater, RoleStatus } from './progress.ts';
import type { PipelineDeps } from './pipeline.ts';
import { EXHAUSTED_NO_ANSWER_TEXT, NO_CONCLUSION_TEXT, type ToolLike } from './toolLoop.ts';
import { warn } from './log.ts';

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
  /** true = 最终结论为空或占位兜底（收尾轮失败/空流）；消费方不得当作成功。 */
  degraded?: boolean;
}

export interface RunOptions extends Omit<PipelineDeps, 'store' | 'progress'> {
  llm?: unknown; // 注入;缺省 makeLlm()
  config?: unknown;
  /** 工具注入（亿信三件套 + web_search；App 层组装，web 端 key 在 localStorage）。 */
  tools?: ToolLike[];
  /** 亿信客户端注入（web 端 localStorage key → 信息面分析师预抓三源+twitter；
   *  缺省 → 现状：分析师内部回退无 key client，亿信路径静默关闭、DDG 兜底）。 */
  billionsClient?: BillionsClient;
  /** 市场（S4，继承自 PipelineDeps）：提示词/日期/管道块分支；缺省 cn。 */
  market?: Market;
}

export interface PipelineRunner {
  subscribe(listener: (e: PipelineEvent) => void): () => void;
  run(ticker: string, opts?: RunOptions): Promise<FinalReport | undefined>;
  /** 可选:放弃当前运行的并发守卫(不中断底层 pipeline)。控制器在取消/看门狗
   *  中调用 —— 否则一个永不 settle 的运行会让 runner 永久 busy。测试假件可省略。 */
  abort?(): void;
}

/** LangGraph 聚合异常(如 superstep 并行节点全失败)含 errors[]——提取具体原因。 */
export function describeError(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const e = err as { message?: unknown; errors?: unknown };
    if (Array.isArray(e.errors) && e.errors.length) {
      const parts = e.errors.map((x) => {
        const m = (x as { message?: unknown })?.message;
        if (typeof m === 'string') return m;
        let s: string | undefined;
        try {
          s = JSON.stringify(x);
        } catch {
          s = undefined;
        }
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
  // C2 并发守卫:实例级(模块单例 app/lib/runner.ts:77 与探针 runner 各自独立)。
  // 入口同步置位(先于任何 await),done/catch 两路径复位;busy 拒绝不改状态。
  let running = false;
  // 运行代数:abort() 与每次 run() 都递增。孤儿 pipeline 迟到结束时只在自己
  // 仍是当前代时才复位 running —— 否则会把新一轮的 running 清掉(同 tick 可重入)。
  let runSeq = 0;

  // S1-4(评审 2026-11-08):订阅者抛错仍不阻断其余订阅者,但不再完全静默 ——
  // emit 每个 delta 都调,全量打日志会涨掉输出,故前 5 次记 warn + 累计计数留痕。
  let subscriberErrors = 0;
  function emit(e: PipelineEvent): void {
    for (const fn of listeners) {
      try {
        fn(e);
      } catch (err) {
        subscriberErrors += 1;
        if (subscriberErrors <= 5) {
          warn(
            `事件订阅者抛错(已忽略,累计 ${subscriberErrors} 次,事件 ${e.type}):${err instanceof Error ? err.message : String(err)}`,
          );
        }
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

    /** 放弃当前运行:只复位并发守卫,不中断底层 pipeline(LLM 客户端未接 abort)。
     *  没有它,取消/看门狗中止后任何后续 run() 都会被 C2 守卫永久拒绝
     *  ("上一次分析仍在进行中"),而 await 永不返回的运行根本不会复位。 */
    abort() {
      runSeq += 1;
      running = false;
    },

    async run(ticker, opts = {}) {
      // C2 守卫:入口(任何 await 之前)同步检查+置位 —— 同 tick 二次调用(如
      // __soa.start 直调)即可见 running=true,以 error 事件(busy 语义)拒绝并
      // resolve(undefined);不得启动第二个 pipeline、不得交错事件。
      if (running) {
        emit({ type: 'error', error: '上一次分析仍在进行中,请等待完成后再试' });
        return undefined;
      }
      running = true;
      const mySeq = ++runSeq;
      // 仅当自己仍是当前代时才复位(abort()/新一轮会让旧代失效)
      const releaseRunning = () => {
        if (mySeq === runSeq) running = false;
      };
      try {
        emit({ type: 'progress', message: `开始分析 ${ticker}...` });

        // S4:市场线程(缺省 cn 逐字节不变)。mcp 情报注入点在 App 层
        // (runner.makeMcpIntel → deps.mcp)——本文件不调 makeMcpIntel,
        // hk/us 跳过注入由 App 层按 market 决定;pipeline 块 4 占位兜底。
        const market = opts.market ?? 'cn';

        // 1. 组装 stock_information(图前 enrichment 唯一组装点;数据已由
        //    Node 侧采集写入 store —— 见 tools/probe.mts;App 端注入/预载)
        const info = buildStockInformation(ticker, {
          ...opts,
          store,
          progress: updater,
          market,
        });

        // 2. 委员会(事件经 updater 实时发射)
        const config = opts.config ?? { configurable: { thread_id: '1' } };
        const llm = opts.llm ?? makeLlm();
        const graph = makeInvestmentCommittee(config, updater, llm as never, opts.tools, { billionsClient: opts.billionsClient, market });
        const initial = {
          messages: [new HumanMessage(`请帮我分析一下 ${ticker}`)],
          target_stock_ticker: ticker,
          stock_information: info,
          market,
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
        const finalDecision = typeof values.final_decision === 'string' ? values.final_decision : '';
        const report: FinalReport = {
          ticker,
          stock_information: info,
          final_decision: finalDecision,
          // CR-21:占位/空结论不算成功——消费方(历史缓存/UI)据此区分降级终态
          degraded:
            finalDecision.trim() === '' ||
            finalDecision === EXHAUSTED_NO_ANSWER_TEXT ||
            finalDecision === NO_CONCLUSION_TEXT,
          opinions,
        };
        emit({ type: 'done', report });
        releaseRunning(); // done 路径复位:状态变可用,后续 run 正常执行
        return report;
      } catch (err) {
        // 契约(error-handling.md「runner never throws past event boundary」):
        // 运行期/配置期失败一律以 `error` 事件(携带 describeError 消息文本)
        // 上报,run() resolve(undefined)而非 rethrow —— 失败信号唯一通道是
        // 事件,UI/探针经 subscribe 消费,不越过事件边界抛错。
        const message = describeError(err);
        emit({ type: 'error', error: message });
        releaseRunning(); // catch 路径复位:失败终态后 runner 回到可用状态
        return undefined;
      }
    },
  };
}
