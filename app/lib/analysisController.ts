// 分析编排控制器 —— useAnalysis 的可测核心(E1 整改,08-22-repo-review-remediation U13)
// 职责:启动链(bootstrap)、lastRun 恢复、runner 事件归约(events/partials/statuses/
// done 写缓存/错误横幅)、start(ticker, market) 编排、设置变更。
//
// 纯 TS 可注入:零 react-native、零 app/lib/runner 静态依赖 —— runner/store/
// 设置读写/采集/intel/keepalive/log/clock 全部经 AnalysisDeps 注入(签名不设
// 默认实现,对齐 collectorSelection 注入先例),vitest 以假 runner(emit 事件)+
// InMemoryStore 直接驱动(仿 events.test.ts 的 runner 测试模式)。useAnalysis 只剩
// React 状态桥接(deps 接线 + 快照订阅 + start/onSettingsChange 转发)。
//
// 行为等价基线 = 抽取前 useAnalysis.ts(08-16-app-analysis-hook 版),差异仅:
// - D9:onSettingsChange 仅非运行态清错误横幅(运行中保留);
// - D15:新增 hasDone(done → true;start()/error → false;lastRun 恢复按
//   final_decision 非空同步),App「✓分析完成」横幅消费(D15 整体门);
// - C1 侧:「分析结束:耗时」仅在 runner.run resolve 出报告时打(U1 契约:runner
//   不越过事件边界抛错,失败 resolve(undefined)——不再打印误导性成功耗时);
//   catch 为防御性兜底,单 banner 来源仍是 error 事件监听。
import { describeError, type FinalReport, type PipelineEvent, type PipelineRunner } from '../../src/events.ts';
import type { StoreLike } from '../../src/store.ts';
import type { Market } from '../../src/market.ts';
import { marketOfStoreTicker, normalizeTicker } from '../../src/market.ts';
import type { RoleStatus } from '../../src/progress.ts';
import type { Platform } from '../../src/log.ts';
import { enabledRoles } from '../../src/committee.ts';
import { buildStockInformation } from '../../src/pipeline.ts';
import { asiaToday } from '../../src/gates.ts';
import type { WebCollectResult } from '../../src/webCollect.ts';
import { loadLastRun, saveLastRun } from '../../src/lastRun.ts';
import { DEMO_F10_KEY, DEMO_TICKER, RUN_HISTORY_MIGRATED_KEY } from '../../src/metaKeys.ts';
import {
  mergeRunSummaries,
  newRunId,
  sortSummaries,
  toSummary,
  type AnalysisRun,
  type RunSummary,
} from '../../src/runHistory.ts';
import type { RunArchive } from './runArchive.ts';
import { envValue } from '../../src/env.ts';
import type { BillionsClient } from '../../src/billionsClient.ts';
import type { LlmConfig } from '../../src/llm.ts';
import type { ToolLike } from '../../src/toolLoop.ts';
import {
  describeLlmKeys,
  llmConfigured,
  missingLlmKeys,
  toLlmConfig,
  type CapsState,
  type KeysState,
  type SettingsState,
} from './settings.ts';

/** 平台形态:web → 同源代理(/llm-proxy、采集代理);native(RN 真机/桌面壳)→ 设备链直连。 */
/** 运行空闲看门狗:超过该时长没有任何事件(含 token)即判定连接已死。
 *  真机锁屏后基站/NAT 会静默丢弃 TCP(无 FIN/RST),而 RN 侧 OkHttp 的
 *  connect/read/write 超时全是 0(无限)、LLM 客户端也刻意不设 timeout
 *  (src/llm.ts:~69)→ await 永不返回,running 卡在 true、保活通知不落,
 *  用户唯一出路是重启 App。120s 远大于最长正常停顿(单次 LLM 调用可达
 *  数分钟,但期间工具轮/进度事件不断流,不会触发)。 */
const RUN_IDLE_TIMEOUT_MS = 300_000;

/** token 合并广播窗口:一次分析上万个 delta,每个都全量快照 + React 重渲染
 *  会把 JS 线程打满(快照里 events 数组的拷贝是 O(n²))。120ms ≈ 8fps,
 *  肉眼仍是流式。 */
const TOKEN_NOTIFY_MS = 120;

export type ControllerPlatform = Extract<Platform, 'web' | 'rn'>;

/** 日志面(src/log info/warn/error 同形;测试以捕获数组替换)。 */
export interface AnalysisLog {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/** 亿信/MCP 实时情报闭包(makeBillionsIntel/makeMcpIntel 产物)。 */
export type IntelProvider = (ticker: string) => string;

/** 上次分析结果标记(start 清除;done 恢复/写入)。 */
export interface LastRunMarker {
  at: string;
  mode: 'real' | 'demo';
}

/** 对外状态快照 —— 与抽取前 useAnalysis 返回字段逐一对应,+hasDone(D15)。 */
export interface AnalysisSnapshot {
  readonly events: PipelineEvent[];
  readonly finalDecision: string;
  readonly stockInformation: string;
  readonly running: boolean;
  readonly error: string | null;
  readonly partials: Record<string, string>;
  readonly statuses: Record<string, RoleStatus>;
  readonly dataVersion: number;
  readonly lastRunTicker: string;
  readonly lastRunAt: LastRunMarker | null;
  readonly market: Market;
  readonly settings: SettingsState;
  /** D15:done 事件后 true;新 start()/error 事件后 false;lastRun 恢复按
   *  final_decision 非空同步(App「✓分析完成」横幅消费)。 */
  readonly hasDone: boolean;
  /** 历史归档摘要列表(时间倒序;正文按需 openRun 加载 —— 启动不背历史体积)。 */
  readonly history: RunSummary[];
  /** 历史列表读写进行中(抽屉 spinner / 行禁用)。 */
  readonly historyLoading: boolean;
  /** 历史读写错误(抽屉内展示;与运行错误横幅 error 分渠道)。 */
  readonly historyError: string | null;
  /** 正在查看的历史条目;null = 看实时结果。顶部横幅 + 「返回最新」消费。 */
  readonly viewingRun: ViewingRunMarker | null;
}

/** 正在查看的历史条目标记(详情正文已在 events/finalDecision 等字段里)。 */
export interface ViewingRunMarker {
  id: string;
  at: string;
  ticker: string;
  mode: 'real' | 'demo';
}

/** 注入依赖面:生产由 useAnalysis 接线(app/lib/runner + settings + keepalive +
 *  src/log),测试以假实现替换。全部必填,无默认实现。 */
export interface AnalysisDeps {
  /** 持久化后端(与 runner 同实例;lastRun 读写/demo 数据查询共用)。 */
  readonly store: StoreLike;
  /** 历史归档后端(runArchive.ts;web/桌面 IndexedDB、RN 文件、测试内存)。
   *  不进 StoreLike —— 展示层归档,四族同步契约与桌面 IPC 协议不动。 */
  readonly runArchive: RunArchive;
  /** 事件源 runner(createPipelineRunner 单例;测试用假 runner emit 驱动)。 */
  readonly runner: PipelineRunner;
  readonly platform: ControllerPlatform;
  // ── 启动链(bootstrap)───────────────────────────────────────────────
  readonly storeReady: () => Promise<void>;
  readonly loadDemoData: () => boolean;
  /** native 启动链设备注入(setDeviceStore(store);web 不调用;缺省 no-op)。 */
  readonly injectDeviceStore?: () => Promise<void> | void;
  // ── 设置 ────────────────────────────────────────────────────────────
  readonly loadSettings: () => SettingsState;
  readonly saveSettings: (next: SettingsState) => void;
  /** 面板开关 → 能力开关注入(setCapabilitySwitches ∘ switchesToCapabilities)。 */
  readonly applyCapabilitySwitches: (settings: SettingsState) => void;
  // ── start() 编排 ────────────────────────────────────────────────────
  readonly buildLlm: (cfg: LlmConfig | null, proxyBase?: string) => unknown;
  /** 平台+市场采集分派(web 代理/selectCollector/真机桥,含 finnhub 绑定);
   *  失败抛错 → start() 以「行情采集失败」横幅短路(与抽取前一致)。 */
  readonly collect: (
    ticker: string,
    market: Market,
    finnhub: { apiKey: string } | null,
  ) => Promise<WebCollectResult>;
  /** 亿信/MCP 情报预查询(mcp 仅 cn 查询的 S4 门控由实现侧承担)。 */
  readonly fetchIntel: (
    ticker: string,
    market: Market,
    keys: KeysState,
  ) => Promise<{ billions?: IntelProvider; mcp?: IntelProvider }>;
  /** 亿信 client 工厂(key 存在 → new BillionsClient;否则 undefined 零网络)。 */
  readonly makeBillionsClient: (apiKey: string | null) => BillionsClient | undefined;
  readonly assembleTools: (keys: KeysState, caps?: Partial<CapsState>) => ToolLike[];
  readonly keepAliveStart: (title: string, body: string) => void;
  readonly stopKeepAlive: () => void;
  // ── 环境 ────────────────────────────────────────────────────────────
  readonly log: AnalysisLog;
  readonly nowMs: () => number;
  readonly isoNow: () => string;
}

/** 内部可变状态(snapshot() 浅拷贝外发;React 桥接只读镜像)。 */
interface MutableState {
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

export class AnalysisController {
  private readonly deps: AnalysisDeps;
  private readonly st: MutableState;
  private readonly listeners = new Set<(s: AnalysisSnapshot) => void>();
  // 上次分析运行模式(real|demo):done 写缓存/标记时以 start() 时刻模式为准
  private mode: 'real' | 'demo' = 'demo';
  /** CR-03:历史读取代数——并发 openRun / closeRun / 删除后到者不得覆盖新状态。 */
  private historySeq = 0;
  /** S5-1:history *列表* 口头代数 —— refreshHistory 的 list() 快照用。与 historySeq
   *  (openRun/closeRun 的正文选择)分开,否则每次定时刷新都会取消用户正在打开的历史。 */
  private historyListSeq = 0;
  /** 运行代数:每次 start/取消/新一轮都递增。事件订阅、catch/finally、看门狗均按
   *  「是否仍是当前代」作用域化 —— 否则被取消/中止的孤儿运行迟到 settle 时会停掉
   *  新一轮的保活与看门狗,把新一轮重新打回 cached 冻结(正是要修的那个假死)。 */
  private runSeq = 0;
  /** 当前代的事件处理器(构造时只订阅一次,按代分派)。 */
  private runHandler: ((e: PipelineEvent) => void) | null = null;
  /** 看门狗已中止但底层 pipeline 可能仍在跑:此时只接受 done(真跑完的结果不该丢)。 */
  private timedOut = false;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;
  private lastWatchdogArm = 0;
  /** 打开历史前的实时状态快照(closeRun 逐字段写回;null = 当前不是查看历史态)。 */
  private liveStash: {
    events: PipelineEvent[];
    finalDecision: string;
    stockInformation: string;
    partials: Record<string, string>;
    statuses: Record<string, RoleStatus>;
    hasDone: boolean;
    lastRunTicker: string;
    market: Market;
  } | null = null;

  constructor(deps: AnalysisDeps) {
    this.deps = deps;
    this.st = {
      events: [],
      finalDecision: '',
      stockInformation: '',
      running: false,
      error: null,
      partials: {},
      statuses: {},
      dataVersion: 0,
      lastRunTicker: DEMO_TICKER,
      lastRunAt: null,
      market: 'cn',
      settings: deps.loadSettings(),
      hasDone: false,
      history: [],
      historyLoading: false,
      historyError: null,
      viewingRun: null,
    };
    // runner 订阅随控制器生命周期存在(构造即订阅;根 hook 常驻不卸载)。
    // 按代分派:订阅本身不动,换 runHandler 即隔离孤儿运行的事件。
    // 无运行时的游离事件(测试/探针直推)仍交给 handleEvent,保持旧行为。
    // P1-1(评审 2026-11-09):runHandler 的闭包比的是「处理器自己的 seq」,只要
    // 新一轮 start() 装了新闭包,孤儿运行的事件也会匹配 —— 必须在派发前按事件
    // 自带的 runTag 判来源。runTag 缺省 = 未经 runner 的直推事件,照旧放行。
    deps.runner.subscribe((e) => {
      if (e.runTag !== undefined && e.runTag !== this.runSeq) return;
      if (this.runHandler) this.runHandler(e);
      else this.handleEvent(e);
    });
  }

  /** ── 取消当前分析 ──────────────────────────────────────────────────────
   *  只把 UI/状态拉回可用,不打断 runner 内部的 promise(LLM 客户端未接 abort
   *  通道),孤儿运行的事件由 cancelled 门丢弃。价值:任何卡住的运行都能自己停,
   *  不必重启 App —— 这是「假死」体验的死因(开始按钮 running 时 disabled,
   *  且原来没有第二种出口)。 */
  cancel(): void {
    const s = this.st;
    if (!s.running) return;
    this.deps.log.warn('用户取消分析');
    // 作废当前代:孤儿运行的迟到事件全部丢弃,其 catch/finally 也不再收尾
    // (runHandler 保留旧代闭包:它的 seq 已不匹配 → 事件自然被丢弃)
    this.runSeq += 1;
    // 复位 runner 的并发守卫 —— 否则永不 settle 的运行会让后续 run() 被
    // 「上一次分析仍在进行中」永久拒绝,取消等于什么都没解决
    this.deps.runner.abort?.();
    s.error = '已取消分析';
    s.statuses = {};
    this.finishRun();
    this.notify();
  }

  /** 回到前台时补一次广播:锁屏期间压下的 token 合并帧可能在后台被节流,
   *  回前台刷新一次让用户看到最新进度,而不是等下一个事件。 */
  refresh(): void {
    this.clearNotify();
    this.notify();
  }

  // ─── 分析历史归档(展示层;不进 StoreLike)───────────────────────────────

  /** 重新读摘要列表。migrateLastRun=true 只在启动链传:首次升级把 lastRun 补成
   *  第一条历史,写迁移标记后不再重复(用户清空历史后不复活,PRD R2)。 */
  async refreshHistory(migrateLastRun = false): Promise<void> {
    const s = this.st;
    const seq = ++this.historyListSeq;
    s.historyLoading = true;
    this.notify();
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
        this.notify();
      }
    }
  }

  /** 打开一条历史(在现有报告 Tab 内复现)。运行中拒绝:事件流仍会写 events，
   *  与历史内容混写后无法区分。首次打开暂存实时状态，closeRun 原样恢复。 */
  async openRun(id: string): Promise<void> {
    const s = this.st;
    if (s.running) return;
    const seq = ++this.historySeq;
    s.historyLoading = true;
    this.notify();
    try {
      const run = await this.deps.runArchive.load(id);
      // R-02:进函数时那次 running 检查在 await 之前 —— 读盘期间用户可能已发起
      // 新分析(start() 全量重置并置 running),此时若继续写正文,历史内容会盖到
      // 实时运行上。补一次检查。
      // CR-03:并发 openRun(点 A 后立刻点 B)时先发后到会用旧记录覆盖最新选择;
      // closeRun/删除同样递增代数,迟到的 load 不得把用户拽回历史态。
      if (seq !== this.historySeq) return;
      if (s.running) return;
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
        this.notify();
      }
    }
  }

  /** 退出历史查看，恢复点开前的实时状态(不丢正在看的结果)。 */
  closeRun(): void {
    const s = this.st;
    // CR-03 + S10-3:代数必须先递增 —— 旧实现只在「有 viewingRun」时递增,首次
    // openRun 在飞期间点关闭不会让它过期,迟到的 load 仍会把正文写进来。
    this.historySeq += 1;
    if (!s.viewingRun) return;
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
    this.notify();
  }

  /** 删除历史条目(单条/批量同路径)。删除正在查看的条目 → 自动退出查看态。 */
  async deleteRuns(ids: string[]): Promise<void> {
    const s = this.st;
    if (!ids.length) return;
    this.historyListSeq += 1; // S5-1:在飞的 refreshHistory 快照已过期
    s.historyLoading = true;
    this.notify();
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
      this.notify();
    }
  }

  /** 清空全部历史(调用方负责二次确认)。 */
  async clearHistory(): Promise<void> {
    const s = this.st;
    this.historyListSeq += 1; // S5-1:在飞的 refreshHistory 快照已过期
    s.historyLoading = true;
    this.notify();
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
      this.notify();
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
      if (!list.some((s) => s.id === legacy.id)) {
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
  private applyReportBody(body: {
    ticker: string;
    stock_information: string;
    final_decision: string;
    opinions: AnalysisRun['opinions'];
    market: Market;
  }): void {
    const s = this.st;
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
  private recordRun(report: FinalReport, at: string): void {
    const s = this.st;
    const run: AnalysisRun = {
      id: newRunId(at),
      at,
      mode: this.mode,
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
      this.notify();
    });
  }

  /** 结束运行态:先释放保活(可能同步抛错)再清标志 —— 否则保活的同步异常会
   *  逃出 finally,让 running 永远停在 true、按钮永远「分析中…」。 */
  private finishRun(): void {
    this.clearWatchdog();
    this.clearNotify();
    this.st.running = false;
    try {
      this.deps.stopKeepAlive();
    } catch (err) {
      this.deps.log.warn(`释放保活失败:${describeError(err)}`);
    }
  }

  private clearWatchdog(): void {
    if (this.watchdog !== null) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
  }

  /** 每个事件重置一次;到期即中止并报错,把「无限等」变成「可恢复的失败」。
   *  不递增 runSeq:底层 pipeline 可能只是安静(大包 tool 调用),真跑完的 done
   *  仍应该落地 —— 见 timedOut 门。 */
  private armWatchdog(): void {
    this.clearWatchdog();
    this.lastWatchdogArm = this.deps.nowMs();
    this.watchdog = setTimeout(() => {
      this.watchdog = null;
      if (!this.st.running) return;
      const msg = `分析已 ${Math.round(RUN_IDLE_TIMEOUT_MS / 1000)} 秒无任何进展,已中止等待(网络可能在锁屏期间断开)`;
      this.deps.log.error(msg);
      this.timedOut = true;
      // 复位并发守卫,让用户能立即重试(孤儿 pipeline 继续跑,事件由 timedOut 门过滤)
      this.deps.runner.abort?.();
      this.st.error = msg;
      this.st.statuses = {};
      this.finishRun();
      this.notify();
    }, RUN_IDLE_TIMEOUT_MS);
  }

  /** 事件驱动的重置节流 ≥1s:每个 token 都重建 timer 会新增成千上万次 JSI 调用
   *  (setTimeout/clearTimeout),把本批次刚优化的线程负载又加回去。 */
  private rearmWatchdog(): void {
    if (this.deps.nowMs() - this.lastWatchdogArm < 1000) return;
    this.armWatchdog();
  }

  private clearNotify(): void {
    if (this.notifyTimer !== null) {
      clearTimeout(this.notifyTimer);
      this.notifyTimer = null;
    }
  }

  /** token 专用尾部合并广播(见 TOKEN_NOTIFY_MS);非 token 事件仍即时 notify。 */
  private scheduleNotify(): void {
    if (this.notifyTimer !== null) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      this.notify();
    }, TOKEN_NOTIFY_MS);
  }

  /** UI 快照订阅(hook 挂载 effect 调用;返回退订函数,同 runner.subscribe 契约)。 */
  subscribe(fn: (s: AnalysisSnapshot) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  snapshot(): AnalysisSnapshot {
    const s = this.st;
    return {
      events: [...s.events],
      finalDecision: s.finalDecision,
      stockInformation: s.stockInformation,
      running: s.running,
      error: s.error,
      partials: { ...s.partials },
      statuses: { ...s.statuses },
      dataVersion: s.dataVersion,
      lastRunTicker: s.lastRunTicker,
      lastRunAt: s.lastRunAt ? { ...s.lastRunAt } : null,
      market: s.market,
      settings: s.settings,
      hasDone: s.hasDone,
      history: [...s.history],
      historyLoading: s.historyLoading,
      historyError: s.historyError,
      viewingRun: s.viewingRun ? { ...s.viewingRun } : null,
    };
  }

  /** 启动链:storeReady → (native 设备注入)→ demo 载入 → lastRun 恢复/演示上下文
   *  → 设置加载 → dataVersion=1。时序与抽取前逐点等价;storeReady 挂起期间
   *  start() 已启动时,恢复段整体跳过(N-2,start() 优先)。 */
  async bootstrap(): Promise<void> {
    // S5-2(评审 2026-11-08):旧实现的 storeReady 之后的半段(injectDeviceStore /
    // loadDemoData / buildStockInformation …)都在 try 外,而调用点是
    // `void ctrl.bootstrap()` —— 任何抛出都是未处理 rejection,启动链静默半截
    // 而 UI 无任何提示。包一层:记日志 + 错误横幅,不再静默。
    try {
      await this.bootstrapInner();
    } catch (err) {
      const msg = describeError(err);
      this.deps.log.error(`启动链异常:${msg}`);
      this.st.error = `启动失败:${msg}`;
      this.notify();
    }
  }

  private async bootstrapInner(): Promise<void> {
    const d = this.deps;
    const s = this.st;
    const t0 = d.nowMs();
    d.log.info(`应用启动:TS 版投资委员会(web)`);
    // 持久化后端就绪(IndexedDB 打开 + 内存 hydrate / 文件读回)后再加载——
    // freshness 门(同日跳过)需读跨会话 lastDataUpdate/report_date
    try {
      await d.storeReady();
    } catch (err) {
      const msg = describeError(err);
      d.log.error(`存储就绪失败:${msg}`);
      s.error = msg;
      this.notify();
      return;
    }
    // native(RN 真机)采集注入先于任何采集(保持原时序:setDeviceStore 在
    // start() 采集前完成);web 不使用。
    if (d.platform !== 'web') await d.injectDeviceStore?.();
    // N-2:start() 优先 —— storeReady 挂起期间用户已点「开始分析」(UI 仅按
    // running 禁用按钮),若继续载入 demo / 恢复 lastRun 缓存,会把上次会话的
    // events/statuses/hasDone 覆盖进运行中的会话。守卫:运行中 → bootstrap 到此
    // 为止(设置/数据版本由 start()/构造路径负责);bootstrap 先行完成时 running
    // 恒 false,恢复行为与抽取前逐点等价。
    if (s.running) {
      // 运行中的会话也应该能看到/打开旧记录(openRun 自身有 running 门)
      void this.refreshHistory(true);
      return;
    }
    // 仅空库时载入 demo(有跨会话持久化数据则跳过);日志只在真正写入时打
    // (旧实现无论是否载入都打,真实库下数字误导)。
    if (d.loadDemoData()) {
      d.log.info(`演示数据载入:${d.store.getDatas(DEMO_TICKER).length} 根日K + F10,耗时 ${d.nowMs() - t0}ms`);
    }
    // 上次分析缓存恢复:有缓存 → 恢复展示(报告 Tab/最终决策/采集数据/状态 chips),
    // 不再展示 demo 占位;无缓存 → 现状 demo 上下文(loadDemoData 已无条件调用)
    const last = loadLastRun(d.store);
    if (last) {
      // 恢复展示:报告 Tab/最终决策/采集数据/状态 chips(映射集中在 applyReportBody)
      this.applyReportBody({
        ticker: last.ticker,
        stock_information: last.stock_information,
        final_decision: last.final_decision,
        opinions: last.opinions,
        // 恢复路径同步市场:lastRun ticker 即 store 键(规范化产物),反推市场 →
        // 徽标/DataScreen 单位/下拉初始值一致(手动市场时代,恢复不停留默认 cn)
        market: marketOfStoreTicker(last.ticker) ?? s.market,
      });
      s.lastRunAt = { at: last.at, mode: last.mode };
    } else {
      // 演示上下文:预载数据立即生成(采集数据 Tab 运行前有内容;真实运行后覆盖)
      const demoF10 = d.store.getMeta(DEMO_F10_KEY);
      s.stockInformation = buildStockInformation(DEMO_TICKER, {
        store: d.store,
        f10Text: demoF10,
        today: asiaToday(), // F20:北京日历日(pipeline 缺省同源;UTC 日清晨会差一天)
      });
    }
    // R-20:历史摘要载入不在启动关键路径上(PRD R4「启动零额外开销」/
    // 「启动成本不随历史增长」)——恢复完 lastRun 再后台发一次(带首次迁移),
    // 不 await。写穿异步语义同 recordRun;失败只落 historyError。
    void this.refreshHistory(true);
    this.notify();
    const loaded = d.loadSettings(); // 与面板保存同步(用户已保存的三键立即生效)
    s.settings = loaded;
    const miss = missingLlmKeys(loaded.keys);
    // F17:指向真实分节名(SettingsPanel「LLM(大模型)」/「外部服务密钥(可选)」;
    // 旧文「模型与密钥」无此节)
    if (miss.length) d.log.warn(`LLM 三键未配置——${describeLlmKeys(loaded.keys)};缺失键请见侧边栏「LLM(大模型)」/「外部服务密钥(可选)」或 app/.env 的 EXPO_PUBLIC_LLM_*`);
    else d.log.info(`LLM 已配置:${describeLlmKeys(loaded.keys)}`);
    d.log.info(`联网搜索供应商:${envValue('TAVILY_API_KEY') ? 'Tavily(优先)' : 'DuckDuckGo(免 key)'}`);
    s.dataVersion = 1; // store 为模块级对象:显式触发重渲染
    this.notify();
  }

  /** 设置面板变更:更新状态 + 持久化 + 能力开关注入。D9:错误横幅仅在非运行态
   *  清空——运行中编辑设置不再掩盖进行中/刚发生的错误。 */
  onSettingsChange(next: SettingsState): void {
    this.st.settings = next;
    this.deps.saveSettings(next);
    this.deps.applyCapabilitySwitches(next);
    if (!this.st.running) this.st.error = null;
    this.notify();
  }

  /** 分析编排(ticker 由调用方传入,market 由下拉选择):重置 → 北交所拦截 →
   *  市场归一校验 → 保活 → 采集 → intel 预查询 → 上下文组装 → runner.run。 */
  async start(ticker: string, market: Market): Promise<void> {
    // F01 重入守卫:运行中再次 start 直接返回——不清已运行状态
    // (events/decision/statuses/hasDone),不重复启保活/采集/run
    if (this.st.running) return;
    // 新一代:递增代数 + 安装本代处理器。旧代(取消/看门狗中止的孤儿运行)的
    // 事件与 settle 此后一律被代数门丢弃。
    const seq = ++this.runSeq;
    // 查看历史中发起新分析 → 先退出查看态(否则新一轮 events 会与历史正文混写)
    this.closeRun();
    this.runHandler = (e) => {
      if (seq === this.runSeq) this.handleEvent(e);
    };    this.timedOut = false;
    const d = this.deps;
    const s = this.st;
    // 新分析开始:全量重置(R4:lastRun 标记清除;hasDone 撤销——D15)
    s.events = [];
    s.finalDecision = '';
    s.stockInformation = '';
    s.error = null;
    s.partials = {};
    s.statuses = {};
    s.lastRunAt = null;
    s.hasDone = false;
    this.notify();
    const code = ticker.trim();
    // 北交所拦截(仅沪深市场;文案逐字保留既有契约——手动选港股/美股时 6 位
    // 数字归各自格式校验,不落北交所文案)
    if (market === 'cn' && /^\d{6}$/.test(code) && (code.startsWith('4') || code.startsWith('8'))) {
      s.error = '北交所(BJ)股票暂不支持分析:TDX 数据源不覆盖 BJ 证券,请使用沪深 A 股代码';
      this.notify();
      return;
    }
    // 市场归一化:按所选市场强制校验(CN 6 位原样 / HK 1-5 位 → 首候选 /
    // US 字母大写);格式不符 → 明确文案,不发起分析
    const normalized = normalizeTicker(code, market);
    if (normalized === null) {
      // 校验文案按所选市场定制(北交所文案在上一分支逐字保留,不归此处)
      const messages: Record<Market, string> = {
        cn: '请输入有效的沪深A股代码：六位数字',
        hk: '请输入有效的港股代码：一至五位数字',
        us: '请输入有效的美股代码：字母开头，可含 . 或 -',
      };
      s.error = messages[market];
      s.market = market; // CR-36:徽标与错误文案同源,不显示上一次的市场
      this.notify();
      return;
    }
    const m = normalized.market;
    let nt = normalized.ticker;
    s.market = m;
    // 能力开关经显式注入(settings 面板语义 enabled → 直映;消费点惰性读 config)
    d.applyCapabilitySwitches(s.settings);
    const modeLabel = llmConfigured(s.settings.keys) ? '真实 LLM' : '演示占位 LLM';
    this.mode = llmConfigured(s.settings.keys) ? 'real' : 'demo'; // 缓存/标记以 start() 时刻模式为准
    d.log.info(`开始分析 ${nt}(市场:${m},模式:${modeLabel})`);
    const t0 = d.nowMs();
    s.running = true;
    this.notify();
    // 看门狗早于采集启动:卡死也可能发生在 collect/intel 阶段(锁屏后 socket 静默死掉)
    this.armWatchdog();
    // 前台服务保活:分析分钟级,切后台/锁屏保持进程前台;结束在 finally 停止
    d.keepAliveStart(`正在分析 ${nt}`, 'AI 分析进行中,可切到后台等待完成');
    try {
      // web 走同源代理(绕开 CORS;绝对 URL——SDK 的 new URL 不接受相对路径);
      // Node/真机直连。代理前缀不含 /v1(SDK 自行拼接路径)
      const proxyBase = d.platform === 'web'
        ? (globalThis.location?.origin ? `${globalThis.location.origin}/llm-proxy` : undefined)
        : undefined;
      const llm = llmConfigured(s.settings.keys)
        ? d.buildLlm(toLlmConfig(s.settings.keys), proxyBase)
        : d.buildLlm(null);
      let f10Text: string | undefined;
      let snapshot: { price: number; high: number; low: number; open: number } | null = null;
      let stockName: string | null = null;
      let capital: { zongguben: number; liutongguben: number } | null = null;
      // Finnhub(仅美股增强):设置面板 key 存在 → 采集链直连 companyProfile2
      // 合并 overview.industry(失败 warn 忽略);无 key → null(零网络,不调)
      const finnhub: { apiKey: string } | null =
        m === 'us' && s.settings.keys.finnhubApiKey.trim()
          ? { apiKey: s.settings.keys.finnhubApiKey.trim() }
          : null;
      const collectKind = d.platform === 'web'
        ? (m === 'cn' ? 'TDX 代理' : 'Yahoo 代理')
        : (m === 'cn' ? 'TDX 直连' : 'Yahoo 直连');
      d.log.info(`正在采集 ${nt} 的真实行情(${collectKind})...`);
      try {
        // web 走同源代理(collectForWeb 市场分派:cn → /tdx-collect;hk/us →
        // /yahoo-collect);真机经 selectCollector/真机桥动态加载(S5:market 由
        // start() 归一化结果分派)——平台接线在 glue 层 collect 注入内
        const collected = await d.collect(nt, m, finnhub);
        // 阶段边界中止:用户已取消/已被新一轮取代 → 不再往下跑 LLM(不白烧时间和 token)
        if (seq !== this.runSeq) return;
        // S2-2(评审 2026-11-08):候选解析可能落成另一个形式(请求 9988.HK、命中
        // 09988.HK)。下面读 store / 拼上下文 / 跑 runner 必须用实际落库的 ticker,
        // 否则静默读到空行情出一份空报告。
        if (collected.ticker && collected.ticker !== nt) {
          d.log.info(`代码解析为 ${collected.ticker}(请求 ${nt})`);
          nt = collected.ticker;
        }
        f10Text = collected.f10Text ?? undefined;
        snapshot = collected.snapshot;
        stockName = collected.name;
        capital = collected.capital;
        d.log.info(`采集完成:${d.store.getDatas(nt).length} 根日K${m === 'cn' ? ' + F10' : ''}`);
        s.dataVersion += 1; // 采集数据 Tab 立即刷新
        // 采集阶段不发任何事件(TDX 逐 host 重试可能合法地跑几分钟)→ 阶段边界重置
        // 看门狗,避免把慢但健康的采集误判为死连接
        if (this.runSeq === seq) this.armWatchdog();
        this.notify();
      } catch (err) {
        const detail = describeError(err);
        d.log.error(`采集失败:${detail}`);
        s.error = `行情采集失败:${detail}`;
        this.notify();
        return;
      }
      s.lastRunTicker = nt;
      // 亿信/mcp 情报段(phase out 能力补齐):预查询一次 → 缓存闭包,供
      // buildStockInformation 与 runner.run 双算共享(不重复触发网络)
      const intel = await d.fetchIntel(nt, m, s.settings.keys);
      // 同上:取消后不再进 runner.run
      if (seq !== this.runSeq) return;
      // 同上:intel 预查询也是事件静默段
      if (this.runSeq === seq) this.armWatchdog();
      // 亿信预抓 client 注入(phaseout C1):带 key → 信息面分析师预抓三源+twitter
      // 生效;无 key → undefined(现状 DDG 回退不变)。安全:key 仅进 client 私有
      // 字段——不打印/不落日志/不经服务端代理。
      const billionsClient = d.makeBillionsClient(s.settings.keys.billionsApiKey || null);
      // 采集完成立即生成上下文(委员会真 LLM 需数分钟——不等 done 才显示;
      // runner.run 内部同源重算,结果一致,双算成本 ~ms)
      s.stockInformation = buildStockInformation(nt, {
        store: d.store,
        f10Text,
        snapshot,
        name: stockName,
        capital,
        market: m,
        today: asiaToday(), // F20:北京日历日,对齐 pipeline 缺省(原 UTC 日清晨差一天)
        ...(intel.billions ? { billions: intel.billions } : {}),
        ...(intel.mcp ? { mcp: intel.mcp } : {}),
      });
      this.notify();
      const report = await d.runner.run(nt, {
        // P1-1(评审 2026-11-09):把本代标签交给 runner，它会给本运行的每个事件
        // 回填 runTag；订阅侧据此丢弃孤儿运行的迟到事件。
        runTag: seq,
        llm, f10Text, snapshot, name: stockName, capital, market: m, today: asiaToday(), // F20 同上
        tools: d.assembleTools(s.settings.keys, s.settings.caps),
        ...(intel.billions ? { billions: intel.billions } : {}),
        ...(intel.mcp ? { mcp: intel.mcp } : {}),
        ...(billionsClient ? { billionsClient } : {}),
      });
      // C1 侧:「分析结束:耗时」仅在成功路径(resolve 出报告)打;失败路径
      // runner 已 emit error 且 resolve(undefined)(U1 契约)——不再打印误导性的
      // 成功耗时信息。
      if (report) d.log.info(`分析结束:耗时 ${((d.nowMs() - t0) / 1000).toFixed(1)}s`);
    } catch (err) {
      // 旧代(已取消/被新一轮取代)的异常不得写进当前会话
      if (seq !== this.runSeq) return;
      // C1:防御性兜底 —— runner 契约(error-handling.md「runner never throws past
      // event boundary」)失败信号唯一通道是 error 事件(单 banner),此处只接
      // runner.run 之外的意外异常(intel/client 组装等),非第二横幅来源。
      const detail = describeError(err);
      d.log.error(`分析失败:${detail}`);
      s.error = detail;
      this.notify();
    } finally {
      // 只有当前代才收尾:取消/新一轮之后,旧运行的 settle 不得停掉新一轮的
      // 保活与看门狗(那会把新一轮重新打回 cached 冻结的假死)
      if (seq === this.runSeq) {
        // finishRun 内部 try/catch 保活释放:同步异常不得让 running 卡在 true
        this.finishRun();
        this.notify();
      }
    }
  }

  // ─── runner 事件归约(与抽取前逐条等价;每事件追加 events 并广播快照)─────

  private handleEvent = (e: PipelineEvent): void => {
    const d = this.deps;
    const s = this.st;
    // 看门狗中止后只接受 done:用户已看到「已中止」,但真跑完的结果不该丢
    // (孤儿 pipeline 的 token/progress 不再写 UI)
    if (this.timedOut && e.type !== 'done') return;
    // 任何事件都算「有进展」→ 重置看门狗(节流 ≥1s,见 rearmWatchdog)
    if (s.running) this.rearmWatchdog();
    if (e.type === 'progress') {
      d.log.info(e.message);
    } else if (e.type === 'report') {
      d.log.info(`报告[${e.tabTitle}] ${e.content.length} 字符`);
      // 最终内容权威:清空该 stateKey 对应节点的流式 partial(opinion 含初稿+修订)
      // 用事件时刻的 enabledRoles() 而非挂载闭包 roles——设置面板中途启用/禁用
      // 角色后,报告清除仍按当前注册表生效
      for (const n of enabledRoles()
        .filter((r) => r.stateKey === e.key)
        .flatMap((r) => [r.nodeName, r.reviseNodeName].filter((n2): n2 is string => !!n2))) {
        delete s.partials[n];
      }
    } else if (e.type === 'token') {
      s.partials[e.node] = (s.partials[e.node] ?? '') + e.delta;
      // token 不入 events:UI 不读它(只读 partials),保存它只会让每帧快照
      // 拷贝的数组越拉越长(一次分析上万个 delta,拷贝总量 O(n²))
      this.scheduleNotify();
      return;
    } else if (e.type === 'roleStatus') {
      d.log.info(`状态[${e.node}] ${e.status}`);
      s.statuses[e.node] = e.status;
      if (e.status === 'retry') {
        // retry 复位:清空该节点已流出文本(工具轮回滚与 LLM 重试共用通道)
        s.partials[e.node] = '';
      }
    } else if (e.type === 'done') {
      const report: FinalReport = e.report;
      d.log.info(`分析完成:${report.opinions.length} 份观点,最终决策 ${report.final_decision.length} 字符`);
      s.finalDecision = report.final_decision;
      s.stockInformation = report.stock_information;
      // 上次分析缓存:仅 done(成功)写;error 不写 → 旧缓存保留(R4)
      // CR-21 + 评审 S1-1/S10-2:降级报告(收尾轮占位/空结论)不算成功 —— 不写
      // lastRun、不进历史归档、不置 hasDone。旧实现先写后判,重启与历史抽屉里会
      // 留下「✓分析完成」的空壳(LastRunRecord 无 degraded 字段,事后无法回辨)。
      const at = d.isoNow();
      if (report.degraded) {
        d.log.error('分析未产出有效最终结论(降级:不写 lastRun / 历史归档)');
        s.hasDone = false;
      } else {
        // 写盘异常(配额满/存储损坏)不得吞掉 done:否则 hasDone 与报告都不落地,
        // 用户看到的是「分析完成但没有结果」且没有任何日志
        try {
          saveLastRun(d.store, report, this.mode, at);
          s.lastRunAt = { at, mode: this.mode };
        } catch (err) {
          d.log.error(`写上次分析缓存失败:${describeError(err)}`);
        }
        // 历史归档(展示层，独立后端)：与 lastRun 并行留档
        this.recordRun(report, at);
        s.hasDone = true; // D15
        // CR-28 + 评审 S3-2:写穿透是异步的,同步读 getLastPersistError 只能看到
        // 「上一次」失败(该次写还在队列里排)。等队列排空后再读并告知用户;
        // flush 可选 —— 内存 store 不实现,直接读即可。代际门防陈旧错误写进新一轮。
        const store = d.store;
        const seqAtDone = this.runSeq;
        const reportPersistError = (): void => {
          const persistError = store.getLastPersistError?.();
          if (!persistError || this.runSeq !== seqAtDone) return;
          d.log.error(`本地落盘失败:${persistError}`);
          s.error = `本地保存失败（重启后可能丢失本次结果）：${persistError}`;
          this.notify();
        };
        if (typeof store.flush === 'function') {
          void store.flush().then(reportPersistError, () => {});
        } else {
          reportPersistError();
        }
      }
      // 看门狗已中止但真实结果仍到达:撤掉「已中止」横幅 —— 否则会同时显示
      // 「✗ 分析已 300 秒…已中止」与完成态(S5-5)。
      if (this.timedOut) {
        this.timedOut = false;
        s.error = null;
        d.log.info('看门狗中止后收到完整结果:撤销中止提示');
      }
    } else if (e.type === 'error') {
      d.log.error(e.error);
      s.error = e.error;
      // #96:error 终态清角色 chips(防「完成/分析中」残留)
      s.statuses = {};
      s.hasDone = false; // D15:error 终态撤销完成标记
    }
    s.events.push(e);
    this.notify();
  };

  private notify(): void {
    const snap = this.snapshot();
    for (const fn of [...this.listeners]) fn(snap);
  }
}
