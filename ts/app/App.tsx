// 根组件:三 Tab + 事件桥状态
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import ReportScreen from './screens/ReportScreen';
import DataScreen from './screens/DataScreen';
import SettingsScreen from './screens/SettingsScreen';
import {
  buildLlm,
  configError,
  loadDemoData,
  readSavedConfig,
  runner,
  saveConfig,
  store,
  type PipelineEvent,
  type FinalReport,
  type LlmConfig,
} from './lib/runner';

type Tab = 'report' | 'data' | 'settings';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'report', label: '报告' },
  { id: 'data', label: '采集数据' },
  { id: 'settings', label: '设置' },
];

export default function App() {
  const [tab, setTab] = React.useState<Tab>('report');
  const [events, setEvents] = React.useState<PipelineEvent[]>([]);
  const [finalDecision, setFinalDecision] = React.useState('');
  const [stockInformation, setStockInformation] = React.useState('');
  const [ticker, setTicker] = React.useState('600036');
  const [cfg, setCfgState] = React.useState<LlmConfig | null>(null);
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    loadDemoData();
    const saved = readSavedConfig();
    if (saved) setCfgState(saved);
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

  function setCfg(next: LlmConfig): void {
    setCfgState(next);
    saveConfig(next);
    setError(null);
  }

  async function start(): Promise<void> {
    setEvents([]);
    setFinalDecision('');
    setStockInformation('');
    setError(null);
    setRunning(true);
    try {
      const llm = buildLlm(cfg);
      const f10Text = store.getMeta('demo:f10') ?? undefined;
      await runner.run(ticker.trim() || '600036', { llm, f10Text, today: new Date().toISOString().slice(0, 10) });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  const gateNotice = cfg ? null : configError(null);

  return (
    <View style={styles.root}>
      <StatusBar style="auto" />
      <View style={styles.content}>
        {tab === 'report' ? <ReportScreen events={events} finalDecision={finalDecision} running={running} /> : null}
        {tab === 'data' ? <DataScreen stockInformation={stockInformation} /> : null}
        {tab === 'settings' ? (
          <SettingsScreen
            ticker={ticker}
            setTicker={setTicker}
            cfg={cfg}
            setCfg={setCfg}
            onStart={() => void start()}
            running={running}
            error={error}
          />
        ) : null}
      </View>
      <View style={styles.tabBar}>
        {TABS.map((t) => (
          <Pressable
            key={t.id}
            style={[styles.tab, tab === t.id && styles.tabActive]}
            onPress={() => setTab(t.id)}
          >
            <Text style={[styles.tabText, tab === t.id && styles.tabTextActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
      {gateNotice ? <Text style={styles.gate}>⚙ {gateNotice}(设置中填写)</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f7f7f7' },
  content: { flex: 1 },
  tabBar: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#ddd', backgroundColor: '#fff' },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  tabActive: { backgroundColor: '#eef4ff' },
  tabText: { color: '#666', fontSize: 14 },
  tabTextActive: { color: '#1a5fb4', fontWeight: '700' },
  gate: { backgroundColor: '#fff8e1', color: '#8a6d00', fontSize: 11, paddingVertical: 4, paddingHorizontal: 12 },
});
