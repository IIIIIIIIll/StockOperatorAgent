// 根组件 —— 对齐 Python display.write_ui:
// 标题 + 主题(亮/暗)+ LLM 三键门控拦截 + 六位代码校验 + 三主 Tab
// (报告/采集数据/设置)+ 能力开关应用(分析前写 process.env)。
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import ReportScreen from './screens/ReportScreen';
import DataScreen from './screens/DataScreen';
import SettingsScreen from './screens/SettingsScreen';
import { THEME_HEADING, useTheme } from './theme';
import {
  applySwitchesToEnv,
  defaultSettings,
  llmConfigured,
  missingLlmKeys,
  saveSettings,
  toLlmConfig,
  type SettingsState,
} from './lib/settings';
import {
  buildLlm,
  loadDemoData,
  runner,
  store,
  type PipelineEvent,
  type FinalReport,
} from './lib/runner';

type Tab = 'report' | 'data' | 'settings';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'report', label: '报告' },
  { id: 'data', label: '采集数据' },
  { id: 'settings', label: '设置' },
];

export default function App() {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [tab, setTab] = React.useState<Tab>('report');
  const [events, setEvents] = React.useState<PipelineEvent[]>([]);
  const [finalDecision, setFinalDecision] = React.useState('');
  const [stockInformation, setStockInformation] = React.useState('');
  const [ticker, setTicker] = React.useState('600036');
  const [settings, setSettings] = React.useState<SettingsState>(() => defaultSettings());
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    loadDemoData();
  }, []);

  React.useEffect(() => {
    const off = runner.subscribe((e) => {
      if (e.type === 'done') {
        const report = (e as Extract<PipelineEvent, { type: 'done' }>).report as FinalReport;
        setFinalDecision(report.final_decision);
        setStockInformation(report.stock_information);
      } else if (e.type === 'error') {
        setError((e as Extract<PipelineEvent, { type: 'error' }>).error);
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
    ? `未配置 LLM 三键(${missing.join('/')})—— 将使用演示占位报告;在下方「模型与密钥」填写后保存。`
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
    setRunning(true);
    try {
      const llm = llmConfigured(settings.keys) ? buildLlm(toLlmConfig(settings.keys)) : buildLlm(null);
      const f10Text = store.getMeta('demo:f10') ?? undefined;
      await runner.run(code, { llm, f10Text, today: new Date().toISOString().slice(0, 10) });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <View style={styles.root}>
      <StatusBar style="auto" />
      {/* 标题(对齐 Python st.title) */}
      <View style={styles.header}>
        <Text style={styles.heading}>{THEME_HEADING}</Text>
        <Text style={styles.subtitle}>TS 版投资委员会 · 数据链/编排层/UI 全 TS 移植</Text>
      </View>

      <View style={styles.content}>
        {tab === 'report' ? (
          <ReportScreen events={events} finalDecision={finalDecision} running={running} />
        ) : tab === 'data' ? (
          <DataScreen stockInformation={stockInformation} />
        ) : (
          <SettingsScreen
            ticker={ticker}
            setTicker={setTicker}
            onStart={() => void start()}
            running={running}
            error={error}
            gateNotice={gateNotice}
            onSettingsChange={onSettingsChange}
          />
        )}
      </View>

      <View style={styles.tabBar}>
        {TABS.map((t) => (
          <Pressable key={t.id} style={[styles.tab, tab === t.id && styles.tabActive]} onPress={() => setTab(t.id)}>
            <Text style={[styles.tabText, tab === t.id && styles.tabTextActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
      {gateNotice && (
        <View style={styles.gate}>
          <Text style={styles.gateText}>⚙ {gateNotice}(在设置中填写)</Text>
        </View>
      )}
    </View>
  );
}

function makeStyles(theme: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    header: { paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.lg, paddingBottom: theme.spacing.sm, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
    heading: { fontSize: 22, fontWeight: '800', color: theme.colors.primary, letterSpacing: 0.5 },
    subtitle: { fontSize: 11, color: theme.colors.textSecondary, marginTop: 2 },
    content: { flex: 1 },
    tabBar: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.surface },
    tab: { flex: 1, paddingVertical: 10, alignItems: 'center' },
    tabActive: { borderTopWidth: 2, borderTopColor: theme.colors.primary, backgroundColor: theme.colors.background },
    tabText: { color: theme.colors.textSecondary, fontSize: 14 },
    tabTextActive: { color: theme.colors.primary, fontWeight: '700' },
    gate: { backgroundColor: theme.colors.surface, borderTopWidth: 1, borderTopColor: theme.colors.border, paddingVertical: 5, paddingHorizontal: theme.spacing.md },
    gateText: { color: theme.colors.warn, fontSize: 11 },
  });
}
