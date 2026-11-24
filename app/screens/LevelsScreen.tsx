// 「决策价位」Tab —— 把《最终结论》里散落的价格数字画成一张价位阶梯图:
// 近 N 根收盘价做成背景面积,买点/目标/防守按价格钉在对应的 y 上,右侧价签
// 去重叠(stackLabelYs)。
//
// 为什么不用 lightweight-charts(与 IndicatorChart/FinancialTrendChart 不同):
// 这张图要表达的是"价位之间的相对位置",不需要 K 线/缩放/十字光标;而
// lightweight-charts 在原生端要走 WebView + tools/build-chart-view.mts 的
// JSON 契约(两套实现 + chart:check 校验)。用 RN 原生 View 定位实现:
// 一套代码 web/原生同源、零依赖、零构建期契约,渲染也更快(2026-11-22 决策)。
//
// 数据来源纪律:价位**只能**来自《最终结论》文本(src/levels.ts 抽取),背景
// 收盘价来自 store 日K。抽不到就明说抽不到(空态),绝不拿均线之类"看起来
// 像价位"的数字冒充报告结论 —— 这个 Tab 的可信度全靠这条。
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { store } from '../lib/runner';
import { extractLevels, levelDeltaPct, type LevelKind, type PriceLevel } from '../../src/levels.ts';
import { stackLabelYs } from '../../src/chartLayout.ts';
import { changePercentSeries, fmtNumber } from '../../src/pipeline.ts';
import { useTheme, type Theme } from '../theme';

/** 背景收盘价窗口(与 DataScreen 的 K 线窗口同量级,图不至于糊成一片)。 */
const PRICE_WINDOW = 60;
/** 阶梯图高度(dp):价签最小间距 15dp → 约容纳 18 个互不重叠的标签。 */
const LADDER_HEIGHT = 320;
const LABEL_GAP = 15;
const LABEL_COLUMN_WIDTH = 104;

/** 语义 → 中文名 + 主题色(颜色全部取自 theme,不新增字面量色值)。 */
function kindMeta(kind: LevelKind, theme: Theme): { label: string; color: string } {
  switch (kind) {
    case 'entry':
      return { label: '买入带', color: theme.colors.warn };
    case 'target':
      return { label: '目标', color: theme.colors.up };
    default:
      return { label: '防守', color: theme.colors.down };
  }
}

interface PlotLevel extends PriceLevel {
  /** 图内 y(px,自上而下);价签走 stackLabelYs 调整后的 y。 */
  y: number;
  labelY: number;
}

export default React.memo(function LevelsScreen({
  finalDecision, ticker, dataVersion,
}: {
  finalDecision: string;
  ticker: string;
  /** 数据就绪信号:父组件重采集后 +1,触发重读 store(与 DataScreen 同约定)。 */
  dataVersion?: number;
}) {
  const theme = useTheme();
  const styles = React.useMemo(() => makeStyles(theme), [theme]);
  const bars = React.useMemo(() => store.getDatas(ticker), [ticker, dataVersion]);
  const window = React.useMemo(() => bars.slice(-PRICE_WINDOW), [bars]);
  const closes = React.useMemo(() => window.map((b) => b.close), [window]);
  const current = closes.length ? closes[closes.length - 1] : NaN;
  const changePct = React.useMemo(() => {
    const all = changePercentSeries(window);
    return all.length ? all[all.length - 1] : NaN;
  }, [window]);
  const levels = React.useMemo(() => extractLevels(finalDecision, current), [finalDecision, current]);
  const all: PriceLevel[] = React.useMemo(
    () => [...levels.entry, ...levels.target, ...levels.stop],
    [levels],
  );
  // 图宽:onLayout 实测(抽屉开合会改宽度,不能用 window 宽度近似)
  const [plotWidth, setPlotWidth] = React.useState(0);

  // y 轴范围:收盘价与所有价位一起取(价位不越界才画得出来),上下各留 3% 余量
  const domain = React.useMemo(() => {
    const values = [...closes, ...all.map((l) => l.price)].filter((v) => Number.isFinite(v) && v > 0);
    if (!values.length) return null;
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const pad = (hi - lo) * 0.03 || hi * 0.01; // 单值(只有现价)→ 用 1% 撑开
    return { lo: lo - pad, hi: hi + pad };
  }, [closes, all]);

  const yOf = React.useCallback(
    (price: number): number => {
      if (!domain) return 0;
      const ratio = (domain.hi - price) / (domain.hi - domain.lo);
      return Math.max(0, Math.min(LADDER_HEIGHT, ratio * LADDER_HEIGHT));
    },
    [domain],
  );

  // 价位按价格降序(图上自上而下)+ 价签去重叠
  const plot: PlotLevel[] = React.useMemo(() => {
    if (!domain || !all.length) return [];
    const sorted = [...all].sort((a, b) => b.price - a.price);
    // 同价去重:**只影响图的线与价签**,不动下方明细列表 —— 2026-11-24 真机实测
    // 出现 44.16 同时是买点与目标 → 两条线完全重叠、价签印两遍。保第一项
    // (all 顺序是 entry → target → stop,即买点优先),明细区仍能看到两条。
    const seen = new Set<string>();
    const unique = sorted.filter((lv) => {
      const key = lv.price.toFixed(2);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const ys = unique.map((lv) => yOf(lv.price));
    const labelYs = stackLabelYs(ys, LABEL_GAP, LADDER_HEIGHT);
    return unique.map((lv, i) => ({ ...lv, y: ys[i], labelY: labelYs[i] }));
  }, [all, domain, yOf]);

  if (!Number.isFinite(current)) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.emptyTitle}>还没有价格数据</Text>
        <Text style={styles.emptyHint}>
          先在「采集数据」运行一次分析(或确认已完成采集),再回来看价位图。
        </Text>
      </ScrollView>
    );
  }

  const pctColor = Number.isNaN(changePct) ? theme.colors.textSecondary : (changePct >= 0 ? theme.colors.up : theme.colors.down);
  /** 该语义下离现价最近的那一档(抽取结果按价格升序,首项**不一定**最近:
   *  防守带升序后首项是最远的 41.01,直接取 pool[0] 会把"最近"标错)。 */
  const nearestByKind = (kind: LevelKind): PriceLevel | undefined => {
    const pool = kind === 'entry' ? levels.entry : kind === 'target' ? levels.target : levels.stop;
    return pool.reduce<PriceLevel | undefined>(
      (best, lv) => (best === undefined || Math.abs(lv.price - current) < Math.abs(best.price - current) ? lv : best),
      undefined,
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>决策价位 · {ticker}</Text>

      {/* 摘要:现价 + 涨跌幅 + 方向 + 信心度 */}
      <View style={styles.summary}>
        <View style={styles.summaryCell}>
          <Text style={styles.summaryLabel}>最新收盘</Text>
          <Text style={styles.summaryPrice}>{fmtNumber(current, 2)}</Text>
          <Text style={[styles.summaryDelta, { color: pctColor }]}>
            {Number.isNaN(changePct) ? '—' : `${changePct >= 0 ? '+' : ''}${fmtNumber(changePct, 2)}%`}
          </Text>
        </View>
        <View style={styles.summaryCell}>
          <Text style={styles.summaryLabel}>报告方向</Text>
          <Text style={styles.summaryText} numberOfLines={2}>{levels.direction ?? '未提取到'}</Text>
        </View>
        <View style={styles.summaryCell}>
          <Text style={styles.summaryLabel}>信心度</Text>
          <Text style={styles.summaryText}>{levels.confidence === null ? '未提取到' : `${levels.confidence}%`}</Text>
        </View>
      </View>

      {/* 价位阶梯图:左价格面积 + 右价签 */}
      <View style={styles.card}>
        <View style={styles.ladderHead}>
          <Text style={styles.sectionTitle}>价位分布(近 {Math.min(PRICE_WINDOW, closes.length)} 根收盘)</Text>
          <Text style={styles.sectionNote}>{all.length ? `${all.length} 个价位` : '未提取到价位'}</Text>
        </View>
        <View style={styles.ladder}>
          <View style={styles.plot} onLayout={(e) => setPlotWidth(e.nativeEvent.layout.width)} accessibilityRole="image" accessibilityLabel={`价位阶梯图,现价 ${fmtNumber(current, 2)},共 ${all.length} 个报告价位`}>
            {/* 背景收盘价:每根一根柱(面积观感),透明度压低不与价位线抢视觉 */}
            {plotWidth > 0 && closes.length > 1
              ? closes.map((c, i) => (
                <View
                  key={`c${i}`}
                  style={[
                    styles.closeBar,
                    {
                      left: (i / closes.length) * plotWidth,
                      width: Math.max(1, plotWidth / closes.length),
                      height: Math.max(1, yOf(c) > LADDER_HEIGHT ? LADDER_HEIGHT : LADDER_HEIGHT - yOf(c)),
                    },
                  ]}
                />
              ))
              : null}
            {/* 价位线 */}
            {plot.map((lv, i) => (
              <View
                key={`l${i}`}
                style={[styles.levelLine, { top: lv.y, backgroundColor: kindMeta(lv.kind, theme).color }]}
              />
            ))}
            {/* 现价基准线(实线,品牌色) */}
            <View style={[styles.currentLine, { top: yOf(current) }]} />
            <View style={[styles.currentBadge, { top: Math.max(0, yOf(current) - 17) }]}>
              <Text style={styles.currentBadgeText}>{fmtNumber(current, 2)}</Text>
            </View>
          </View>

          {/* 价签列:y 走 stackLabelYs,避免相邻价位把文字叠在一起 */}
          <View style={styles.labelColumn}>
            {plot.map((lv, i) => {
              const meta = kindMeta(lv.kind, theme);
              return (
                <View key={`g${i}`} style={[styles.labelWrap, { top: lv.labelY - LABEL_GAP / 2 }]}>
                  <View style={[styles.labelTick, { backgroundColor: meta.color }]} />
                  <Text style={[styles.labelText, { color: meta.color }]} numberOfLines={1}>
                    {fmtNumber(lv.price, 2)}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
        {domain ? (
          <View style={styles.axisRow}>
            <Text style={styles.axisText}>高 {fmtNumber(domain.hi, 2)}</Text>
            <Text style={styles.axisText}>低 {fmtNumber(domain.lo, 2)}</Text>
          </View>
        ) : null}
        <View style={styles.legend}>
          {(['entry', 'target', 'stop'] as LevelKind[]).map((k) => {
            const meta = kindMeta(k, theme);
            return (
              <View key={k} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: meta.color }]} />
                <Text style={styles.legendText}>{meta.label}</Text>
              </View>
            );
          })}
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: theme.colors.text }]} />
            <Text style={styles.legendText}>现价</Text>
          </View>
        </View>
      </View>

      {/* 明细:每类价位 + 相对现价 + 原文片段(可回溯核对) */}
      {all.length ? (
        (['entry', 'target', 'stop'] as LevelKind[]).map((kind) => {
          const pool = kind === 'entry' ? levels.entry : kind === 'target' ? levels.target : levels.stop;
          if (!pool.length) return null;
          const meta = kindMeta(kind, theme);
          const nearest = nearestByKind(kind);
          return (
            <View key={kind} style={styles.card}>
              <View style={styles.ladderHead}>
                <Text style={styles.sectionTitle}>{meta.label}</Text>
                <Text style={styles.sectionNote}>
                  {pool.length} 档{nearest ? ` · 最近 ${fmtNumber(nearest.price, 2)}(${levelDeltaPct(nearest.price, current) >= 0 ? '+' : ''}${fmtNumber(levelDeltaPct(nearest.price, current), 1)}%)` : ''}
                </Text>
              </View>
              {pool.map((lv, i) => (
                <View key={`${kind}${i}`} style={styles.levelRow}>
                  <View style={[styles.levelBar, { backgroundColor: meta.color }]} />
                  <View style={styles.levelMain}>
                    <View style={styles.levelTop}>
                      <Text style={styles.levelPrice}>{fmtNumber(lv.price, 2)}</Text>
                      <Text style={[styles.levelDelta, { color: meta.color }]}>
                        {levelDeltaPct(lv.price, current) >= 0 ? '+' : ''}
                        {fmtNumber(levelDeltaPct(lv.price, current), 1)}%
                      </Text>
                    </View>
                    <Text style={styles.levelSource} numberOfLines={2}>{lv.source}</Text>
                  </View>
                </View>
              ))}
            </View>
          );
        })
      ) : (
        <View style={styles.card}>
          <Text style={styles.emptyTitle}>本次报告里没有可识别的价位</Text>
          <Text style={styles.emptyHint}>
            这张图只画《最终结论》文本里明确写出的买点 / 目标 / 止损价。常见原因:
            {'\n'}· 分析还在跑,或跑失败了(最终结论为空);
            {'\n'}· 跑的是演示占位报告(未配置 LLM 三键);
            {'\n'}· 这一版报告只写了定性结论,没给具体价位。
            {'\n'}换个说法重跑一次,或到「最终结论」Tab 看原文。
          </Text>
        </View>
      )}

      <Text style={styles.footnote}>
        价位由《最终结论》文本自动解析(只认「买入/目标/止损」等关键词紧随的数字),
        每条都附原文片段可回溯;解析不到的价位不会补猜。
      </Text>
    </ScrollView>
  );
});

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background, padding: theme.spacing.md },
    title: { fontSize: 18, fontWeight: '700', color: theme.colors.text, marginBottom: theme.spacing.md },
    summary: { flexDirection: 'row', gap: theme.spacing.sm, marginBottom: theme.spacing.md },
    summaryCell: { flex: 1, backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing.sm },
    summaryLabel: { fontSize: 11, color: theme.colors.textSecondary },
    summaryPrice: { fontSize: 22, fontWeight: '700', color: theme.colors.text, marginTop: 2 },
    summaryDelta: { fontSize: 12, fontWeight: '600', marginTop: 2 },
    summaryText: { fontSize: 13, fontWeight: '600', color: theme.colors.text, marginTop: 4 },
    card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing.sm, marginBottom: theme.spacing.md },
    ladderHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.spacing.xs },
    sectionTitle: { fontSize: 13, fontWeight: '600', color: theme.colors.text },
    sectionNote: { fontSize: 11, color: theme.colors.textSecondary },
    ladder: { flexDirection: 'row', height: LADDER_HEIGHT },
    plot: { flex: 1, height: LADDER_HEIGHT, position: 'relative', overflow: 'hidden' },
    closeBar: { position: 'absolute', bottom: 0, backgroundColor: theme.colors.textSecondary, opacity: 0.16 },
    levelLine: { position: 'absolute', left: 0, right: 0, height: 1 },
    // 现价线用 text 色(#31333F)而不是品牌红:目标线本来就是红(theme.up=primary),
    // 两个都用红的话现价基准线会跟「目标」混淆(2026-11-22 截图实测)。
    currentLine: { position: 'absolute', left: 0, right: 0, height: 2, backgroundColor: theme.colors.text },
    currentBadge: { position: 'absolute', left: 2, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.text, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
    currentBadgeText: { fontSize: 10, fontWeight: '700', color: theme.colors.text, fontVariant: ['tabular-nums'] },
    labelColumn: { width: LABEL_COLUMN_WIDTH, height: LADDER_HEIGHT, position: 'relative' },
    labelWrap: { position: 'absolute', left: 0, right: 0, height: LABEL_GAP, flexDirection: 'row', alignItems: 'center', gap: 4 },
    labelTick: { width: 8, height: 1 },
    labelText: { fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'] },
    axisRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: theme.spacing.xs },
    axisText: { fontSize: 10, color: theme.colors.textSecondary },
    legend: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm, marginTop: theme.spacing.sm },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    legendDot: { width: 8, height: 8, borderRadius: 4 },
    legendText: { fontSize: 11, color: theme.colors.textSecondary },
    levelRow: { flexDirection: 'row', gap: theme.spacing.sm, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border },
    levelBar: { width: 3, borderRadius: 2, alignSelf: 'stretch' },
    levelMain: { flex: 1 },
    levelTop: { flexDirection: 'row', alignItems: 'baseline', gap: theme.spacing.sm },
    levelPrice: { fontSize: 16, fontWeight: '700', color: theme.colors.text, fontVariant: ['tabular-nums'] },
    levelDelta: { fontSize: 12, fontWeight: '600' },
    levelSource: { fontSize: 10, color: theme.colors.textSecondary, marginTop: 2, lineHeight: 14 },
    emptyTitle: { fontSize: 15, fontWeight: '700', color: theme.colors.text, marginBottom: theme.spacing.xs },
    emptyHint: { fontSize: 12, color: theme.colors.textSecondary, lineHeight: 19 },
    footnote: { fontSize: 10, color: theme.colors.textSecondary, lineHeight: 15, marginBottom: theme.spacing.lg },
  });
}
