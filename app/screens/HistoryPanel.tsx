// 历史分析面板 —— 左侧抽屉的二级页(☰ → 菜单 → 历史)。
// 列表按本地日分组(今天/昨天/日期,标签规则在 src/runHistory.ts 单点),
// 点一条 → 报告 Tab 内复现该次分析;「编辑」进入多选批量删除;「清空全部」需
// 行内二次确认(不弹系统对话框 —— RN web 的 Alert 多按钮行为不一致)。
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme, type Theme } from '../theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  formatRunClock,
  groupRunsByDay,
  type RunSummary,
} from '../../src/runHistory.ts';

interface Props {
  history: RunSummary[];
  loading: boolean;
  error: string | null;
  /** 正在查看的历史条目(行高亮;null = 实时结果)。 */
  viewingId: string | null;
  /** 运行中:禁止打开历史(避免事件流与历史正文混写)。 */
  running: boolean;
  onOpen: (id: string) => void;
  onDelete: (ids: string[]) => void;
  onClear: () => void;
  /** 返回上一级(抽屉菜单);不传则不渲染 ← 按钮。 */
  onBack?: () => void;
  onClose: () => void;
  onRefresh: () => void;
  /** 外部布局(窄屏覆盖式抽屉:绝对定位 top/bottom 直接落在根节点上 —— 包一层
   *  View 会让内部 ScrollView(flex:1)量到 0 高度,列表整块消失)。 */
  style?: StyleProp<ViewStyle>;
}

export default React.memo(function HistoryPanel({
  history,
  loading,
  error,
  viewingId,
  running,
  onOpen,
  onDelete,
  onClear,
  onBack,
  onClose,
  onRefresh,
  style,
}: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(theme);
  const [selectMode, setSelectMode] = React.useState(false);
  const [selected, setSelected] = React.useState<string[]>([]);
  /** 待确认的破坏性动作(行内确认条,失败可取消)。 */
  const [confirm, setConfirm] = React.useState<'delete' | 'clear' | null>(null);

  // 历史列表变化(删除/新分析)后清掉已不存在的选中项
  React.useEffect(() => {
    setSelected((prev) => prev.filter((id) => history.some((h) => h.id === id)));
  }, [history]);

  const groups = React.useMemo(() => groupRunsByDay(history), [history]);
  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const exitSelect = () => {
    setSelectMode(false);
    setSelected([]);
    setConfirm(null);
  };

  const onRowPress = (summary: RunSummary) => {
    if (selectMode) return toggle(summary.id);
    if (running) return; // 运行中不开历史(打开中会与流式事件混写)
    onOpen(summary.id);
  };

  return (
    <View style={[styles.root, style]}>
      <View style={styles.header}>
        {onBack ? (
          <Pressable onPress={onBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="返回菜单">
            <Text style={styles.iconButton}>←</Text>
          </Pressable>
        ) : null}
        <Text style={styles.title} numberOfLines={1}>历史分析</Text>
        <View style={styles.headerActions}>
          <Pressable onPress={onRefresh} hitSlop={8} accessibilityRole="button" accessibilityLabel="刷新历史">
            <Text style={[styles.iconButton, loading && styles.iconDisabled]}>↻</Text>
          </Pressable>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="关闭历史侧栏">
            <Text style={styles.iconButton}>✕</Text>
          </Pressable>
        </View>
      </View>

      {error ? <Text style={styles.error}>✗ {error}</Text> : null}
      {running ? <Text style={styles.hint}>分析进行中,结束后可查看历史。</Text> : null}

      {history.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>{loading ? '载入中…' : '还没有历史记录'}</Text>
          {!loading ? (
            <Text style={styles.emptyText}>完成一次分析后会自动保存在这里,按天分组。</Text>
          ) : null}
        </View>
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {groups.map((g) => (
            <View key={g.key}>
              <Text style={styles.groupLabel}>{g.label}</Text>
              {g.runs.map((r) => {
                const active = r.id === viewingId;
                const checked = selected.includes(r.id);
                return (
                  <View key={r.id} style={styles.rowWrap}>
                    <Pressable
                      onPress={() => onRowPress(r)}
                      style={[
                        styles.row,
                        active && styles.rowActive,
                        checked && styles.rowChecked,
                        running && !selectMode && styles.rowDisabled,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`${r.ticker} ${formatRunClock(r.at)} ${r.decisionPreview}`}
                      accessibilityState={{ selected: active }}
                    >
                      <View style={styles.rowBody}>
                        <View style={styles.rowTop}>
                          <Text style={styles.ticker}>{r.ticker}</Text>
                          <Text style={styles.time}>{formatRunClock(r.at)}</Text>
                          <Text style={[styles.modeChip, r.mode === 'demo' && styles.modeChipDemo]}>
                            {r.mode === 'real' ? '真实' : '演示'}
                          </Text>
                          {active ? <Text style={styles.viewingTag}>查看中</Text> : null}
                        </View>
                        <Text style={styles.preview} numberOfLines={1}>
                          {r.decisionPreview || '(无结论)'}
                        </Text>
                      </View>
                      {selectMode ? (
                        <Text style={[styles.check, checked && styles.checkOn]}>{checked ? '☑' : '☐'}</Text>
                      ) : (
                        <Text style={styles.chevron}>›</Text>
                      )}
                    </Pressable>
                  {
                    // R-05(PRD R6):行内单条删除 —— 单条不需要二次确认(确认只给
                    // 批量/清空全部)。放在 Pressable 外当兄弟节点,避开嵌套点击
                    // 在 RN-web 上冒泡到整行。
                    !selectMode ? (
                      <Pressable
                        onPress={() => onDelete([r.id])}
                        style={styles.rowDelete}
                        accessibilityRole="button"
                        accessibilityLabel={`删除 ${r.ticker} 这条历史`}
                        hitSlop={8}
                      >
                        <Text style={styles.rowDeleteText}>✕</Text>
                      </Pressable>
                    ) : null
                  }
                  </View>
                );
              })}
            </View>
          ))}
        </ScrollView>
      )}

      {/* 底部动作区:常态 [编辑][清空] / 多选态 [删除选中][取消] / 确认条 */}
      {history.length > 0 ? (
        <View style={[styles.footer, { paddingBottom: theme.spacing.sm + insets.bottom }]}>
          {confirm === null ? (
            <View style={styles.footerRow}>
              {selectMode ? (
                <>
                  <Pressable
                    style={[styles.action, styles.actionDanger, selected.length === 0 && styles.actionDisabled]}
                    disabled={selected.length === 0}
                    onPress={() => setConfirm('delete')}
                    accessibilityRole="button"
                  >
                    <Text style={styles.actionDangerText}>删除选中({selected.length})</Text>
                    </Pressable>
                  <Pressable style={styles.action} onPress={exitSelect} accessibilityRole="button">
                    <Text style={styles.actionText}>取消</Text>
                    </Pressable>
                </>
              ) : (
                <>
                  <Pressable style={styles.action} onPress={() => setSelectMode(true)} accessibilityRole="button">
                    <Text style={styles.actionText}>编辑</Text>
                    </Pressable>
                  <Pressable style={styles.action} onPress={() => setConfirm('clear')} accessibilityRole="button">
                    <Text style={styles.actionDangerText}>清空全部</Text>
                    </Pressable>
                </>
              )}
            </View>
          ) : (
            <View style={styles.confirmBox}>
              <Text style={styles.confirmText}>
                {confirm === 'clear'
                  ? `确认删除全部 ${history.length} 条历史?删除后不可恢复。`
                  : `确认删除已选 ${selected.length} 条历史?删除后不可恢复。`}
              </Text>
              <View style={styles.footerRow}>
                <Pressable
                  style={[styles.action, styles.actionDangerSolid]}
                  onPress={() => {
                    if (confirm === 'clear') onClear();
                    else onDelete(selected);
                    exitSelect();
                  }}
                  accessibilityRole="button"
                >
                  <Text style={styles.actionDangerSolidText}>确认删除</Text>
                </Pressable>
                <Pressable style={styles.action} onPress={() => setConfirm(null)} accessibilityRole="button">
                  <Text style={styles.actionText}>取消</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      ) : null}
    </View>
  );
});

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    // 宽度由抽屉容器决定(比例计算在 App.tsx drawerWidthFor);描边交给抽屉避免双线
    root: { flex: 1, minWidth: 0, backgroundColor: theme.colors.surface },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
    title: { flex: 1, fontSize: 15, fontWeight: '700', color: theme.colors.text },
    headerActions: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
    iconButton: { fontSize: 16, color: theme.colors.textSecondary, paddingHorizontal: 4 },
    iconDisabled: { opacity: 0.4 },
    error: { color: theme.colors.error, fontSize: 12, paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.sm },
    hint: { color: theme.colors.warn, fontSize: 12, paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.sm },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.lg },
    emptyTitle: { fontSize: 14, fontWeight: '600', color: theme.colors.text },
    emptyText: { marginTop: theme.spacing.xs, fontSize: 12, color: theme.colors.textSecondary, textAlign: 'center' },
    list: { flex: 1 },
    listContent: { paddingVertical: theme.spacing.sm },
    groupLabel: { fontSize: 11, fontWeight: '700', color: theme.colors.textSecondary, paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.sm, paddingBottom: 4 },
    row: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing.md, paddingVertical: 8, borderLeftWidth: 3, borderLeftColor: 'transparent' },
    rowWrap: { flexDirection: 'row', alignItems: 'center' },
    rowDelete: { paddingHorizontal: theme.spacing.sm, paddingVertical: 8 },
    rowDeleteText: { fontSize: 15, color: theme.colors.textSecondary },
    rowActive: { backgroundColor: theme.colors.background, borderLeftColor: theme.colors.primary },
    rowChecked: { backgroundColor: theme.colors.background },
    rowDisabled: { opacity: 0.5 },
    rowBody: { flex: 1 },
    rowTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    ticker: { fontSize: 13, fontWeight: '700', color: theme.colors.text },
    time: { fontSize: 12, color: theme.colors.textSecondary },
    modeChip: { fontSize: 10, fontWeight: '700', color: theme.colors.primary, borderWidth: 1, borderColor: theme.colors.primary, borderRadius: 999, paddingHorizontal: 5, paddingVertical: 1, overflow: 'hidden' },
    modeChipDemo: { color: theme.colors.warn, borderColor: theme.colors.warn },
    viewingTag: { fontSize: 10, color: theme.colors.primary, fontWeight: '700' },
    preview: { marginTop: 2, fontSize: 12, color: theme.colors.textSecondary },
    check: { fontSize: 16, color: theme.colors.textSecondary, paddingLeft: theme.spacing.sm },
    checkOn: { color: theme.colors.primary },
    chevron: { fontSize: 18, color: theme.colors.textSecondary, paddingLeft: theme.spacing.sm },
    footer: { borderTopWidth: 1, borderTopColor: theme.colors.border, padding: theme.spacing.sm },
    footerRow: { flexDirection: 'row', gap: theme.spacing.sm },
    action: { flex: 1, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.sm, paddingVertical: 8, alignItems: 'center', backgroundColor: theme.colors.background },
    actionText: { fontSize: 13, fontWeight: '600', color: theme.colors.text },
    actionDanger: { borderColor: theme.colors.error },
    actionDangerText: { fontSize: 13, fontWeight: '600', color: theme.colors.error },
    actionDangerSolid: { backgroundColor: theme.colors.error, borderColor: theme.colors.error },
    actionDangerSolidText: { fontSize: 13, fontWeight: '700', color: theme.colors.onPrimary },
    actionDisabled: { opacity: 0.4 },
    confirmBox: { gap: theme.spacing.sm },
    confirmText: { fontSize: 12, color: theme.colors.error },
  });
}
