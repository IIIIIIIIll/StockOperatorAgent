// 报告 Tab —— 对齐 Python st.tabs 语义:角色 Tab 条(注册表 report_tabs
// 契约)+ 观点 expander(对抗修订多份平铺)+ 最终结论。
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { reportRoles, type Role } from '../../src/committee.ts';
import { useTheme, type Theme } from '../theme';
import type { PipelineEvent } from '../lib/runner';

interface Props {
  events: PipelineEvent[];
  finalDecision: string;
  running: boolean;
}

type ReportEvent = Extract<PipelineEvent, { type: 'report' }>;

export default function ReportScreen({ events, finalDecision, running }: Props) {
  const theme = useTheme();
  const roles = reportRoles(); // (stateKey, tabTitle) —— 与 Python report_tabs() 同契约
  const [activeKey, setActiveKey] = React.useState<string>('final_decision');
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});

  const reports: ReportEvent[] = events.filter((e): e is ReportEvent => e.type === 'report');
  const progress = events.filter((e): e is Extract<PipelineEvent, { type: 'progress' }> => e.type === 'progress');

  const activeRole = roles.find((r) => r.stateKey === activeKey);
  const tabReports = activeRole ? reports.filter((r) => r.key === activeRole.stateKey) : [];

  const styles = makeStyles(theme);

  return (
    <View style={styles.container}>
      {/* 进度区(运行中高亮最新一条) */}
      {progress.length > 0 && (
        <View style={styles.progressBar}>
          {running && <Text style={styles.running}>分析进行中…</Text>}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {progress.map((e, i) => (
              <Text key={i} style={[styles.progressLine, i === progress.length - 1 && running && styles.progressLatest]}>
                · {e.message}
              </Text>
            ))}
          </ScrollView>
        </View>
      )}

      {/* 角色 Tab 条(注册表驱动,与 Python st.tabs 同序) */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar}>
        {roles.map((r: Role) => {
          const key = r.stateKey!;
          const active = key === activeKey;
          return (
            <Pressable key={key} style={[styles.tab, active && styles.tabActive]} onPress={() => setActiveKey(key)}>
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{r.tabTitle}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* 选中 Tab 内容 */}
      <ScrollView style={styles.content}>
        {!activeRole ? null : activeKey === 'final_decision' ? (
          finalDecision ? (
            <View style={styles.finalCard}>
              <Text style={styles.finalBody}>{finalDecision}</Text>
            </View>
          ) : (
            <Text style={styles.muted}>分析完成后此处显示最终投资决策。</Text>
          )
        ) : tabReports.length === 0 ? (
          <Text style={styles.muted}>该角色报告尚未产生{activeRole.opinion ? '(对抗修订后同 key 含初稿与修订版,可展开)' : ''}。</Text>
        ) : activeRole.opinion ? (
          // 观点 key → 每份一个 expander(初稿 + 修订版平铺)
          tabReports.map((e, i) => {
            const open = expanded[`${activeKey}:${i}`] ?? false;
            return (
              <View key={i} style={styles.opinionCard}>
                <Pressable onPress={() => setExpanded((s) => ({ ...s, [`${activeKey}:${i}`]: !open }))}>
                  <Text style={styles.opinionTitle}>{i === 0 ? '初稿' : '对抗修订'} {open ? '▾' : '▸'}</Text>
                </Pressable>
                {open && <Text style={styles.opinionBody}>{e.content}</Text>}
              </View>
            );
          })
        ) : (
          // 非观点 → 平铺
          tabReports.map((e, i) => (
            <View key={i} style={styles.opinionCard}>
              <Text style={styles.opinionBody}>{e.content}</Text>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background },
    progressBar: { paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, borderBottomWidth: 1, borderBottomColor: theme.colors.border, backgroundColor: theme.colors.surface },
    running: { color: theme.colors.warn, fontWeight: '700', marginBottom: 4, fontSize: 13 },
    progressLine: { fontSize: 12, color: theme.colors.textSecondary, marginRight: 16 },
    progressLatest: { color: theme.colors.primary, fontWeight: '600' },
    tabBar: { flexGrow: 0, backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
    tab: { paddingHorizontal: 14, paddingVertical: 10 },
    tabActive: { borderBottomWidth: 2, borderBottomColor: theme.colors.primary },
    tabText: { fontSize: 14, color: theme.colors.textSecondary },
    tabTextActive: { color: theme.colors.primary, fontWeight: '700' },
    content: { flex: 1, padding: theme.spacing.md },
    opinionCard: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.md, marginBottom: theme.spacing.sm, borderWidth: 1, borderColor: theme.colors.border },
    opinionTitle: { fontSize: 13, fontWeight: '600', color: theme.colors.primary },
    opinionBody: { fontSize: 13, lineHeight: 20, color: theme.colors.text, marginTop: 6 },
    finalCard: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.primary },
    finalBody: { fontSize: 14, lineHeight: 22, color: theme.colors.text },
    muted: { color: theme.colors.textSecondary, fontSize: 13 },
  });
}
