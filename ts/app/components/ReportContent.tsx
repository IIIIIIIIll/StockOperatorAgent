// 报告内容 —— 按角色 key 渲染(观点 expander / 非观点平铺 / 最终结论)
// 由 App 的主 Tab 条驱动,对齐 Python report_tabs 渲染 dispatch。
// 08-11-ts-streaming-output:打字机增量接入——每槽位 partial ?? report(最终
// 内容权威),running 且 partial 非空时尾部渲染光标「▍」;流式中的槽位默认展开。
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme, type Theme } from '../theme';
import MarkdownText from './MarkdownText';
import type { RoleStatus } from '../../src/progress.ts';

const CURSOR = '▍';

interface Props {
  roleKey: string; // stateKey(final_decision / bullish_opinions / ...)
  opinion: boolean; // 观点 key → expander
  tabTitle: string;
  reports: Array<{ key: string; content: string }>; // 已过滤该 key 的报告事件
  finalDecision: string;
  partials: Record<string, string>; // node → 流式增量缓冲
  statuses: Record<string, RoleStatus>; // node → 角色生命周期状态
  nodeName: string; // 该 tab 的初稿/主节点
  reviseNodeName?: string; // opinion 修订节点
}

/** 槽位渲染:{node} partial ?? fallback(报告);streaming(running 且 partial 非空)
 *  → 尾部光标。 */
function streamText(
  partials: Record<string, string>,
  statuses: Record<string, RoleStatus>,
  node: string,
  fallback: string | undefined,
): { text: string; streaming: boolean } {
  const partial = partials[node] ?? '';
  const streaming = statuses[node] === 'running' && partial.length > 0;
  const text = partial || fallback || '';
  return { text: streaming ? text + CURSOR : text, streaming };
}

export default function ReportContent({
  roleKey, opinion, tabTitle, reports, finalDecision, partials, statuses, nodeName, reviseNodeName,
}: Props) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [expanded, setExpanded] = React.useState<Record<number, boolean>>({});

  if (roleKey === 'final_decision') {
    const { text } = streamText(partials, statuses, nodeName, finalDecision);
    return (
      <ScrollView style={styles.container}>
        {text ? (
          <View style={styles.finalCard}>
            <MarkdownText content={text} />
          </View>
        ) : (
          <Text style={styles.muted}>分析完成后此处显示最终投资决策。</Text>
        )}
      </ScrollView>
    );
  }

  if (opinion) {
    // 观点 key → 初稿/修订两槽位(partial ?? 对应 report;report 事件按序)
    const slots = [
      { node: nodeName, title: '初稿', fallback: reports[0]?.content },
      { node: reviseNodeName ?? nodeName, title: '对抗修订', fallback: reports[1]?.content },
    ];
    const hasAny = reports.length > 0 || slots.some((s) => (partials[s.node] ?? '') !== '');
    if (!hasAny) {
      return (
        <ScrollView style={styles.container}>
          <Text style={styles.muted}>{tabTitle}报告尚未产生(对抗修订后同 key 含初稿与修订版,可展开)。</Text>
        </ScrollView>
      );
    }
    return (
      <ScrollView style={styles.container}>
        {slots.map((slot, i) => {
          const { text, streaming } = streamText(partials, statuses, slot.node, slot.fallback);
          if (!text) return null; // 槽位暂无内容(如修订尚未开始)
          const open = expanded[i] ?? streaming; // 流式中的槽位默认展开
          return (
            <View key={i} style={styles.opinionCard}>
              <Pressable onPress={() => setExpanded((s) => ({ ...s, [i]: !open }))}>
                <Text style={styles.opinionTitle}>{slot.title} {open ? '▾' : '▸'}</Text>
              </Pressable>
              {open ? <MarkdownText content={text} /> : null}
            </View>
          );
        })}
      </ScrollView>
    );
  }

  // 非观点 → 平铺:partial ?? 最新报告(最终内容权威)
  const { text } = streamText(partials, statuses, nodeName, reports[reports.length - 1]?.content);
  if (!text) {
    return (
      <ScrollView style={styles.container}>
        <Text style={styles.muted}>{tabTitle}报告尚未产生。</Text>
      </ScrollView>
    );
  }
  return (
    <ScrollView style={styles.container}>
      <View style={styles.opinionCard}>
        <MarkdownText content={text} />
      </View>
    </ScrollView>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    container: { flex: 1, padding: theme.spacing.md },
    opinionCard: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.md, marginBottom: theme.spacing.sm, borderWidth: 1, borderColor: theme.colors.border },
    opinionTitle: { fontSize: 13, fontWeight: '600', color: theme.colors.primary },
    finalCard: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.primary },
    muted: { color: theme.colors.textSecondary, fontSize: 13 },
  });
}
