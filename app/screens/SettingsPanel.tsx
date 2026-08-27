// 设置面板 —— 分类重排 + LLM 可达性监测 + 缺键红色禁用
// 分节:1) LLM(大模型:模型/BaseURL/Key + 保存 + 可达性)
//       2) 外部服务密钥(TDX/亿信) 3) LangSmith 4) 能力开关 5) 调用上限
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import {
  checkLlmReachability,
  loadSettings,
  missingLlmKeys,
  saveSettings,
  type ReachabilityResult,
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
  const [reach, setReach] = React.useState<ReachabilityResult | 'idle' | 'checking'>('idle');

  // 卸载守卫 + 请求序号:checkLlmReachability 完成回调落地前,若组件已卸载或
  // 已有更新的检查/配置变更,则丢弃结果,防止过期 promise 覆盖新状态。
  const mountedRef = React.useRef(true);
  const seqRef = React.useRef(0);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const missing = missingLlmKeys(settings.keys);
  const keysComplete = missing.length === 0;

  function update(patch: Partial<SettingsState>): void {
    if (!mountedRef.current) return; // 防御:卸载后不再写入
    const next = { ...settings, ...patch };
    setSettings(next);
    onSettingsChange(next);
    seqRef.current += 1; // 使进行中的检测结果过期(旧 promise 不得覆盖新状态)
    setReach('idle'); // 配置变化 → 旧检测结果失效
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

  /** 保存(仅三键齐全时可用)+ LLM 可达性监测。 */
  async function saveAndCheck(): Promise<void> {
    if (!keysComplete) return; // 缺键:按钮已禁用,双保险
    saveSettings(settings);
    const seq = ++seqRef.current; // 本次检测的请求序号(新检查/新配置会使其过期)
    setReach('checking');
    const result = await checkLlmReachability(settings.keys);
    if (!mountedRef.current || seq !== seqRef.current) return; // 已卸载或已有更新的检查 → 丢弃过期结果
    setReach(result);
  }

  const billionsGreyed = !settings.keys.billionsApiKey.trim() || !settings.switches.billionsMaster;

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>设置</Text>

      {/* ── 1. LLM(大模型)────────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>LLM(大模型)</Text>
        <Text style={styles.muted}>OpenAI 兼容;三键必填。保存时自动检测可达性。</Text>
        <Text style={styles.label}>LLM 模型</Text>
        <TextInput style={styles.input} value={settings.keys.llmModel} onChangeText={(v) => updateKey('llmModel', v)} placeholder="deepseek-v4-flash" autoCapitalize="none" />
        <Text style={styles.label}>LLM Base URL</Text>
        <TextInput style={styles.input} value={settings.keys.llmBaseUrl} onChangeText={(v) => updateKey('llmBaseUrl', v)} placeholder="https://api.example.com/v1" autoCapitalize="none" autoCorrect={false} />
        <Text style={styles.label}>LLM API Key</Text>
        <TextInput style={styles.input} value={settings.keys.llmApiKey} onChangeText={(v) => updateKey('llmApiKey', v)} placeholder="sk-..." autoCapitalize="none" secureTextEntry />

        {/* 保存按钮:缺键 → 红色禁用 + 点名;齐全 → 正常 + 可达性检测 */}
        <Pressable
          style={[styles.button, keysComplete ? styles.buttonPrimary : styles.buttonError, reach === 'checking' && styles.buttonDisabled]}
          disabled={!keysComplete || reach === 'checking'}
          onPress={() => void saveAndCheck()}
        >
          <Text style={styles.buttonText}>{reach === 'checking' ? '检测中…' : keysComplete ? '保存配置' : `缺少 ${missing.join('/')}`}</Text>
        </Pressable>
        {!keysComplete ? (
          <Text style={styles.error}>✗ 三键不齐——无法保存,LLM 不可用。缺失:{missing.join(' / ')}</Text>
        ) : null}

        {/* 可达性监测结果 */}
        {reach === 'checking' ? (
          <Text style={styles.muted}>正在检测 LLM 可达性…</Text>
        ) : reach !== 'idle' ? (
          reach.ok ? (
            <Text style={styles.ok}>✓ LLM 可达({reach.message})</Text>
          ) : (
            <Text style={styles.error}>✗ LLM 不可达:{reach.message}</Text>
          )
        ) : null}
      </View>

      {/* ── 2. 外部服务密钥(可选)──────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>外部服务密钥(可选)</Text>
        <Text style={styles.muted}>未配置时对应能力自动降级占位,不影响分析。</Text>
        <Text style={styles.label}>通达信 TDX API Key</Text>
        <TextInput style={styles.input} value={settings.keys.tdxApiKey} onChangeText={(v) => updateKey('tdxApiKey', v)} placeholder="未配置" autoCapitalize="none" secureTextEntry />
        <Text style={styles.label}>亿信 API Key</Text>
        <TextInput style={styles.input} value={settings.keys.billionsApiKey} onChangeText={(v) => updateKey('billionsApiKey', v)} placeholder="未配置" autoCapitalize="none" secureTextEntry />
        <Text style={styles.label}>Finnhub API Key（可选，美股增强）</Text>
        <TextInput style={styles.input} value={settings.keys.finnhubApiKey} onChangeText={(v) => updateKey('finnhubApiKey', v)} placeholder="未配置" autoCapitalize="none" secureTextEntry />
      </View>

      {/* ── 3. LangSmith(遥测)─────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>LangSmith(遥测)</Text>
        <Text style={styles.muted}>开发者追踪配置;TS 侧未接入,仅持久化。</Text>
        <View style={styles.toggleRow}>
          <Text style={styles.label}>启用追踪</Text>
          <Switch value={settings.keys.langsmithTracing} onValueChange={(v) => updateKey('langsmithTracing', v)} />
        </View>
        <Text style={styles.label}>API Key</Text>
        <TextInput style={styles.input} value={settings.keys.langsmithKey} onChangeText={(v) => updateKey('langsmithKey', v)} placeholder="留空表示不修改" autoCapitalize="none" secureTextEntry />
        <Text style={styles.label}>项目名</Text>
        <TextInput style={styles.input} value={settings.keys.langsmithProject} onChangeText={(v) => updateKey('langsmithProject', v)} placeholder="soa-ts" autoCapitalize="none" />
      </View>

      {/* ── 4. 能力开关(会话级)────────────────────────────────── */}
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

      {/* ── 5. 亿信调用上限(会话级)────────────────────────────── */}
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
                if (v.trim() === '') return; // 清空不提交 0(字段保持空,不闪回 "0")
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
    title: { fontSize: 18, fontWeight: '700', color: theme.colors.text, marginBottom: theme.spacing.md },
    section: { marginBottom: theme.spacing.lg, paddingBottom: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
    sectionTitle: { fontSize: 14, fontWeight: '700', color: theme.colors.primary, marginBottom: 2 },
    muted: { fontSize: 11, color: theme.colors.textSecondary, marginBottom: theme.spacing.sm },
    label: { fontSize: 12, color: theme.colors.textSecondary, marginTop: theme.spacing.sm, marginBottom: 3 },
    input: { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.sm, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: theme.colors.text },
    button: { borderRadius: theme.radius.sm, paddingVertical: 10, alignItems: 'center', marginTop: theme.spacing.md },
    buttonPrimary: { backgroundColor: theme.colors.primary },
    buttonError: { backgroundColor: theme.colors.error, opacity: 0.7 },
    buttonDisabled: { opacity: 0.5 },
    buttonText: { color: theme.colors.onPrimary, fontWeight: '600', fontSize: 14 },
    toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
    rowDisabled: { opacity: 0.4 },
    capRow: { flexDirection: 'row', alignItems: 'center', marginTop: theme.spacing.sm },
    warn: { color: theme.colors.warn, fontSize: 12, marginTop: theme.spacing.sm },
    error: { color: theme.colors.error, fontSize: 12, marginTop: theme.spacing.sm },
    ok: { color: theme.colors.ok, fontSize: 12, marginTop: theme.spacing.sm, fontWeight: '600' },
  });
}
