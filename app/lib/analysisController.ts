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
import { enabledRoles } from '../../src/committee.ts';
import { buildStockInformation } from '../../src/pipeline.ts';
import { asiaToday } from '../../src/gates.ts';
import type { WebCollectResult } from '../../src/webCollect.ts';
import { loadLastRun, saveLastRun } from '../../src/lastRun.ts';
import { DEMO_F10_KEY, DEMO_TICKER } from '../../src/metaKeys.ts';
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
  type SwitchState,
} from './settings.ts';

/** 平台形态:web → 同源代理(/llm-proxy、采集代理);native(RN 真机/桌面壳)→ 设备链直连。 */
export type ControllerPlatform = 'web' | 'native';

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
}

/** 注入依赖面:生产由 useAnalysis 接线(app/lib/runner + settings + keepalive +
 *  src/log),测试以假实现替换。全部必填,无默认实现。 */
export interface AnalysisDeps {
  /** 持久化后端(与 runner 同实例;lastRun 读写/demo 数据查询共用)。 */
  readonly store: StoreLike;
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
  readonly applyCapabilitySwitches: (switches: SwitchState) => void;
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
}

export class AnalysisController {
  private readonly deps: AnalysisDeps;
  private readonly st: MutableState;
  private readonly listeners = new Set<(s: AnalysisSnapshot) => void>();
  // 上次分析运行模式(real|demo):done 写缓存/标记时以 start() 时刻模式为准
  private mode: 'real' | 'demo' = 'demo';

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
    };
    // runner 订阅随控制器生命周期存在(构造即订阅;根 hook 常驻不卸载,与抽取前
    // 「mount effect 订阅/unmount 退订」对外可观察行为一致)。UI 侧快照监听走
    // subscribe()(挂载 effect 建立,卸载退订)。
    deps.runner.subscribe(this.handleEvent);
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
    };
  }

  /** 启动链:storeReady → (native 设备注入)→ demo 载入 → lastRun 恢复/演示上下文
   *  → 设置加载 → dataVersion=1。时序与抽取前逐点等价;storeReady 挂起期间
   *  start() 已启动时,恢复段整体跳过(N-2,start() 优先)。 */
  async bootstrap(): Promise<void> {
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
    if (s.running) return;
    // 仅空库时载入 demo(有跨会话持久化数据则跳过);日志只在真正写入时打
    // (旧实现无论是否载入都打,真实库下数字误导)。
    if (d.loadDemoData()) {
      d.log.info(`演示数据载入:${d.store.getDatas(DEMO_TICKER).length} 根日K + F10,耗时 ${d.nowMs() - t0}ms`);
    }
    // 上次分析缓存恢复:有缓存 → 恢复展示(报告 Tab/最终决策/采集数据/状态 chips),
    // 不再展示 demo 占位;无缓存 → 现状 demo 上下文(loadDemoData 已无条件调用)
    const last = loadLastRun(d.store);
    if (last) {
      s.lastRunTicker = last.ticker;
      s.stockInformation = last.stock_information;
      s.finalDecision = last.final_decision;
      s.events = last.opinions.map((o) => ({ type: 'report' as const, key: o.key, tabTitle: o.tabTitle, content: o.content }));
      // 状态 chips:缓存命中角色置「完成」(reviseNodeName 存在取修订节点);
      // 缓存未覆盖的启用角色保持「待运行」
      const sts: Record<string, RoleStatus> = {};
      for (const o of last.opinions) {
        const r = enabledRoles().find((x) => x.stateKey === o.key);
        if (!r) continue;
        if (r.reviseNodeName) sts[r.reviseNodeName] = 'done';
        sts[r.nodeName] = 'done';
      }
      // 经理报告只进 final_decision 字段(不在 opinions)——非空即视为已完成,
      // 与活运行 roleStatus 置 done 的 chips 语义一致
      const manager = enabledRoles().find((r) => r.kind === 'manager');
      if (manager && last.final_decision.trim()) sts[manager.nodeName] = 'done';
      // D15:恢复路径同步完成标记(与经理 chip 同款条件:final_decision 非空才算
      // 完成会话)。App 进度区另有 progress.length>0 外门,恢复态只有 report 型
      // 事件——当前无 UI 效果,此处为状态一致性(hasDone=存在已完成结果)。
      s.hasDone = Boolean(last.final_decision.trim());
      s.statuses = sts;
      s.lastRunAt = { at: last.at, mode: last.mode };
      // 恢复路径同步市场:lastRun ticker 即 store 键(规范化产物),反推市场 →
      // 徽标/DataScreen 单位/下拉初始值一致(手动市场时代,恢复不停留默认 cn)
      const m = marketOfStoreTicker(last.ticker);
      if (m) s.market = m;
    } else {
      // 演示上下文:预载数据立即生成(采集数据 Tab 运行前有内容;真实运行后覆盖)
      const demoF10 = d.store.getMeta(DEMO_F10_KEY);
      s.stockInformation = buildStockInformation(DEMO_TICKER, {
        store: d.store,
        f10Text: demoF10,
        today: asiaToday(), // F20:北京日历日(pipeline 缺省同源;UTC 日清晨会差一天)
      });
    }
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
    this.deps.applyCapabilitySwitches(next.switches);
    if (!this.st.running) this.st.error = null;
    this.notify();
  }

  /** 分析编排(ticker 由调用方传入,market 由下拉选择):重置 → 北交所拦截 →
   *  市场归一校验 → 保活 → 采集 → intel 预查询 → 上下文组装 → runner.run。 */
  async start(ticker: string, market: Market): Promise<void> {
    // F01 重入守卫:运行中再次 start 直接返回——不清已运行状态
    // (events/decision/statuses/hasDone),不重复启保活/采集/run
    if (this.st.running) return;
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
      this.notify();
      return;
    }
    const { market: m, ticker: nt } = normalized;
    s.market = m;
    // 能力开关经显式注入(settings 面板语义 enabled → 直映;消费点惰性读 config)
    d.applyCapabilitySwitches(s.settings.switches);
    const modeLabel = llmConfigured(s.settings.keys) ? '真实 LLM' : '演示占位 LLM';
    this.mode = llmConfigured(s.settings.keys) ? 'real' : 'demo'; // 缓存/标记以 start() 时刻模式为准
    d.log.info(`开始分析 ${nt}(市场:${m},模式:${modeLabel})`);
    const t0 = d.nowMs();
    s.running = true;
    this.notify();
    // 前台服务保活:分析分钟级,切后台/锁屏保持进程前台;结束在 finally 停止
    d.keepAliveStart(`正在分析 ${nt}`, 'AI 分析进行中,可切到后台等待完成');
    try {
      // web 走同源代理(绕开 CORS;绝对 URL——SDK 的 new URL 不接受相对路径);
      // Node/真机直连。代理前缀不含 /v1(SDK 自行拼接路径)
      const proxyBase = d.platform === 'web'
        ? `${globalThis.location.origin}/llm-proxy`
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
        f10Text = collected.f10Text ?? undefined;
        snapshot = collected.snapshot;
        stockName = collected.name;
        capital = collected.capital;
        d.log.info(`采集完成:${d.store.getDatas(nt).length} 根日K${m === 'cn' ? ' + F10' : ''}`);
        s.dataVersion += 1; // 采集数据 Tab 立即刷新
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
      // C1:防御性兜底 —— runner 契约(error-handling.md「runner never throws past
      // event boundary」)失败信号唯一通道是 error 事件(单 banner),此处只接
      // runner.run 之外的意外异常(intel/client 组装等),非第二横幅来源。
      const detail = describeError(err);
      d.log.error(`分析失败:${detail}`);
      s.error = detail;
      this.notify();
    } finally {
      d.stopKeepAlive();
      s.running = false;
      this.notify();
    }
  }

  // ─── runner 事件归约(与抽取前逐条等价;每事件追加 events 并广播快照)─────

  private handleEvent = (e: PipelineEvent): void => {
    const d = this.deps;
    const s = this.st;
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
      const at = d.isoNow();
      saveLastRun(d.store, report, this.mode, at);
      s.lastRunAt = { at, mode: this.mode };
      s.hasDone = true; // D15
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
