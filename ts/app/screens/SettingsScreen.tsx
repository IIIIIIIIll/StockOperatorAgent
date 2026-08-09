// 设置 Tab:LLM 三键 + ticker + 开始分析(门控:缺三键 → 演示模式提示)
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { LlmConfig } from '../../src/llm.ts';

interface Props {
  ticker: string;
  setTicker: (t: string) => void;
  cfg: LlmConfig | null;
  setCfg: (c: LlmConfig) => void;
  onStart: () => void;
  running: boolean;
  error: string | null;
}

export default function SettingsScreen({ ticker, setTicker, cfg, setCfg, onStart, running, error }: Props) {
  const [apiKey, setApiKey] = React.useState(cfg?.apiKey ?? '');
  const [model, setModel] = React.useState(cfg?.model ?? '');
  const [baseUrl, setBaseUrl] = React.useState(cfg?.baseUrl ?? '');
  const hasKeys = !!(apiKey.trim() && model.trim() && baseUrl.trim());

  function save(): void {
    if (!hasKeys) return;
    const next: LlmConfig = { apiKey: apiKey.trim(), model: model.trim(), baseUrl: baseUrl.trim() };
    setCfg(next);
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>设置</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>LLM(OpenAI 兼容,三键必填)</Text>
        <Text style={styles.muted}>三键齐 → 真实分析;缺任一 → 演示占位报告(门控对齐 Python)。</Text>
        <Text style={styles.label}>API Key</Text>
        <TextInput style={styles.input} value={apiKey} onChangeText={setApiKey} placeholder="sk-..." autoCapitalize="none" />
        <Text style={styles.label}>模型</Text>
        <TextInput style={styles.input} value={model} onChangeText={setModel} placeholder="deepseek-v4-flash" autoCapitalize="none" />
        <Text style={styles.label}>Base URL</Text>
        <TextInput style={styles.input} value={baseUrl} onChangeText={setBaseUrl} placeholder="https://api.example.com/v1" autoCapitalize="none" autoCorrect={false} />
        <Pressable
          style={[styles.button, !hasKeys && styles.buttonDisabled]}
          disabled={!hasKeys}
          onPress={save}
        >
          <Text style={styles.buttonText}>保存配置</Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>分析</Text>
        <Text style={styles.label}>股票代码</Text>
        <TextInput style={styles.input} value={ticker} onChangeText={setTicker} placeholder="600036" autoCapitalize="none" />
        <Pressable style={[styles.button, styles.buttonPrimary, running && styles.buttonDisabled]} disabled={running} onPress={onStart}>
          <Text style={styles.buttonText}>{running ? '分析中…' : '开始分析'}</Text>
        </Pressable>
        {!hasKeys ? <Text style={styles.warn}>⚠ 未配置 LLM 三键 —— 将使用演示占位报告(数据为 600036 示例)。</Text> : null}
        {hasKeys ? <Text style={styles.ok}>✓ 三键已填 —— 将调用真实 LLM。需保存后生效。</Text> : null}
        {error ? <Text style={styles.error}>✗ {error}</Text> : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f7f7f7', padding: 12 },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 10 },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 15, fontWeight: '600', marginBottom: 6, color: '#333' },
  muted: { fontSize: 12, color: '#888', marginBottom: 8 },
  label: { fontSize: 12, color: '#555', marginTop: 8, marginBottom: 3 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14 },
  button: { backgroundColor: '#ddd', borderRadius: 8, paddingVertical: 10, alignItems: 'center', marginTop: 12 },
  buttonPrimary: { backgroundColor: '#1a5fb4' },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  warn: { color: '#b8860b', fontSize: 12, marginTop: 8 },
  ok: { color: '#1a8f3d', fontSize: 12, marginTop: 8 },
  error: { color: '#d33', fontSize: 12, marginTop: 8 },
});
