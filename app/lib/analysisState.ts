// 控制器状态形状的**唯一声明点**(2026-11 架构整改)。
//
// 整改前这套字段被抄了四份,并且已经漂了:
//   MutableState      (analysisController.ts) —— 17 字段,权威
//   HistoryState      (historyController.ts)  —— 12 字段,缺 error/running/settings/…
//   LiveStash         (historyController.ts)  —— 8 字段,缺 error
//   ReducibleState    (eventReduce.ts)        —— 7 字段
// 后果是真实的:error 在权威形状里、不在 LiveStash 里 → 「分析失败」横幅在
// 打开/关闭历史记录后仍然挂着,盖住刚恢复的正文。这类漏字段不可能被编译器发现,
// 因为每一份都是独立重写的 interface。
//
// 现在所有切片都从 AnalysisState 用 Pick 派生:新增字段时把字段名写进某一处 Pick,
// tsc 立刻枚举出所有需要同步赋值/复位的位置,漏掉就是编译错误。
//
// 用 `import type` 引本模块 —— 运行期零依赖,不存在循环初始化问题。

import type { PipelineEvent } from '../../src/events.ts';
import type { Market } from '../../src/market.ts';
import type { RoleStatus } from '../../src/progress.ts';
import type { RunSummary } from '../../src/runHistory.ts';
import type { SettingsState } from './settings.ts';

/** 上次分析结果标记(start 清除;done 恢复/写入)。 */
export interface LastRunMarker {
  at: string;
  mode: 'real' | 'demo';
}

/** 正在查看的历史条目标记(详情正文已在 events/finalDecision 等字段里)。 */
export interface ViewingRunMarker {
  id: string;
  at: string;
  ticker: string;
  mode: 'real' | 'demo';
}

/** 控制器内部可变状态(napshot() 浅拷贝外发;React 桥接只读镜像)。 */
export interface AnalysisState {
  events: PipelineEvent[];
  finalDecision: string;
  stockInformation: string;
  running: boolean;
  error: string | null;
  partials: Record<string, string>;
  statuses: Record<string, RoleStatus>;
  dataVersion: number;
  lastRunTicker: string;
  lastRunAt: LastRunMarker | null;
  market: Market;
  settings: SettingsState;
  hasDone: boolean;
  history: RunSummary[];
  historyLoading: boolean;
  historyError: string | null;
  viewingRun: ViewingRunMarker | null;
}

/** 「一份报告正文」覆盖的展示切片 —— 这是 openRun 前暂存、closeRun 原样写回、
 *  applyReportBody 赋值的**同一组**字段。
 *
 *  为什么 error 在列:`error` 属于「当前这屏结果」的一部分。打开历史时正文被替换,
 *  旧运行的失败横幅必须跟着退场(否则错误文案盖在新正文上);关闭历史时再随 stash
 *  一起恢复。整改前它漏在这里,是 openRun/closeRun 之后横幅不消失的根因。 */
export type LiveSlice = Pick<
  AnalysisState,
  | 'events'
  | 'finalDecision'
  | 'stockInformation'
  | 'partials'
  | 'statuses'
  | 'hasDone'
  | 'lastRunTicker'
  | 'market'
  | 'error'
>;

/** 历史域需要的状态切片(列表 + 查看态 + 借用 LiveSlice 的正文写入)。 */
export type HistorySlice = Pick<
  AnalysisState,
  | 'events'
  | 'finalDecision'
  | 'stockInformation'
  | 'partials'
  | 'statuses'
  | 'hasDone'
  | 'lastRunTicker'
  | 'market'
  | 'error'
  | 'history'
  | 'historyLoading'
  | 'historyError'
  | 'viewingRun'
>;

/** 事件归约(state 折叠)需要的切片。 */
export type ReducibleSlice = Pick<
  AnalysisState,
  | 'events'
  | 'finalDecision'
  | 'stockInformation'
  | 'partials'
  | 'statuses'
  | 'hasDone'
  | 'error'
>;
