// useAnalysis —— App 分析编排 hook(08-16-app-analysis-hook 重构)
// 自 App.tsx 搬移:分析状态(events/finalDecision/stockInformation/running/error/
// partials/statuses/dataVersion/lastRunTicker/lastRunAt/settings/modeRef)+
// 启动链 effect(storeReady → 缓存恢复/demo → loadSettings)+ runner 订阅 effect
// + start(ticker) 编排 + onSettingsChange。纯搬移,行为与重构前逐点等价;
// App.tsx 只保留 UI 状态/派生/渲染。ticker 由调用方传入(输入框在 App)。
import React from 'react';
import { Platform } from 'react-native';
import {
  applySwitchesToEnv,
  llmConfigured,
  loadSettings,
  missingLlmKeys,
  saveSettings,
  describeLlmKeys,
  toLlmConfig,
  type SettingsState,
} from '../lib/settings';
import { enabledRoles } from '../../src/committee.ts';
import { buildStockInformation } from '../../src/pipeline.ts';
import { BillionsClient } from '../../src/billionsClient.ts';
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
  type PipelineEvent,
  type FinalReport,
} from '../lib/runner';
import { describeError } from '../../src/events.ts';
import { collectForDevice, setDeviceStore } from '../../src/tdx/deviceCollect.ts';
import { startAnalysisKeepAlive, stopAnalysisKeepAlive } from '../modules/soa-keepalive';
import type { RoleStatus } from '../../src/progress.ts';
import { loadLastRun, saveLastRun } from '../../src/lastRun.ts';
import { info, warn, error as logError } from '../lib/log';

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
  settings: SettingsState;
  start: (ticker: string) => Promise<void>;
  onSettingsChange: (next: SettingsState) => void;
}

export function useAnalysis(): UseAnalysis {
  const [events, setEvents] = React.useState<PipelineEvent[]>([]);
  const [finalDecision, setFinalDecision] = React.useState('');
  const [stockInformation, setStockInformation] = React.useState('');
  const [settings, setSettings] = React.useState<SettingsState>(() => loadSettings());
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // 流式缓冲(node → partial 文本)/角色生命周期(node → status):token 追加、
  // roleStatus 写状态(retry 清 partial)、report 清 partial(最终内容权威)
  const [partials, setPartials] = React.useState<Record<string, string>>({});
  const [statuses, setStatuses] = React.useState<Record<string, RoleStatus>>({});
  const [dataVersion, setDataVersion] = React.useState(0);
  // 最近一次成功分析/采集的 ticker(采集数据 Tab 的数据源;默认 demo 票)
  const [lastRunTicker, setLastRunTicker] = React.useState('600036');
  // 上次分析运行模式(real|demo):subscribe effect 闭包持初始 settings 会陈旧,
  // 用 ref 在 start() 计算 mode 处同步,写缓存与标记时以 start() 时刻为准
  const modeRef = React.useRef<'real' | 'demo'>('demo');
  // 上次分析结果标记(完成时间 + 运行模式;start() 清除,分析中不显示)
  const [lastRunAt, setLastRunAt] = React.useState<{ at: string; mode: 'real' | 'demo' } | null>(null);

  React.useEffect(() => {
    info(`应用启动:TS 版投资委员会(web)`);
    const t0 = Date.now();
    (async () => {
      // 持久化后端就绪(IndexedDB 打开 + 内存 hydrate / 文件读回)后再加载——
      // freshness 门(同日跳过)需读跨会话 lastDataUpdate/report_date
      try {
        await storeReady();
      } catch (err) {
        const msg = describeError(err);
        logError(`存储就绪失败:${msg}`);
        setError(msg);
        return;
      }
      setDeviceStore(store); // RN 真机采集注入;web 不使用
      loadDemoData(); // 仅空库时载入 demo(有跨会话持久化数据则跳过)
      const bars = store.getDatas('600036');
      info(`演示数据载入:${bars.length} 根日K + F10,耗时 ${Date.now() - t0}ms`);
      // 上次分析缓存恢复:有缓存 → 恢复展示(报告 Tab/最终决策/采集数据/状态
      // chips),不再展示 demo 占位;无缓存 → 现状 demo 上下文(loadDemoData
      // 已无条件调用,空库守卫不变)
      const last = loadLastRun(store);
      if (last) {
        setLastRunTicker(last.ticker);
        setStockInformation(last.stock_information);
        setFinalDecision(last.final_decision);
        setEvents(last.opinions.map((o) => ({ type: 'report', key: o.key, tabTitle: o.tabTitle, content: o.content })));
        // 状态 chips:缓存命中角色置"完成"(reviseNodeName 存在取修订节点,
        // 与现渲染逻辑一致);缓存未覆盖的启用角色保持"待运行"
        const st: Record<string, RoleStatus> = {};
        for (const o of last.opinions) {
          const r = enabledRoles().find((x) => x.stateKey === o.key);
          if (!r) continue;
          if (r.reviseNodeName) st[r.reviseNodeName] = 'done';
          st[r.nodeName] = 'done';
        }
        // 经理报告只进 final_decision 字段(不在 opinions)——非空即视为已完成,
        // 与活运行 roleStatus 置 done 的 chips 语义一致
        const manager = enabledRoles().find((r) => r.kind === 'manager');
        if (manager && last.final_decision.trim()) st[manager.nodeName] = 'done';
        setStatuses(st);
        setLastRunAt({ at: last.at, mode: last.mode });
      } else {
        // 演示上下文:预载数据立即生成(采集数据 Tab 运行前有内容;真实运行后覆盖)
        const demoF10 = store.getMeta('demo:f10');
        setStockInformation(
          buildStockInformation('600036', { store, f10Text: demoF10, today: new Date().toISOString().slice(0, 10) }),
        );
      }
      const loaded = loadSettings(); // 与面板保存同步(用户已保存的三键立即生效)
      setSettings(loaded);
      const miss = missingLlmKeys(loaded.keys);
      if (miss.length) warn(`LLM 三键未配置——${describeLlmKeys(loaded.keys)};缺失键请见侧边栏「模型与密钥」或 app/.env 的 EXPO_PUBLIC_LLM_*`);
      else info(`LLM 已配置:${describeLlmKeys(loaded.keys)}`);
      info(`联网搜索供应商:${process.env.TAVILY_API_KEY ? 'Tavily(优先)' : 'DuckDuckGo(免 key)'}`);
      setDataVersion(1); // store 为模块级对象:显式触发重渲染
    })();
  }, []);

  React.useEffect(() => {
    const off = runner.subscribe((e) => {
      if (e.type === 'progress') info(e.message);
      else if (e.type === 'report') {
        info(`报告[${e.tabTitle}] ${e.content.length} 字符`);
        // 最终内容权威:清空该 stateKey 对应节点的流式 partial(opinion 含初稿+修订)
        // 用事件时刻的 enabledRoles() 而非挂载闭包 roles——设置面板中途启用/禁用
        // 角色后,报告清除仍按当前注册表生效
        setPartials((prev) => {
          const nodes = enabledRoles().filter((r) => r.stateKey === e.key).flatMap((r) =>
            [r.nodeName, r.reviseNodeName].filter((n): n is string => !!n),
          );
          if (!nodes.length) return prev;
          const next = { ...prev };
          for (const n of nodes) delete next[n];
          return next;
        });
      } else if (e.type === 'token') {
        setPartials((prev) => ({ ...prev, [e.node]: (prev[e.node] ?? '') + e.delta }));
      } else if (e.type === 'roleStatus') {
        info(`状态[${e.node}] ${e.status}`);
        setStatuses((prev) => ({ ...prev, [e.node]: e.status }));
        if (e.status === 'retry') {
          // retry 复位:清空该节点已流出文本(工具轮回滚与 LLM 重试共用通道)
          setPartials((prev) => ({ ...prev, [e.node]: '' }));
        }
      } else if (e.type === 'done') {
        const report = (e as Extract<PipelineEvent, { type: 'done' }>).report as FinalReport;
        info(`分析完成:${report.opinions.length} 份观点,最终决策 ${report.final_decision.length} 字符`);
        setFinalDecision(report.final_decision);
        setStockInformation(report.stock_information);
        // 上次分析缓存:仅 done(成功)写;error 不写 → 旧缓存保留(R4)
        const at = new Date().toISOString();
        saveLastRun(store, report, modeRef.current, at);
        setLastRunAt({ at, mode: modeRef.current });
      } else if (e.type === 'error') {
        logError(e.error);
        setError(e.error);
      }
      setEvents((prev) => [...prev, e]);
    });
    return off;
  }, []);

  function onSettingsChange(next: SettingsState): void {
    setSettings(next);
    saveSettings(next);
    applySwitchesToEnv(next.switches);
    setError(null);
  }

  async function start(ticker: string): Promise<void> {
    setEvents([]);
    setFinalDecision('');
    setStockInformation('');
    setError(null);
    setPartials({});
    setStatuses({});
    setLastRunAt(null); // 新分析开始:清除上次结果标记(R4)
    const code = ticker.trim();
    // 对齐 Python:六位数字校验 + BJ 拦截
    if (!/^\d{6}$/.test(code)) {
      setError('请输入有效的六位数字股票代码');
      return;
    }
    if (code.startsWith('4') || code.startsWith('8')) {
      setError('北交所(BJ)股票暂不支持分析:TDX 数据源不覆盖 BJ 证券,请使用沪深 A 股代码');
      return;
    }
    applySwitchesToEnv(settings.switches);
    // 联网搜索开关由设置面板 applySwitchesToEnv 控制(settings.ts 已写
    // WEB_SEARCH_DISABLED);浏览器经 /web-search 同源代理有可用搜索源
    // (defaultSearcher 浏览器分支自动走代理,交易员工具与分析师预抓共用)
    const mode = llmConfigured(settings.keys) ? '真实 LLM' : '演示占位 LLM';
    modeRef.current = llmConfigured(settings.keys) ? 'real' : 'demo'; // 缓存/标记以 start() 时刻模式为准
    info(`开始分析 ${code}(模式:${mode})`);
    const t0 = Date.now();
    setRunning(true);
    // 前台服务保活:分析分钟级,切后台/锁屏时保持进程前台(豁免 Doze 冻结与
    // 内存回收),JS 分析链继续执行;结束在 finally 停止(soa-keepalive 模块,
    // Android 前台服务 + 常驻通知)
    startAnalysisKeepAlive(`正在分析 ${code}`, 'AI 分析进行中,可切到后台等待完成');
    try {
      // web 走同源代理(绕开 CORS;绝对 URL——SDK 的 new URL 不接受相对路径);
      // Node/真机直连
      // 代理前缀不含 /v1(SDK 自行拼接路径;真实 base 已含 /v1,避免双重 /v1)
      const proxyBase = Platform.OS === 'web'
        ? `${globalThis.location.origin}/llm-proxy`
        : undefined;
      const llm = llmConfigured(settings.keys)
        ? buildLlm(toLlmConfig(settings.keys), proxyBase)
        : buildLlm(null);
      // web:先经 /tdx-collect 代理采集真实行情(浏览器无 TCP,代理在 Node 跑);
      // 失败 → 明确报错并中止,绝不以空数据喂 LLM(修复 002027 无数据问题)
      let f10Text: string | undefined;
      let snapshot: { price: number; high: number; low: number; open: number } | null = null;
      let stockName: string | null = null;
      let capital: { zongguben: number; liutongguben: number } | null = null;
      if (Platform.OS === 'web') {
        info(`正在采集 ${code} 的真实行情(TDX 代理)...`);
        try {
          const collected = await collectForWeb(code);
          f10Text = collected.f10Text ?? undefined;
          snapshot = collected.snapshot;
          stockName = collected.name;
          capital = collected.capital;
          info(`采集完成:${store.getDatas(code).length} 根日K + F10`);
          setDataVersion((v) => v + 1); // 采集数据 Tab 立即刷新
        } catch (err) {
          const detail = describeError(err);
          logError(`采集失败:${detail}`);
          setError(`行情采集失败:${detail}`);
          return;
        }
      } else {
        // 真机:TDX TCP 直连(node-tdx-market 经 RN TCP shim)
        info(`正在采集 ${code} 的真实行情(TDX 直连)...`);
        try {
          const collected = await collectForDevice(code);
          f10Text = collected.f10Text ?? undefined;
          snapshot = collected.snapshot;
          stockName = collected.name;
          capital = collected.capital;
          info(`采集完成:${store.getDatas(code).length} 根日K + F10`);
          setDataVersion((v) => v + 1); // 采集数据 Tab 立即刷新
        } catch (err) {
          const detail = describeError(err);
          logError(`采集失败:${detail}`);
          setError(`行情采集失败:${detail}`);
          return;
        }
      }
      setLastRunTicker(code);
      // 亿信/mcp 情报段（phase out 能力补齐）：预查询一次 → 缓存闭包，供
      // buildStockInformation 与 runner.run 双算共享（不重复触发 120s 网络）。
      const [billions, mcp] = await Promise.all([
        makeBillionsIntel(code, settings.keys.billionsApiKey),
        makeMcpIntel(code, settings.keys.tdxApiKey),
      ]);
      // 亿信预抓 client 注入（phaseout C1）：web 端 key 在 localStorage ——
      // 带 key → 分析师预抓三源+twitter 生效；无 key → undefined（现状 DDG
      // 回退不变）。安全：key 仅进 client 私有字段——不打印/不落日志/不经
      // 服务端代理（浏览器端直连现状）。
      const billionsClient = settings.keys.billionsApiKey
        ? new BillionsClient({ apiKey: settings.keys.billionsApiKey })
        : undefined;
      // 采集完成立即生成上下文(委员会真 LLM 需数分钟——不等 done 才显示;
      // runner.run 内部同源重算,结果一致,双算成本 ~ms)
      setStockInformation(
        buildStockInformation(code, {
          store,
          f10Text,
          snapshot,
          name: stockName,
          capital,
          today: new Date().toISOString().slice(0, 10),
          ...(billions ? { billions } : {}),
          ...(mcp ? { mcp } : {}),
        }),
      );
      await runner.run(code, {
        llm, f10Text, snapshot, name: stockName, capital, today: new Date().toISOString().slice(0, 10),
        tools: assembleTools(settings.keys, settings.caps),
        ...(billions ? { billions } : {}),
        ...(mcp ? { mcp } : {}),
        ...(billionsClient ? { billionsClient } : {}),
      });
      info(`分析结束:耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } catch (err) {
      const detail = describeError(err);
      logError(`分析失败:${detail}`);
      setError(detail);
    } finally {
      stopAnalysisKeepAlive();
      setRunning(false);
    }
  }

  return {
    events,
    finalDecision,
    stockInformation,
    running,
    error,
    partials,
    statuses,
    dataVersion,
    lastRunTicker,
    lastRunAt,
    settings,
    start,
    onSettingsChange,
  };
}
