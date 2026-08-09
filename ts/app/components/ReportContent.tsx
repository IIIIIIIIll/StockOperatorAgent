// 报告内容 —— 按角色 key 渲染(观点 expander / 非观点平铺 / 最终结论)
// 由 App 的主 Tab 条驱动,对齐 Python report_tabs 渲染 dispatch。
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme, type Theme } from '../theme';
import type { PipelineEvent } from '../lib/runner';

interface Props {
  roleKey: string; // stateKey(final_decision / bullish_opinions / ...)
  opinion: boolean; // 观点 key → expander
  tabTitle: string;
  reports: Array<{ key: string; content: string }>; // 已过滤该 key 的报告事件
  finalDecision: string;
}

export default function ReportContent({ roleKey, opinion, tabTitle, reports, finalDecision }: Props) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [expanded, setExpanded] = React.useState<Record<number, boolean>>({});

  if (roleKey === 'final_decision') {
    return (
      <ScrollView style={styles.container}>
        {finalDecision ? (
          <View style={styles.finalCard}>
            <Text style={styles.finalBody}>{finalDecision}</Text>
          </View>
        ) : (
          <Text style={styles.muted}>分析完成后此处显示最终投资决策。</Text>
        )}
      </ScrollView>
    );
  }

  if (reports.length === 0) {
    return (
      <ScrollView style={styles.container}>
        <Text style={styles.muted}>{tabTitle}报告尚未产生{opinion ? '(对抗修订后同 key 含初稿与修订版,可展开)' : ''}。</Text>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container}>
      {opinion
        ? // 观点 key → 每份一个 expander(初稿 + 修订版平铺)
          reports.map((e, i) => {
            const open = expanded[i] ?? false;
            return (
              <View key={i} style={styles.opinionCard}>
                <Pressable onPress={() => setExpanded((s) => ({ ...s, [i]: !open }))}>
                  <Text style={styles.opinionTitle}>{i === 0 ? '初稿' : '对抗修订'} {open ? '▾' : '▸'}</Text>
                </Pressable>
                {open ? <Text style={styles.opinionBody}>{e.content}</Text> : null}
              </View>
            );
          })
        : // 非观点 → 平铺
          reports.map((e, i) => (
            <View key={i} style={styles.opinionCard}>
              <Text style={styles.opinionBody}>{e.content}</Text>
            </View>
          ))}
    </ScrollView>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    container: { flex: 1, padding: theme.spacing.md },
    opinionCard: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.md, marginBottom: theme.spacing.sm, borderWidth: 1, borderColor: theme.colors.border },
    opinionTitle: { fontSize: 13, fontWeight: '600', color: theme.colors.primary },
    opinionBody: { fontSize: 13, lineHeight: 20, color: theme.colors.text, marginTop: 6 },
    finalCard: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.primary },
    finalBody: { fontSize: 14, lineHeight: 22, color: theme.colors.text },
    muted: { color: theme.colors.textSecondary, fontSize: 13 },
  });
}
