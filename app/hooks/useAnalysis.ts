// useAnalysis —— App 分析编排 hook(React 状态桥接层)
// 编排核心自本文件抽出至 app/lib/analysisController.ts(E1 可测化:runner/store/
// 设置读写/采集/intel/keepalive/log/clock 经依赖注入,控制器由假 runner + 内存
// store 直测)。本文件只剩:控制器实例化(deps 接线)+ 快照订阅(挂载 effect)
// + start/onSettingsChange 转发。对外契约不变 —— UseAnalysis 字段与抽取前逐一
// 对应,新增 hasDone(D15;App 侧 U16 消费)。ticker 由调用方传入(输入框在 App)。
import React from 'react';
import { AppState } from 'react-native';
import {
  switchesToCapabilities,
  loadSettings,
  saveSettings,
  type SettingsState,
} from '../lib/settings';
import { setCapabilitySwitches } from '../../src/switches.ts';
import { BillionsClient } from '../../src/billionsClient.ts';
import type { RoleStatus } from '../../src/progress.ts';
import type { Market } from '../../src/market.ts';
import type { MarketCollector } from '../../src/collector.ts';
import type { CollectSkipOpts } from '../../src/webCollect.ts';
import { startAnalysisKeepAlive, stopAnalysisKeepAlive } from '../modules/soa-keepalive';
import type { PipelineEvent } from '../lib/runner';
import {
  assembleTools,
  buildLlm,
  collectForWeb,
  loadDemoData,
  makeBillionsIntel,
  makeMcpIntel,
  runner,
  store,
  storeReady,
  webBillionsFetch,
} from '../lib/runner';
import { selectCollector } from '../lib/collectorSelection';
import { createFileRunArchive, createIdbRunArchive } from '../lib/runArchive';
import { createGraceStopper, type GraceStopper } from '../lib/keepAliveGrace';
import { detectPlatform, info, warn, error as logError } from '../../src/log.ts';
import { AnalysisController, type ControllerPlatform, type AnalysisSnapshot, type ViewingRunMarker } from '../lib/analysisController';
import type { RunSummary } from '../../src/runHistory.ts';

// R-14/R-15:平台判定单一来源(log.ts detectPlatform:web → rn → node),不再用
// 第二个探针 Platform.OS。控制器词表与 log.ts 一致('web' | 'rn');node 兜底
// 归 rn(未用 Platform.OS 前的既有行为:非 web 一律走本机链路)。
const CONTROLLER_PLATFORM: ControllerPlatform = detectPlatform() === 'web' ? 'web' : 'rn';

export interface UseAnalysis {
  events: PipelineEvent[];
  finalDecision: string;
  stockInformation: string;
  running: boolean;
  error: string | null;
  partials: Record<string, string>;
  statuses: Record<string, RoleStatus>;
  dataVersion: number;
  lastRunTicker: string;
  lastRunAt: { at: string; mode: 'real' | 'demo' } | null;
  /** 最近一次 start() 归一化得到的市场(S5;UI 徽标/DataScreen 单位消费)。
   *  初始 cn(demo 上下文);lastRun 恢复路径按 ticker 反推市场,不落默认 cn。 */
  market: Market;
  settings: SettingsState;
  /** D15:done 事件后 true;新 start()/error 事件后 false(App「✓分析完成」消费,U16)。 */
  hasDone: boolean;
  /** 分析历史摘要列表(时间倒序;正文 openRun 按需加载)。 */
  history: RunSummary[];
  historyLoading: boolean;
  historyError: string | null;
  /** 正在查看的历史条目;null = 实时结果。 */
  viewingRun: ViewingRunMarker | null;
  start: (ticker: string, market: Market) => Promise<void>;
  /** 取消当前分析(runner promise 不打断,但状态/保活立即归位,孤儿事件被丢弃)。 */
  cancel: () => void;
  onSettingsChange: (next: SettingsState) => void;
  /** 历史抽屉:重读列表 / 打开一条 / 返回实时 / 删除 / 清空。 */
  refreshHistory: () => Promise<void>;
  openRun: (id: string) => Promise<void>;
  closeRun: () => void;
  deleteRuns: (ids: string[]) => Promise<void>;
  clearHistory: () => Promise<void>;
}

export function useAnalysis(): UseAnalysis {
  // 历史归档后端:web/桌面渲染进程(Chromium)走 IndexedDB,RN 走 expo-file-system。
  // R-17:每个 hook 实例一份(useMemo 常驻),不是模块级单例 —— 两个后端都是
  // 惰性打开/惰性 import(首次打开抽屉才发生 I/O),所以重复构造也不花钱。
  const runArchive = React.useMemo(
    () => (CONTROLLER_PLATFORM === 'web' ? createIdbRunArchive() : createFileRunArchive()),
    [],
  );
  // CR-49:90s 宽限状态机抽到 app/lib/keepAliveGrace.ts(纯 TS 可单测)。
  const stopperRef = React.useRef<GraceStopper | null>(null);
  const hardStopKeepAlive = React.useCallback(() => {
    stopperRef.current?.cancel();
    stopAnalysisKeepAlive();
  }, []);
  if (stopperRef.current === null) {
    stopperRef.current = createGraceStopper({
      isActive: () => AppState.currentState === 'active',
      hardStop: () => hardStopKeepAlive(),
    });
  }
  const stopKeepAliveDeferred = React.useCallback(() => {
    stopperRef.current?.defer();
  }, []);

  // R-35:卸载时取消 90s 宽限定时器 —— 否则组件已卸载仍可能在 90s 后触发
  // stopKeepAlive(定时器持有 ref、不随组件消失)。
  React.useEffect(
    () => () => {
      stopperRef.current?.cancel();
    },
    [],
  );

  // 控制器随 hook 实例常驻(首渲染构造一次;构造内 loadSettings 与抽取前
  // useState 初始化同时序,启动链 bootstrap 在挂载 effect 再加载一次——同原)。
  const ctrl = React.useMemo(
    () =>
      new AnalysisController({
        store,
        runArchive,
        runner,
        platform: CONTROLLER_PLATFORM,
        storeReady,
        loadDemoData,
        loadSettings,
        saveSettings,
        applyCapabilitySwitches: (sw) => setCapabilitySwitches(switchesToCapabilities(sw)),
        injectDeviceStore: async () => {
          // RN 真机采集注入(web bundle 不含 node-tdx-market 死链;动态 import
          // 保持原时序:setDeviceStore 在 start() 采集前完成)。web 不调用。
          // 动态 import 例外:平台专属模块,静态 import 会污染 web 打包。
          const { setDeviceStore } = await import('../lib/deviceBridge');
          setDeviceStore(store);
        },
        buildLlm,
        collect: async (ticker, m, finnhub) => {
          // web 走同源代理(collectForWeb 市场分派:cn → /tdx-collect;hk/us →
          // /yahoo-collect);真机经 selectCollector 动态 import(仅非 web 求值,
          // web bundle 不含 node-tdx-market 死链)。S5:market 分派 cn → TDX 链;
          // hk/us → Yahoo 链(webImpls 已绑定代理 base)。
          const webImpls: Record<Market, MarketCollector> = {
            cn: collectForWeb,
            hk: (t: string, o?: CollectSkipOpts) => collectForWeb(t, { ...(o ?? {}), market: 'hk' }),
            us: (t: string, o?: CollectSkipOpts) => collectForWeb(t, { ...(o ?? {}), market: 'us', finnhub }),
          };
          if (CONTROLLER_PLATFORM === 'web') return (await selectCollector('web', m, webImpls))(ticker);
          if (m === 'us' && finnhub) {
            // 真机 + 美股 + Finnhub key:deviceImpls 绑定面不带 finnhub 参 →
            // 直取设备桥传参(与 web 链同契约)。动态 import:deviceBridge 是
            // RN 专属模块(含 TCP 链),web bundle 不可含——Platform 门控内求值
            const { collectYahooForDevice } = await import('../lib/deviceBridge');
            return collectYahooForDevice(ticker, undefined, finnhub);
          }
          // 真机其余路径:selectCollector('rn') 市场分派(cn → TDX 直连链;
          // hk/us → Yahoo 直连链)。与抽取前三分支结构等价(web / us+finnhub
          // 直取 / else rn)。
          return (await selectCollector('rn', m, webImpls))(ticker);
        },
        fetchIntel: async (nt, m, keys) => {
          // 亿信/mcp 预查询(mcp 仅 cn:S4 契约,hk/us 块 4 恒占位不消费)
          const [billions, mcp] = await Promise.all([
            makeBillionsIntel(nt, keys.billionsApiKey),
            m === 'cn' ? makeMcpIntel(nt, keys.tdxApiKey) : Promise.resolve(undefined),
          ]);
          return { billions, mcp };
        },
        // 亿信 CORS:web 端经同源 /billions-proxy(webBillionsFetch 单点判定,
        // runner.ts);Node/RN 直连零变化。
        makeBillionsClient: (apiKey) =>
          apiKey ? new BillionsClient({ apiKey, fetch: webBillionsFetch() ?? undefined }) : undefined,
        assembleTools: (keys, caps) => assembleTools(keys, caps),
        keepAliveStart: startAnalysisKeepAlive,
        stopKeepAlive: stopKeepAliveDeferred,
        log: { info, warn, error: logError },
        nowMs: () => Date.now(),
        isoNow: () => new Date().toISOString(),
      }),
    [],
  );

  const [snap, setSnap] = React.useState<AnalysisSnapshot>(() => ctrl.snapshot());

  React.useEffect(() => {
    const off = ctrl.subscribe(setSnap);
    void ctrl.bootstrap(); // 启动链(订阅先建立,与抽取前两 effect 时序一致)
    return off;
  }, [ctrl]);

  // 前台回归:补释放推迟的保活 + 补一次广播(锁屏期间压下的合并帧)
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      if (stopperRef.current?.pending) hardStopKeepAlive();
      ctrl.refresh();
    });
    return () => sub.remove();
  }, [ctrl, hardStopKeepAlive]);

  const start = React.useCallback(
    (ticker: string, market: Market) => ctrl.start(ticker, market),
    [ctrl],
  );
  const cancel = React.useCallback(() => ctrl.cancel(), [ctrl]);
  const onSettingsChange = React.useCallback(
    (next: SettingsState) => ctrl.onSettingsChange(next),
    [ctrl],
  );
  const refreshHistory = React.useCallback(() => ctrl.refreshHistory(), [ctrl]);
  const openRun = React.useCallback((id: string) => ctrl.openRun(id), [ctrl]);
  const closeRun = React.useCallback(() => ctrl.closeRun(), [ctrl]);
  const deleteRuns = React.useCallback((ids: string[]) => ctrl.deleteRuns(ids), [ctrl]);
  const clearHistory = React.useCallback(() => ctrl.clearHistory(), [ctrl]);

  return {
    ...snap,
    start,
    cancel,
    onSettingsChange,
    refreshHistory,
    openRun,
    closeRun,
    deleteRuns,
    clearHistory,
  };
}
