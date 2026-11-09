// 运行事件归约 —— 从 analysisController.handleEvent 抽出的**纯状态折叠**
// (B6 重构,评审 2026-11-09)。
//
// 边界:
//   - 本模块只做「事件 → 状态字段」的确定性改写 + 产出应写的日志文本。
//   - 一切副作用(写 lastRun / 归档 / store.flush / 广播 / 看门狗重置)都留在控制器:
//     reduceEvent 通过返回值告诉调用方「本次该做什么」。
//
// 这样 done 的降级判定、partial 清理、retry 复位这些容易写错的分支可以逐事件
// 单测,不必搭起 20 个依赖的控制器。
import type { PipelineEvent } from '../../src/events.ts';
import type { RoleStatus } from '../../src/progress.ts';

/** 参与归约的可变状态切片(控制器把它自己的 st 传进来)。 */
export interface ReducibleState {
  events: PipelineEvent[];
  finalDecision: string;
  stockInformation: string;
  partials: Record<string, string>;
  statuses: Record<string, RoleStatus>;
  hasDone: boolean;
  error: string | null;
}

export interface LogLine {
  level: 'info' | 'error';
  message: string;
}

/** 归约结果:调用方据此决定副作用。 */
export type ReduceOutcome =
  /** 事件被丢弃(看门狗已中止且不是 done)。 */
  | { kind: 'dropped' }
  /** 状态已更新;notify 说明该立即广播还是走 token 合并窗口。 */
  | { kind: 'applied'; notify: 'immediate' | 'coalesced' }
  /** done 事件:状态里已写入 finalDecision/stockInformation,持久化由调用方执行。 */
  | { kind: 'done'; report: Extract<PipelineEvent, { type: 'done' }>['report'] };

export interface ReduceContext {
  /** 看门狗已中止:只接受 done(真跑完的结果不该丢)。 */
  timedOut: boolean;
  /** stateKey → 该角色涉及的节点名(初稿 + 修订)。报告事件据此清 partial。 */
  roleNodesFor(key: string): string[];
}

/** 归约一个运行事件。纯函数:除 state 外无外部可变依赖。 */
export function reduceEvent(
  state: ReducibleState,
  e: PipelineEvent,
  ctx: ReduceContext,
): { outcome: ReduceOutcome; logs: LogLine[] } {
  const logs: LogLine[] = [];

  // 看门狗中止后只接受 done:用户已看到「已中止」,但真跑完的结果不该丢
  // (孤儿 pipeline 的 token/progress 不再写 UI)
  if (ctx.timedOut && e.type !== 'done') return { outcome: { kind: 'dropped' }, logs };

  if (e.type === 'progress') {
    logs.push({ level: 'info', message: e.message });
  } else if (e.type === 'report') {
    logs.push({ level: 'info', message: `报告[${e.tabTitle}] ${e.content.length} 字符` });
    // 最终内容权威:清空该 stateKey 对应节点的流式 partial(opinion 含初稿+修订)。
    // 用事件时刻的角色注册表(而非挂载闭包):设置面板中途启用/禁用角色后,
    // 报告清除仍按当前注册表生效。
    for (const node of ctx.roleNodesFor(e.key)) delete state.partials[node];
  } else if (e.type === 'token') {
    state.partials[e.node] = (state.partials[e.node] ?? '') + e.delta;
    // token 不入 events:UI 不读它(只读 partials),保存它只会让每帧快照拷贝的
    // 数组越拉越长(一次分析上万个 delta,拷贝总量 O(n²))
    return { outcome: { kind: 'applied', notify: 'coalesced' }, logs };
  } else if (e.type === 'roleStatus') {
    logs.push({ level: 'info', message: `状态[${e.node}] ${e.status}` });
    state.statuses[e.node] = e.status;
    if (e.status === 'retry') {
      // retry 复位:清空该节点已流出文本(工具轮回滚与 LLM 重试共用通道)
      state.partials[e.node] = '';
    }
  } else if (e.type === 'done') {
    const report = e.report;
    state.finalDecision = report.final_decision;
    state.stockInformation = report.stock_information;
    logs.push({
      level: 'info',
      message: `分析完成:${report.opinions.length} 份观点,最终决策 ${report.final_decision.length} 字符`,
    });
    state.events.push(e);
    return { outcome: { kind: 'done', report }, logs };
  } else if (e.type === 'error') {
    logs.push({ level: 'error', message: e.error });
    state.error = e.error;
    // #96:error 终态清角色 chips(防「完成/分析中」残留)
    state.statuses = {};
    state.hasDone = false; // D15:error 终态撤销完成标记
  }

  state.events.push(e);
  return { outcome: { kind: 'applied', notify: 'immediate' }, logs };
}
