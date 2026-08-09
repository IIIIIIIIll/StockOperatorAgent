// 报告 Tab:进度流 + 各角色报告(观点 expander)+ 最终报告
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { PipelineEvent } from '../lib/runner';

interface Props {
  events: PipelineEvent[];
  finalDecision: string;
  running: boolean;
}

export default function ReportScreen({ events, finalDecision, running }: Props) {
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const reports = events.filter((e): e is Extract<PipelineEvent, { type: 'report' }> => e.type === 'report');
  const progress = events.filter((e): e is Extract<PipelineEvent, { type: 'progress' }> => e.type === 'progress');

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>投资委员会报告</Text>

      {running ? <Text style={styles.running}>分析进行中…</Text> : null}

      {progress.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>进度</Text>
          {progress.map((e, i) => (
            <Text key={i} style={styles.progressLine}>· {e.message}</Text>
          ))}
        </View>
      ) : null}

      {reports.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>角色观点({reports.length})</Text>
          {reports.map((e, i) => {
            const open = expanded[i] ?? false;
            return (
              <View key={i} style={styles.opinionCard}>
                <Pressable onPress={() => setExpanded((s) => ({ ...s, [i]: !open }))}>
                  <Text style={styles.opinionTitle}>
                    {e.tabTitle} {open ? '▾' : '▸'}
                  </Text>
                </Pressable>
                {open ? <Text style={styles.opinionBody}>{e.content}</Text> : null}
              </View>
            );
          })}
        </View>
      ) : null}

      {finalDecision ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>最终投资决策</Text>
          <View style={styles.finalCard}>
            <Text style={styles.finalBody}>{finalDecision}</Text>
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f7f7f7', padding: 12 },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 8 },
  running: { color: '#b8860b', marginBottom: 8, fontWeight: '600' },
  section: { marginBottom: 14 },
  sectionTitle: { fontSize: 15, fontWeight: '600', marginBottom: 6, color: '#333' },
  progressLine: { fontSize: 12, color: '#666', marginBottom: 2 },
  opinionCard: { backgroundColor: '#fff', borderRadius: 8, padding: 10, marginBottom: 6, borderWidth: 1, borderColor: '#e5e5e5' },
  opinionTitle: { fontSize: 14, fontWeight: '600', color: '#1a5fb4' },
  opinionBody: { fontSize: 12, color: '#222', marginTop: 6, lineHeight: 18 },
  finalCard: { backgroundColor: '#eef4ff', borderRadius: 8, padding: 12, borderWidth: 1, borderColor: '#c8d8f0' },
  finalBody: { fontSize: 13, lineHeight: 20, color: '#111' },
});
