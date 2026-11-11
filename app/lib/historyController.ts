// 分析历史归档控制器 —— 从 analysisController 抽出的历史域(B6 重构,评审 2026-11-09)。
//
// 迁出的是「历史」这一整块独立关注点:摘要列表刷新 / 打开某次运行 / 退出查看 /
// 删除 / 清空 / 首次升级迁移 / 报告正文映射 / done 落档。它自带三份可变状态:
//   historySeq     —— 正文选择的代数(CR-03)
//   historyListSeq —— 列表快照的代数(S5-1)
//   liveStash      —— 打开历史前暂存的实时态(closeRun 原样写回)
// 这三份此前和运行代数(runSeq)、看门狗、广播器混在同一个类里,任何一处改动都要
// 重新推理另外两处 —— 这是本次拆分的直接动机。
//
// 状态对象由调用方传入并按引用可变更新(与抽取前完全相同的写法),因此 React 侧
// 看到的行为逐字节不变。

import type { FinalReport, PipelineEvent } from '../../src/events.ts';
import type { Market } from '../../src/market.ts';
import { marketOfStoreTicker } from '../../src/market.ts';
import type { RoleStatus } from '../../src/progress.ts';
import { enabledRoles } from '../../src/committee.ts';
import { loadLastRun } from '../../src/lastRun.ts';
import { RUN_HISTORY_MIGRATED_KEY } from '../../src/metaKeys.ts';
import {
  mergeRunSummaries,
  newRunId,
  sortSummaries,
  toSummary,
  type AnalysisRun,
  type RunMode,
  type RunSummary,
} from '../../src/runHistory.ts';
import { describeError } from '../../src/events.ts';
import type { StoreLike } from '../../src/store.ts';
import type { RunArchive } from './runArchive.ts';

/** 历史操作需要的状态切片(控制器的 MutableState 结构上满足)。 */
export interface HistoryState {
  events: PipelineEvent[];
  finalDecision: string;
  stockInformation: string;
  partials: Record<string, string>;
  statuses: Record<string, RoleStatus>;
  hasDone: boolean;
  lastRunTicker: string;
  market: Market;
  history: RunSummary[];
  historyLoading: boolean;
  historyError: string | null;
  viewingRun: ViewingRunMarker | null;
}

export interface ViewingRunMarker {
  id: string;
  at: string;
  ticker: string;
  mode: RunMode;
}

export interface HistoryLog {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface HistoryDeps {
  readonly state: HistoryState;
  readonly runArchive: RunArchive;
  readonly store: StoreLike;
  readonly log: HistoryLog;
  /** 广播快照(控制器的 notifier)。 */
  notify(): void;
  /** 是否有分析正在跑(openRun 的运行中拒绝)。 */
  isRunning(): boolean;
}

/** 打开历史前暂存的实时态(closeRun 逐字段写回)。 */
interface LiveStash {
  events: PipelineEvent[];
  finalDecision: string;
  stockInformation: string;
  partials: Record<string, string>;
  statuses: Record<string, RoleStatus>;
  hasDone: boolean;
  lastRunTicker: string;
  market: Market;
}

export class RunHistoryController {
  /** CR-03:历史读取代数 —— 并发 openRun / closeRun / 删除后到者不得覆盖新状态。 */
  private historySeq = 0;
  /** S5-1:history *列表* 的代数 —— 与 historySeq 分开,否则每次定时刷新都会取消
   *  用户正在打开的历史。 */
  private historyListSeq = 0;
  /** 打开历史前的实时状态快照(null = 当前不是查看历史态)。 */
  private liveStash: LiveStash | null = null;

  constructor(private readonly deps: HistoryDeps) {}

  /** 重新读摘要列表。migrateLastRun=true 只在启动链传:首次升级把 lastRun 补成
   *  第一条历史,写迁移标记后不再重复(用户清空历史后不复活,PRD R2)。 */
  async refreshHistory(migrateLastRun = false): Promise<void> {
    const s = this.deps.state;
    const seq = ++this.historyListSeq;
    s.historyLoading = true;
    this.deps.notify();
    try {
      let list = await this.deps.runArchive.list();
      if (migrateLastRun) list = await this.migrateLastRunOnce(list);
      // S5-1(评审 2026-11-08):list() 读盘期间用户可能删了/清空了历史 —— 该快照
      // 已过期,合并会把已删除的行复活(点开即「历史记录不存在或已损坏」)。
      // 删除/清空/更新的刷新都递增代数,这里只在仍是当前代时落库。
      if (seq !== this.historyListSeq) return;
      // R-03:list() 快照不含刷新期间新落档的运行(recordRun 已写进 s.history)
      // → 直接赋值会把刚完成的运行从抽屉与徽标里抹掉。按 id 合并,磁盘为权威。
      s.history = mergeRunSummaries(list, s.history);
      s.historyError = null;
    } catch (err) {
      if (seq === this.historyListSeq) {
        const msg = describeError(err);
        this.deps.log.warn(`加载历史归档失败:${msg}`);
        s.historyError = `加载历史失败:${msg}`;
      }
    } finally {
      // 陈旧刷新的收尾不得清掉更新那一轮的 loading(会让面板提前结束转圈)
      if (seq === this.historyListSeq) {
        s.historyLoading = false;
        this.deps.notify();
      }
    }
  }

  /** 打开一条历史(在现有报告 Tab 内复现)。运行中拒绝:事件流仍会写 events，
   *  与历史内容混写后无法区分。首次打开暂存实时状态，closeRun 原样恢复。 */
  async openRun(id: string): Promise<void> {
    const s = this.deps.state;
    if (this.deps.isRunning()) return;
    const seq = ++this.historySeq;
    s.historyLoading = true;
    this.deps.notify();
    try {
      const run = await this.deps.runArchive.load(id);
      // R-02:进函数时那次 running 检查在 await 之前 —— 读盘期间用户可能已发起
      // 新分析(start() 全量重置并置 running),此时若继续写正文,历史内容会盖到
      // 实时运行上。补一次检查。
      // CR-03:并发 openRun(点 A 后立刻点 B)时先发后到会用旧记录覆盖最新选择;
      // closeRun/删除同样递增代数,迟到的 load 不得把用户拽回历史态。
      if (seq !== this.historySeq) return;
      if (this.deps.isRunning()) return;
      if (!run) {
        s.historyError = '历史记录不存在或已损坏';
        return;
      }
      if (!s.viewingRun) {
        // 暂存实时态(在 s 上就地覆盖，关闭时逐字段写回)
        this.liveStash = {
          events: [...s.events],
          finalDecision: s.finalDecision,
          stockInformation: s.stockInformation,
          partials: { ...s.partials },
          statuses: { ...s.statuses },
          hasDone: s.hasDone,
          lastRunTicker: s.lastRunTicker,
          market: s.market,
        };
      }
      this.applyReportBody(run);
      s.viewingRun = { id: run.id, at: run.at, ticker: run.ticker, mode: run.mode };
      s.historyError = null;
      this.deps.log.info(`查看历史分析:${run.ticker} @ ${run.at}`);
    } catch (err) {
      if (seq === this.historySeq) {
        const msg = describeError(err);
        this.deps.log.error(`读取历史分析失败:${msg}`);
        s.historyError = `读取历史失败:${msg}`;
      }
    } finally {
      // S10-3:陈旧 load 的收尾不得清掉更新那一轮的 loading
      if (seq === this.historySeq) {
        s.historyLoading = false;
        this.deps.notify();
      }
    }
  }

  /** 退出历史查看，恢复点开前的实时状态(不丢正在看的结果)。 */
  closeRun(): void {
    const s = this.deps.state;
    // CR-03 + S10-3:代数必须先递增 —— 旧实现只在「有 viewingRun」时递增,首次
    // openRun 在飞期间点关闭不会让它过期,迟到的 load 仍会把正文写进来。
    this.historySeq += 1;
    if (!s.viewingRun) {
      // S4(1.0.0 评审):首次 openRun 在飞时点关闭 —— 没有 viewingRun 可恢复,
      // 但那次 load 已被作废,它的 finally 不会再清 loading。不在这里复位,
      // 抽屉会永久停在「载入中…」(只能等下一次刷新/删除碰巧自愈)。
      if (s.historyLoading) {
        s.historyLoading = false;
        this.deps.notify();
      }
      return;
    }
    const stash = this.liveStash;
    this.liveStash = null;
    s.viewingRun = null;
    if (stash) {
      s.events = stash.events;
      s.finalDecision = stash.finalDecision;
      s.stockInformation = stash.stockInformation;
      s.partials = stash.partials;
      s.statuses = stash.statuses;
      s.hasDone = stash.hasDone;
      s.lastRunTicker = stash.lastRunTicker;
      s.market = stash.market;
    }
    this.deps.notify();
  }

  /** 删除历史条目(单条/批量同路径)。删除正在查看的条目 → 自动退出查看态。 */
  async deleteRuns(ids: string[]): Promise<void> {
    const s = this.deps.state;
    if (!ids.length) return;
    this.historyListSeq += 1; // S5-1:在飞的 refreshHistory 快照已过期
    s.historyLoading = true;
    this.deps.notify();
    try {
      const removed = await this.deps.runArchive.remove(ids);
      s.history = s.history.filter((h) => !ids.includes(h.id));
      s.historyError = null;
      this.deps.log.info(`删除历史分析:${removed} 条`);
      if (s.viewingRun && ids.includes(s.viewingRun.id)) this.closeRun();
    } catch (err) {
      const msg = describeError(err);
      this.deps.log.error(`删除历史失败:${msg}`);
      s.historyError = `删除历史失败:${msg}`;
    } finally {
      s.historyLoading = false;
      this.deps.notify();
    }
  }

  /** 清空全部历史(调用方负责二次确认)。 */
  async clearHistory(): Promise<void> {
    const s = this.deps.state;
    this.historyListSeq += 1; // S5-1:在飞的 refreshHistory 快照已过期
    s.historyLoading = true;
    this.deps.notify();
    try {
      await this.deps.runArchive.clear();
      s.history = [];
      s.historyError = null;
      this.deps.log.info('已清空分析历史');
      if (s.viewingRun) this.closeRun();
    } catch (err) {
      const msg = describeError(err);
      this.deps.log.error(`清空历史失败:${msg}`);
      s.historyError = `清空历史失败:${msg}`;
    } finally {
      s.historyLoading = false;
      this.deps.notify();
    }
  }

  /** 首次升级迁移:历史为空且未迁移过 → 把 soa:last-run 补成一条(id 固定，
   *  重复调用不会重复插入)。迁移标记写入后不再触发(清空历史不复活)。 */
  private async migrateLastRunOnce(list: RunSummary[]): Promise<RunSummary[]> {
    const { store, runArchive } = this.deps;
    if (store.getMeta(RUN_HISTORY_MIGRATED_KEY) !== null) return list;
    const last = loadLastRun(store);
    let next = list;
    if (last) {
      const legacy: AnalysisRun = {
        id: newRunId(last.at, 'legacy'),
        at: last.at,
        mode: last.mode,
        ticker: last.ticker,
        market: marketOfStoreTicker(last.ticker) ?? 'cn',
        stock_information: last.stock_information,
        final_decision: last.final_decision,
        opinions: last.opinions,
      };
      if (!list.some((x) => x.id === legacy.id)) {
        try {
          await runArchive.put(legacy);
          next = sortSummaries([...list, toSummary(legacy)]);
          this.deps.log.info(`历史迁移:上次分析 ${legacy.ticker} 已归档`);
        } catch (err) {
          // 迁移失败不置标记 —— 下次启动再试(数据仍在 lastRun,不丢)
          this.deps.log.warn(`历史迁移失败:${describeError(err)}`);
          return list;
        }
      }
    }
    // R-21:这里是一次 StoreLike 写入,而 PRD R7 说过「不写入 StoreLike」。
    // 评审后定为**有意例外**:只在首次升级那一次触发,单键、同启动链内已被
    // storeReady 打开,不引入新的后端/不随历史增长变慢;替代方案(把标记塞进
    // 归档)要给 RunArchive 加 meta 面,复杂度大于收益。已同步 PRD 备注。
    store.setMeta(RUN_HISTORY_MIGRATED_KEY, '1');
    return next;
  }

  /** 把一份报告正文映射到展示字段(bootstrap lastRun 恢复 / openRun 共用)。
   *  状态 chips:命中角色置「完成」(opinion 取修订节点);经理只在最终结论非空
   *  时算完成(与活运行 roleStatus 同语义)。 */
  applyReportBody(body: {
    ticker: string;
    stock_information: string;
    final_decision: string;
    opinions: AnalysisRun['opinions'];
    market: Market;
  }): void {
    const s = this.deps.state;
    s.lastRunTicker = body.ticker;
    s.stockInformation = body.stock_information;
    s.finalDecision = body.final_decision;
    s.events = body.opinions.map((o) => ({
      type: 'report' as const,
      key: o.key,
      tabTitle: o.tabTitle,
      content: o.content,
    }));
    const sts: Record<string, RoleStatus> = {};
    for (const o of body.opinions) {
      const r = enabledRoles().find((x) => x.stateKey === o.key);
      if (!r) continue;
      if (r.reviseNodeName) sts[r.reviseNodeName] = 'done';
      sts[r.nodeName] = 'done';
    }
    const manager = enabledRoles().find((r) => r.kind === 'manager');
    if (manager && body.final_decision.trim()) sts[manager.nodeName] = 'done';
    s.statuses = sts;
    // R-01:归档正文是最终内容 —— 必须清掉实时流式分片,否则 ReportContent 的
    // `partial || fallback` 会让取消/失败那次运行残留的半截草稿盖住历史正文
    // (openRun 已在 applyReportBody 之前把分片存进 liveStash,closeRun 原样恢复)
    s.partials = {};
    // D15:完成标记与经理 chip 同条件(final_decision 非空才算完成会话)
    s.hasDone = Boolean(body.final_decision.trim());
    s.market = body.market;
  }

  /** done 后落一条历史(写穿异步:失败只记日志 + 抽屉错误，不影响已完成结果)。 */
  recordRun(report: FinalReport, at: string, mode: RunMode): void {
    const s = this.deps.state;
    const run: AnalysisRun = {
      id: newRunId(at),
      at,
      mode,
      ticker: report.ticker,
      market: s.market,
      stock_information: report.stock_information,
      final_decision: report.final_decision,
      opinions: report.opinions.map((o) => ({ ...o })),
    };
    // 列表立即可见(不必等写盘/下一次 refresh)
    s.history = sortSummaries([toSummary(run), ...s.history]);
    void this.deps.runArchive.put(run).catch((err: unknown) => {
      const msg = describeError(err);
      this.deps.log.error(`写历史归档失败:${msg}`);
      s.historyError = `历史归档写入失败:${msg}`;
      this.deps.notify();
    });
  }
}
