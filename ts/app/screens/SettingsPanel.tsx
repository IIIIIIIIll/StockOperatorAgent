// 设置面板 —— 对齐 Python display.py 四节:
// 1. 模型与密钥(持久化) 2. LangSmith(持久化) 3. 能力开关(会话级,8 个)
// 4. 亿信调用上限(会话级,3 个)。持久化 localStorage;开关分析前应用。
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import {
  defaultSettings,
  loadSettings,
  saveSettings,
  type SettingsState,
} from '../lib/settings';
import { useTheme, type Theme } from '../theme';

interface Props {
  onSettingsChange: (s: SettingsState) => void;
}

const SWITCH_ROWS: Array<{ key: keyof SettingsState['switches']; label: string; group: 'master' | 'capability' }> = [
  { key: 'tdxMcp', label: '通达信 MCP(实时市场情报)', group: 'master' },
  { key: 'webSearch', label: '联网搜索(DDG 免 key/Tavily 优先)', group: 'master' },
  { key: 'billionsMaster', label: '亿信总闸', group: 'master' },
  { key: 'findb', label: '亿信 · 金融问数(FINDB)', group: 'capability' },
  { key: 'search', label: '亿信 · 搜索(SEARCH)', group: 'capability' },
  { key: 'twitter', label: '亿信 · 社交平台(TWITTER)', group: 'capability' },
  { key: 'fetch', label: '亿信 · 数据抓取(FETCH)', group: 'capability' },
  { key: 'analyst', label: '亿信 · 信息面分析师(ANALYST)', group: 'capability' },
];

const CAP_ROWS: Array<{ key: keyof SettingsState['caps']; label: string }> = [
  { key: 'searchMax', label: '亿信搜索(SEARCH)调用上限' },
  { key: 'twitterMax', label: '亿信社交(TWITTER)调用上限' },
  { key: 'fetchMax', label: '亿信抓取(FETCH)调用上限' },
];

export default function SettingsPanel({ onSettingsChange }: Props) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [settings, setSettings] = React.useState<SettingsState>(() => loadSettings());

  function update(patch: Partial<SettingsState>): void {
    const next = { ...settings, ...patch };
    setSettings(next);
    onSettingsChange(next);
  }

  function updateSwitch(key: keyof SettingsState['switches'], value: boolean): void {
    update({ switches: { ...settings.switches, [key]: value } });
  }

  function updateCap(key: keyof SettingsState['caps'], value: number): void {
    update({ caps: { ...settings.caps, [key]: value } });
  }

  function updateKey(key: keyof SettingsState['keys'], value: string | boolean): void {
    update({ keys: { ...settings.keys, [key]: value } });
  }

  const billionsGreyed = !settings.keys.billionsApiKey.trim() || !settings.switches.billionsMaster;

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>设置</Text>

      {/* 1. 模型与密钥(持久化) */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>模型与密钥(持久化)</Text>
        <Text style={styles.muted}>保存后写入本地配置,重启保留。</Text>
        <Text style={styles.label}>LLM 模型</Text>
        <TextInput style={styles.input} value={settings.keys.llmModel} onChangeText={(v) => updateKey('llmModel', v)} placeholder="deepseek-v4-flash" autoCapitalize="none" />
        <Text style={styles.label}>LLM Base URL</Text>
        <TextInput style={styles.input} value={settings.keys.llmBaseUrl} onChangeText={(v) => updateKey('llmBaseUrl', v)} placeholder="https://api.example.com/v1" autoCapitalize="none" autoCorrect={false} />
        <Text style={styles.label}>LLM API Key</Text>
        <TextInput style={styles.input} value={settings.keys.llmApiKey} onChangeText={(v) => updateKey('llmApiKey', v)} placeholder="sk-...(三键之一)" autoCapitalize="none" secureTextEntry />
        <Text style={styles.label}>通达信 TDX API Key(可选)</Text>
        <TextInput style={styles.input} value={settings.keys.tdxApiKey} onChangeText={(v) => updateKey('tdxApiKey', v)} placeholder="未配置" autoCapitalize="none" secureTextEntry />
        <Text style={styles.label}>亿信 API Key(可选)</Text>
        <TextInput style={styles.input} value={settings.keys.billionsApiKey} onChangeText={(v) => updateKey('billionsApiKey', v)} placeholder="未配置" autoCapitalize="none" secureTextEntry />
      </View>

      {/* 2. LangSmith(持久化) */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>LangSmith(持久化)</Text>
        <Text style={styles.muted}>开发者遥测配置;TS 侧未接入,仅持久化。</Text>
        <View style={styles.toggleRow}>
          <Text style={styles.label}>启用 LangSmith 追踪</Text>
          <Switch value={settings.keys.langsmithTracing} onValueChange={(v) => updateKey('langsmithTracing', v)} />
        </View>
        <Text style={styles.label}>LangSmith API Key</Text>
        <TextInput style={styles.input} value={settings.keys.langsmithKey} onChangeText={(v) => updateKey('langsmithKey', v)} placeholder="留空表示不修改" autoCapitalize="none" secureTextEntry />
        <Text style={styles.label}>LangSmith 项目名</Text>
        <TextInput style={styles.input} value={settings.keys.langsmithProject} onChangeText={(v) => updateKey('langsmithProject', v)} placeholder="soa-ts" autoCapitalize="none" />
        <Pressable style={[styles.button, styles.buttonSecondary]} onPress={() => saveSettings(settings)}>
          <Text style={styles.buttonText}>保存配置</Text>
        </Pressable>
      </View>

      {/* 3. 能力开关(会话级) */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>能力开关(会话级)</Text>
        <Text style={styles.muted}>下次分析生效;重新加载后恢复默认。</Text>
        {!settings.keys.billionsApiKey.trim() ? <Text style={styles.warn}>未配置亿信 API Key —— 亿信能力不可用,能力开关置灰。</Text> : null}
        {settings.keys.billionsApiKey.trim() && !settings.switches.billionsMaster ? <Text style={styles.warn}>亿信总闸已关 —— 能力开关置灰。</Text> : null}
        {SWITCH_ROWS.map((row) => {
          const disabled = row.group === 'capability' && billionsGreyed;
          return (
            <View key={row.key} style={[styles.toggleRow, disabled && styles.rowDisabled]}>
              <Text style={[styles.label, { flex: 1 }]}>{row.label}</Text>
              <Switch value={settings.switches[row.key]} onValueChange={(v) => updateSwitch(row.key, v)} disabled={disabled} />
            </View>
          );
        })}
      </View>

      {/* 4. 亿信调用上限(会话级) */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>亿信调用上限(会话级)</Text>
        <Text style={styles.muted}>单次分析内工具调用上限;重新加载后恢复默认。</Text>
        {CAP_ROWS.map((row) => (
          <View key={row.key} style={styles.capRow}>
            <Text style={[styles.label, { flex: 1 }]}>{row.label}</Text>
            <TextInput
              style={[styles.input, { width: 72, textAlign: 'center' }]}
              value={String(settings.caps[row.key])}
              keyboardType="numeric"
              onChangeText={(v) => {
                const n = Math.max(0, Math.floor(Number(v)));
                if (Number.isFinite(n)) updateCap(row.key, n);
              }}
            />
          </View>
        ))}
      </View>

    </ScrollView>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background, padding: theme.spacing.md },
    title: { fontSize: 20, fontWeight: '700', color: theme.colors.text, marginBottom: theme.spacing.md },
    section: { marginBottom: theme.spacing.lg },
    sectionTitle: { fontSize: 15, fontWeight: '600', color: theme.colors.text, marginBottom: theme.spacing.xs },
    muted: { fontSize: 11, color: theme.colors.textSecondary, marginBottom: theme.spacing.sm },
    label: { fontSize: 12, color: theme.colors.textSecondary, marginTop: theme.spacing.sm, marginBottom: 3 },
    input: { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.sm, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: theme.colors.text },
    button: { borderRadius: theme.radius.sm, paddingVertical: 10, alignItems: 'center', marginTop: theme.spacing.md },
    buttonSecondary: { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
    buttonPrimary: { backgroundColor: theme.colors.primary },
    buttonDisabled: { opacity: 0.5 },
    buttonText: { color: theme.colors.text, fontWeight: '600', fontSize: 14 },
    toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
    rowDisabled: { opacity: 0.4 },
    capRow: { flexDirection: 'row', alignItems: 'center', marginTop: theme.spacing.sm },
    warn: { color: theme.colors.warn, fontSize: 12, marginTop: theme.spacing.sm },
    error: { color: theme.colors.error, fontSize: 12, marginTop: theme.spacing.sm },
  });
}
