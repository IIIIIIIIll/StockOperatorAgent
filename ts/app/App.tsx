// 根组件 —— 布局对齐 Python display.write_ui:
// 标题 → ticker 表单(首页最显眼)→ 主 Tab 条([采集数据] + 角色报告)
// → 内容区;设置四节放侧边栏(宽屏固定 / 窄屏按钮切换)。
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
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
  toLlmConfig,
  type SettingsState,
} from './lib/settings';
import { reportRoles } from '../src/committee.ts';
import {
  buildLlm,
  loadDemoData,
  runner,
  store,
  type PipelineEvent,
  type FinalReport,
} from './lib/runner';
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
  // 侧边栏默认收起:页面只有 ☰ 汉堡按钮,点击才展开(抽屉语义)
  const [showSettings, setShowSettings] = React.useState(false);
  React.useEffect(() => {
    if (width < 900) setShowSettings(false);
  }, [width]);
  const [dataVersion, setDataVersion] = React.useState(0);

  const roles = reportRoles(); // (stateKey, tabTitle) —— report_tabs() 契约

  React.useEffect(() => {
    info(`应用启动:TS 版投资委员会(web)`);
    const t0 = Date.now();
    loadDemoData();
    const bars = store.getDatas('600036');
    info(`演示数据载入:${bars.length} 根日K + F10,耗时 ${Date.now() - t0}ms`);
    const loaded = loadSettings(); // 与面板保存同步(用户已保存的三键立即生效)
    setSettings(loaded);
    const miss = missingLlmKeys(loaded.keys);
    if (miss.length) warn(`LLM 三键未配置(${miss.join('/')})——演示模式;配置见侧边栏「模型与密钥」`);
    else info(`LLM 已配置(${loaded.keys.llmModel},base=${loaded.keys.llmBaseUrl})`);
    info(`联网搜索供应商:${process.env.TAVILY_API_KEY ? 'Tavily(优先)' : 'DuckDuckGo(免 key)'}`);
    setDataVersion(1); // store 为模块级对象:显式触发重渲染
  }, []);

  React.useEffect(() => {
    const off = runner.subscribe((e) => {
      if (e.type === 'progress') info(e.message);
      else if (e.type === 'report') info(`报告[${e.tabTitle}] ${e.content.length} 字符`);
      else if (e.type === 'done') {
        const report = (e as Extract<PipelineEvent, { type: 'done' }>).report as FinalReport;
        info(`分析完成:${report.opinions.length} 份观点,最终决策 ${report.final_decision.length} 字符`);
        setFinalDecision(report.final_decision);
        setStockInformation(report.stock_information);
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
    const mode = llmConfigured(settings.keys) ? '真实 LLM' : '演示占位 LLM';
    info(`开始分析 ${code}(模式:${mode})`);
    const t0 = Date.now();
    setRunning(true);
    try {
      const llm = llmConfigured(settings.keys) ? buildLlm(toLlmConfig(settings.keys)) : buildLlm(null);
      const f10Text = store.getMeta('demo:f10') ?? undefined;
      await runner.run(code, { llm, f10Text, today: new Date().toISOString().slice(0, 10) });
      info(`分析结束:耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } catch (err) {
      logError(`分析失败:${err instanceof Error ? err.message : String(err)}`);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
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
        getState: () => ({ finalDecision, eventCount: events.length, running }),
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
        <Text style={styles.subtitle}>TS 版投资委员会 · 数据链/编排层/UI 全 TS 移植</Text>
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

          {/* 进度区(所有 Tab 可见) */}
          {progress.length > 0 ? (
            <View style={styles.progressBar}>
              {running ? <Text style={styles.running}>分析进行中…</Text> : null}
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {progress.map((e, i) => (
                  <Text key={i} style={[styles.progressLine, i === progress.length - 1 && running && styles.progressLatest]}>
                    · {e.message}
                  </Text>
                ))}
              </ScrollView>
            </View>
          ) : null}

          {/* 内容 */}
          <View style={styles.content}>
            {activeTab === 'data' ? (
              <DataScreen stockInformation={stockInformation} dataVersion={dataVersion} />
            ) : activeRole ? (
              <ReportContent
                roleKey={activeRole.stateKey!}
                opinion={activeRole.opinion === true}
                tabTitle={activeRole.tabTitle!}
                reports={activeReports.map((e) => ({ key: e.key, content: e.content }))}
                finalDecision={finalDecision}
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
    header: { paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.lg, paddingBottom: theme.spacing.sm, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
    headerRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
    hamburger: { paddingVertical: 2, paddingRight: 2 },
    hamburgerIcon: { fontSize: 22, color: theme.colors.text, lineHeight: 24 },
    heading: { fontSize: 24, fontWeight: '800', color: theme.colors.primary, letterSpacing: 0.5 },
    subtitle: { fontSize: 11, color: theme.colors.textSecondary, marginTop: 2 },
    form: { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.colors.border, backgroundColor: theme.colors.surface },
    formLabel: { fontSize: 13, color: theme.colors.text, marginBottom: theme.spacing.sm },
    formRow: { flexDirection: 'row', gap: theme.spacing.sm },
    tickerInput: { flex: 1, backgroundColor: theme.colors.background, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.sm, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: theme.colors.text, maxWidth: 220 },
    startButton: { backgroundColor: theme.colors.primary, borderRadius: theme.radius.sm, paddingHorizontal: 24, justifyContent: 'center' },
    startButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
    buttonDisabled: { opacity: 0.5 },
    warn: { color: theme.colors.warn, fontSize: 12, marginTop: theme.spacing.sm },
    error: { color: theme.colors.error, fontSize: 12, marginTop: theme.spacing.sm },
    sidebarTab: { width: 44, alignItems: 'center', justifyContent: 'center', borderLeftWidth: 1, borderLeftColor: theme.colors.border, backgroundColor: theme.colors.surface },
    sidebarTabIcon: { fontSize: 18, color: theme.colors.primary },
    sidebarTabText: { fontSize: 11, color: theme.colors.textSecondary, marginTop: 2 },
    main: { flex: 1, flexDirection: 'row' },
    contentColumn: { flex: 1 },
    tabBar: { flexGrow: 0, backgroundColor: theme.colors.background, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
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
