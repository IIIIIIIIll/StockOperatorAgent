// 根组件 —— 布局对齐 Python display.write_ui:
// 标题 → ticker 表单(首页最显眼)→ 主 Tab 条([采集数据] + 角色报告)
// → 内容区;设置四节放侧边栏(宽屏固定 / 窄屏按钮切换)。
// 分析编排(状态/启动链/订阅/start)在 app/hooks/useAnalysis.ts(08-16 重构),
// 本组件只保留 UI 状态(activeTab/ticker/showSettings)、派生与渲染。
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';
import ReportContent from './components/ReportContent';
import DataScreen from './screens/DataScreen';
import SettingsPanel from './screens/SettingsPanel';
import { THEME_HEADING, useTheme, type Theme } from './theme';
import { missingLlmKeys } from './lib/settings';
import { reportRoles } from '../src/committee.ts';
import { DEMO_TICKER } from '../src/metaKeys.ts';
import { marketInfo } from '../src/market.ts';
import { useAnalysis } from './hooks/useAnalysis';
import type { PipelineEvent } from './lib/runner';

type TabId = 'data' | string; // 'data' 或角色 stateKey

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(theme, insets);
  const { width } = useWindowDimensions();
  const [activeTab, setActiveTab] = React.useState<TabId>('data');
  const [ticker, setTicker] = React.useState(DEMO_TICKER);
  // 侧边栏默认收起:页面只有 ☰ 汉堡按钮,点击才展开(抽屉语义)
  const [showSettings, setShowSettings] = React.useState(false);
  React.useEffect(() => {
    if (width < 900) setShowSettings(false);
  }, [width]);

  const a = useAnalysis();
  const roles = reportRoles(); // (stateKey, tabTitle) —— report_tabs() 契约

  const missing = missingLlmKeys(a.settings.keys);
  const gateNotice = missing.length
    ? `未配置 LLM 三键(${missing.join('/')})—— 将使用演示占位报告;在侧边栏「模型与密钥」填写后保存。`
    : null;

  // 主 Tab 列表:[采集数据] + 角色报告(与 Python tabs = [DATA_TAB_TITLE] + report_tabs() 同序)
  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'data', label: '采集数据' },
    ...roles.map((r) => ({ id: r.stateKey!, label: r.tabTitle! })),
  ];

  const activeReports = a.events.filter(
    (e): e is Extract<PipelineEvent, { type: 'report' }> => e.type === 'report' && e.key === activeTab,
  );
  const activeRole = roles.find((r) => r.stateKey === activeTab);
  const progress = a.events.filter((e): e is Extract<PipelineEvent, { type: 'progress' }> => e.type === 'progress');

  // 调试/自动化钩子(headless 验证用;不参与正常交互)
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as unknown as Record<string, unknown>).__soa = {
        start: () => void a.start(ticker),
        switchTab: (id: TabId) => setActiveTab(id),
        getState: () => ({ finalDecision: a.finalDecision, eventCount: a.events.length, running: a.running, partials: a.partials, statuses: a.statuses }),
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

      {/* ticker 表单(首页最显眼,对齐 Python 主区表单;S5 三市场输入) */}
      <View style={styles.form}>
        <Text style={styles.formLabel}>输入股票代码（沪深A股 / 港股 / 美股）</Text>
        <View style={styles.formRow}>
          <TextInput
            style={styles.tickerInput}
            value={ticker}
            onChangeText={setTicker}
            placeholder={`${DEMO_TICKER} / 00700 / AAPL`}
            maxLength={10}
            autoCapitalize="characters"
          />
          <Pressable style={[styles.startButton, a.running && styles.buttonDisabled]} disabled={a.running} onPress={() => void a.start(ticker)}>
            <Text style={styles.startButtonText}>{a.running ? '分析中…' : '开始分析'}</Text>
          </Pressable>
        </View>
        {/* 市场徽标(S5):start() 归一化后 market 已知;有结果/错误/上次分析时展示 */}
        {a.lastRunAt || a.error || a.stockInformation ? (
          <View style={styles.marketBadgeRow}>
            <Text style={styles.marketBadge}>{marketInfo(a.market).label}</Text>
          </View>
        ) : null}
        {gateNotice ? <Text style={styles.warn}>⚠ {gateNotice}</Text> : null}
        {a.lastRunAt && !a.running ? (
          <Text style={styles.info}>
            已显示上次分析结果 · {new Date(a.lastRunAt.at).toLocaleString()} · {a.lastRunAt.mode === 'real' ? '真实 LLM' : '演示模式'}
          </Text>
        ) : null}
        {a.error ? <Text style={styles.error}>✗ {a.error}</Text> : null}

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
            <SettingsPanel onSettingsChange={a.onSettingsChange} />
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
              const st = r.reviseNodeName && a.statuses[r.reviseNodeName]
                ? a.statuses[r.reviseNodeName] // opinion 角色取修订节点(最新阶段)
                : a.statuses[r.nodeName];
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
              {a.running ? (
                <Text style={styles.progressLatest}>⏳ {progress[progress.length - 1].message}</Text>
              ) : (
                <Text style={styles.progressLine}>✓ 分析完成({progress.length} 步)</Text>
              )}
            </View>
          ) : null}

          {/* 内容 */}
          <View style={styles.content}>
            {activeTab === 'data' ? (
              <DataScreen stockInformation={a.stockInformation} dataVersion={a.dataVersion} ticker={a.lastRunTicker} market={a.market} />
            ) : activeRole ? (
              <ReportContent
                roleKey={activeRole.stateKey!}
                opinion={activeRole.opinion === true}
                tabTitle={activeRole.tabTitle!}
                reports={activeReports.map((e) => ({ key: e.key, content: e.content }))}
                finalDecision={a.finalDecision}
                partials={a.partials}
                statuses={a.statuses}
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

function makeStyles(theme: Theme, insets: EdgeInsets) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    header: { paddingHorizontal: theme.spacing.lg, paddingTop: insets.top + theme.spacing.lg, paddingBottom: theme.spacing.sm, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
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
    marketBadgeRow: { flexDirection: 'row', marginTop: theme.spacing.sm },
    marketBadge: { alignSelf: 'flex-start', backgroundColor: theme.colors.primary, color: '#fff', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2, fontSize: 11, fontWeight: '700', overflow: 'hidden' },
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
