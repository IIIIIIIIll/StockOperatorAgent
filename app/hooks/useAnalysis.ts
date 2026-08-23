// useAnalysis —— App 分析编排 hook(React 状态桥接层)
// 编排核心自本文件抽出至 app/lib/analysisController.ts(E1 可测化:runner/store/
// 设置读写/采集/intel/keepalive/log/clock 经依赖注入,控制器由假 runner + 内存
// store 直测)。本文件只剩:控制器实例化(deps 接线)+ 快照订阅(挂载 effect)
// + start/onSettingsChange 转发。对外契约不变 —— UseAnalysis 字段与抽取前逐一
// 对应,新增 hasDone(D15;App 侧 U16 消费)。ticker 由调用方传入(输入框在 App)。
import React from 'react';
import { Platform } from 'react-native';
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
} from '../lib/runner';
import { selectCollector } from '../lib/collectorSelection';
import { info, warn, error as logError } from '../../src/log.ts';
import { AnalysisController, type AnalysisSnapshot } from '../lib/analysisController';

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
  start: (ticker: string, market: Market) => Promise<void>;
  onSettingsChange: (next: SettingsState) => void;
}

export function useAnalysis(): UseAnalysis {
  // 控制器随 hook 实例常驻(首渲染构造一次;构造内 loadSettings 与抽取前
  // useState 初始化同时序,启动链 bootstrap 在挂载 effect 再加载一次——同原)。
  const ctrl = React.useMemo(
    () =>
      new AnalysisController({
        store,
        runner,
        platform: Platform.OS === 'web' ? 'web' : 'native',
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
          if (Platform.OS === 'web') return (await selectCollector('web', m, webImpls))(ticker);
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
        makeBillionsClient: (apiKey) => (apiKey ? new BillionsClient({ apiKey }) : undefined),
        assembleTools: (keys, caps) => assembleTools(keys, caps),
        keepAliveStart: startAnalysisKeepAlive,
        stopKeepAlive: stopAnalysisKeepAlive,
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

  const start = React.useCallback(
    (ticker: string, market: Market) => ctrl.start(ticker, market),
    [ctrl],
  );
  const onSettingsChange = React.useCallback(
    (next: SettingsState) => ctrl.onSettingsChange(next),
    [ctrl],
  );

  return { ...snap, start, onSettingsChange };
}
