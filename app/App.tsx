// 根组件 —— 布局对齐 Python display.write_ui:
// 标题 → ticker 表单(首页最显眼)→ 主 Tab 条([采集数据] + 角色报告)
// → 内容区;设置四节放侧边栏(宽屏固定 / 窄屏按钮切换)。
import React from 'react';
import { Platform, Pressable, ScrollView, StatusBar as RNStatusBar, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import ReportContent from './components/ReportContent';
import DataScreen from './screens/DataScreen';
import SettingsPanel from './screens/SettingsPanel';
import { THEME_HEADING, useTheme, type Theme } from './theme';import {
  applySwitchesToEnv,
  llmConfigured,
  loadSettings,
  missingLlmKeys,
  saveSettings,
  describeLlmKeys,
  toLlmConfig,
  type SettingsState,
} from './lib/settings';
import { enabledRoles, reportRoles } from '../src/committee.ts';
import { buildStockInformation } from '../src/pipeline.ts';
import { BillionsClient } from '../src/billionsClient.ts';
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
} from './lib/runner';
import { describeError } from '../src/events.ts';
import { collectForDevice, setDeviceStore } from '../src/tdx/deviceCollect.ts';
import { startAnalysisKeepAlive, stopAnalysisKeepAlive } from './modules/soa-keepalive';
import type { RoleStatus } from '../src/progress.ts';
import { loadLastRun, saveLastRun } from '../src/lastRun.ts';
import { info, warn, error as logError } from './lib/log';

type TabId = 'data' | string; // 'data' 或角色 stateKey

export default function App() {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const [activeTab, setActiveTab] = React.useState<TabId>('data');
  const [events, setEvents] = React.useState<PipelineEvent[]>([]);
  const [finalDecision, setFinalDecision] = React.useState('');
  const [stockInformation, setStockInformation] = React.useState('');
  const [ticker, setTicker] = React.useState('600036');
  const [settings, setSettings] = React.useState<SettingsState>(() => loadSettings());
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // 流式缓冲(node → partial 文本)/角色生命周期(node → status):token 追加、
  // roleStatus 写状态(retry 清 partial)、report 清 partial(最终内容权威)
  const [partials, setPartials] = React.useState<Record<string, string>>({});
  const [statuses, setStatuses] = React.useState<Record<string, RoleStatus>>({});
  // 侧边栏默认收起:页面只有 ☰ 汉堡按钮,点击才展开(抽屉语义)
  const [showSettings, setShowSettings] = React.useState(false);
  React.useEffect(() => {
    if (width < 900) setShowSettings(false);
  }, [width]);
  const [dataVersion, setDataVersion] = React.useState(0);
  // 最近一次成功分析/采集的 ticker(采集数据 Tab 的数据源;默认 demo 票)
  const [lastRunTicker, setLastRunTicker] = React.useState('600036');
  // 上次分析运行模式(real|demo):subscribe effect 闭包持初始 settings 会陈旧,
  // 用 ref 在 start() 计算 mode 处同步,写缓存与标记时以 start() 时刻为准
  const modeRef = React.useRef<'real' | 'demo'>('demo');
  // 上次分析结果标记(完成时间 + 运行模式;start() 清除,分析中不显示)
  const [lastRunAt, setLastRunAt] = React.useState<{ at: string; mode: 'real' | 'demo' } | null>(null);

  const roles = reportRoles(); // (stateKey, tabTitle) —— report_tabs() 契约

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

  const missing = missingLlmKeys(settings.keys);
  const gateNotice = missing.length
    ? `未配置 LLM 三键(${missing.join('/')})—— 将使用演示占位报告;在侧边栏「模型与密钥」填写后保存。`
    : null;

  async function start(): Promise<void> {
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

  // 主 Tab 列表:[采集数据] + 角色报告(与 Python tabs = [DATA_TAB_TITLE] + report_tabs() 同序)
  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'data', label: '采集数据' },
    ...roles.map((r) => ({ id: r.stateKey!, label: r.tabTitle! })),
  ];

  const activeReports = events.filter(
    (e): e is Extract<PipelineEvent, { type: 'report' }> => e.type === 'report' && e.key === activeTab,
  );
  const activeRole = roles.find((r) => r.stateKey === activeTab);
  const progress = events.filter((e): e is Extract<PipelineEvent, { type: 'progress' }> => e.type === 'progress');

  // 调试/自动化钩子(headless 验证用;不参与正常交互)
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as unknown as Record<string, unknown>).__soa = {
        start: () => void start(),
        switchTab: (id: TabId) => setActiveTab(id),
        getState: () => ({ finalDecision, eventCount: events.length, running, partials, statuses }),
      };
    }
  });

  return (
    <View style={styles.root}>
      <StatusBar style="auto" />
      {/* 标题行:☰ 汉堡按钮(抽屉开关)+ 标题 */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Pressable style={styles.hamburger} onPress={() => setShowSettings((v) => !v)} hitSlop={8} accessibilityLabel="切换设置侧边栏">
            <Text style={styles.hamburgerIcon}>☰</Text>
          </Pressable>
          <Text style={styles.heading}>{THEME_HEADING}</Text>
        </View>
      </View>

      {/* ticker 表单(首页最显眼,对齐 Python 主区表单) */}
      <View style={styles.form}>
        <Text style={styles.formLabel}>输入您想要分析的沪深A股六位股票代码</Text>
        <View style={styles.formRow}>
          <TextInput
            style={styles.tickerInput}
            value={ticker}
            onChangeText={setTicker}
            placeholder="600036"
            maxLength={6}
            autoCapitalize="none"
            keyboardType="number-pad"
          />
          <Pressable style={[styles.startButton, running && styles.buttonDisabled]} disabled={running} onPress={() => void start()}>
            <Text style={styles.startButtonText}>{running ? '分析中…' : '开始分析'}</Text>
          </Pressable>
        </View>
        {gateNotice ? <Text style={styles.warn}>⚠ {gateNotice}</Text> : null}
        {lastRunAt && !running ? (
          <Text style={styles.info}>
            已显示上次分析结果 · {new Date(lastRunAt.at).toLocaleString()} · {lastRunAt.mode === 'real' ? '真实 LLM' : '演示模式'}
          </Text>
        ) : null}
        {error ? <Text style={styles.error}>✗ {error}</Text> : null}

      </View>

      {/* 主体:侧边栏设置(左侧抽屉)+ 内容区 */}
      <View style={styles.main}>
        {showSettings ? (
          <View style={styles.sidebar}>
            <View style={styles.sidebarHeader}>
              <Text style={styles.sidebarTitle}>设置</Text>
              <Pressable onPress={() => setShowSettings(false)} hitSlop={8} accessibilityLabel="关闭设置侧边栏">
                <Text style={styles.sidebarClose}>✕</Text>
              </Pressable>
            </View>
            <SettingsPanel onSettingsChange={onSettingsChange} />
          </View>
        ) : null}
        <View style={styles.contentColumn}>
          {/* 主 Tab 条(采集数据 + 角色报告) */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar}>
            {tabs.map((t) => {
              const active = t.id === activeTab;
              return (
                <Pressable key={t.id} style={[styles.tab, active && styles.tabActive]} onPress={() => setActiveTab(t.id)}>
                  <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* 角色状态条:每启用角色一 chip(待运行/分析中/完成/重试中);
              信息面分析师未启用 → 不在 roles 中,自然不渲染 */}
          <View style={styles.statusBar}>
            {roles.map((r) => {
              const st = r.reviseNodeName && statuses[r.reviseNodeName]
                ? statuses[r.reviseNodeName] // opinion 角色取修订节点(最新阶段)
                : statuses[r.nodeName];
              const label = st === 'running' ? '分析中' : st === 'done' ? '完成' : st === 'retry' ? '重试中' : '待运行';
              const color = st === 'done' ? theme.colors.ok : st === 'retry' ? theme.colors.warn : st === 'running' ? theme.colors.primary : theme.colors.textSecondary;
              return (
                <View key={r.nodeName} style={[styles.statusChip, { borderColor: color }]}>
                  <Text style={[styles.statusChipText, { color }]}>{r.tabTitle} · {label}</Text>
                </View>
              );
            })}
          </View>

          {/* 进度区(所有 Tab 可见;替换语义,对齐 Python updatable_container) */}
          {progress.length > 0 ? (
            <View style={styles.progressBar}>
              {running ? (
                <Text style={styles.progressLatest}>⏳ {progress[progress.length - 1].message}</Text>
              ) : (
                <Text style={styles.progressLine}>✓ 分析完成({progress.length} 步)</Text>
              )}
            </View>
          ) : null}

          {/* 内容 */}
          <View style={styles.content}>
            {activeTab === 'data' ? (
              <DataScreen stockInformation={stockInformation} dataVersion={dataVersion} ticker={lastRunTicker} />
            ) : activeRole ? (
              <ReportContent
                roleKey={activeRole.stateKey!}
                opinion={activeRole.opinion === true}
                tabTitle={activeRole.tabTitle!}
                reports={activeReports.map((e) => ({ key: e.key, content: e.content }))}
                finalDecision={finalDecision}
                partials={partials}
                statuses={statuses}
                nodeName={activeRole.nodeName}
                reviseNodeName={activeRole.reviseNodeName}
              />
            ) : null}
          </View>
        </View>

      </View>
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    header: { paddingHorizontal: theme.spacing.lg, paddingTop: (RNStatusBar.currentHeight ?? 0) + theme.spacing.lg, paddingBottom: theme.spacing.sm, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
    headerRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
    hamburger: { paddingVertical: 2, paddingRight: 2 },
    hamburgerIcon: { fontSize: 22, color: theme.colors.text, lineHeight: 24 },
    heading: { fontSize: 24, fontWeight: '800', color: theme.colors.primary, letterSpacing: 0.5 },
    form: { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.colors.border, backgroundColor: theme.colors.surface },
    formLabel: { fontSize: 13, color: theme.colors.text, marginBottom: theme.spacing.sm },
    formRow: { flexDirection: 'row', gap: theme.spacing.sm },
    tickerInput: { flex: 1, backgroundColor: theme.colors.background, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.sm, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: theme.colors.text, maxWidth: 220 },
    startButton: { backgroundColor: theme.colors.primary, borderRadius: theme.radius.sm, paddingHorizontal: 24, justifyContent: 'center' },
    startButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
    buttonDisabled: { opacity: 0.5 },
    warn: { color: theme.colors.warn, fontSize: 12, marginTop: theme.spacing.sm },
    info: { color: theme.colors.textSecondary, fontSize: 12, marginTop: theme.spacing.sm },
    error: { color: theme.colors.error, fontSize: 12, marginTop: theme.spacing.sm },
    sidebarTab: { width: 44, alignItems: 'center', justifyContent: 'center', borderLeftWidth: 1, borderLeftColor: theme.colors.border, backgroundColor: theme.colors.surface },
    sidebarTabIcon: { fontSize: 18, color: theme.colors.primary },
    sidebarTabText: { fontSize: 11, color: theme.colors.textSecondary, marginTop: 2 },
    main: { flex: 1, flexDirection: 'row' },
    contentColumn: { flex: 1 },
    tabBar: { flexGrow: 0, backgroundColor: theme.colors.background, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
    statusBar: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.xs, borderBottomWidth: 1, borderBottomColor: theme.colors.border, backgroundColor: theme.colors.surface },
    statusChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2 },
    statusChipText: { fontSize: 11, fontWeight: '600' },
    tab: { paddingHorizontal: 16, paddingVertical: 10 },
    tabActive: { borderBottomWidth: 2, borderBottomColor: theme.colors.primary },
    tabText: { fontSize: 14, color: theme.colors.textSecondary },
    tabTextActive: { color: theme.colors.primary, fontWeight: '700' },
    progressBar: { paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.xs, borderBottomWidth: 1, borderBottomColor: theme.colors.border, backgroundColor: theme.colors.surface },
    running: { color: theme.colors.warn, fontWeight: '700', marginBottom: 2, fontSize: 12 },
    progressLine: { fontSize: 11, color: theme.colors.textSecondary, marginRight: 14 },
    progressLatest: { color: theme.colors.primary, fontWeight: '600' },
    content: { flex: 1 },
    sidebar: { width: 320, borderLeftWidth: 1, borderLeftColor: theme.colors.border, backgroundColor: theme.colors.surface },
    sidebarHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
    sidebarTitle: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
    sidebarClose: { fontSize: 16, color: theme.colors.textSecondary, paddingHorizontal: 4 },
  });
}
