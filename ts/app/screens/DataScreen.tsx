// 采集数据 Tab:日K 尾表 + 指标表 + stock_information 摘要
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import demo from '../data/demo.json';

const LATEST_N = 8;

export default function DataScreen({ stockInformation }: { stockInformation: string }) {
  const bars = (demo.bars as Array<{ date: string; open: number; close: number; high: number; low: number; volume: number }>).slice(-LATEST_N);
  const indicators = ((demo.indicators as unknown as Array<Record<string, number | null>>).slice(-1)[0] ?? {}) as Record<string, number>;
  const indicatorKeys = ['MA5', 'MA10', 'MA20', 'MACD', 'RSI6', 'K', 'BOLL_UP', 'ATR', 'VOL_RATIO', 'MACD_VH', 'LIU_BIAS'];
  const hasStockInfo = stockInformation.length > 0;

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>采集数据 · {demo.name} ({demo.ticker})</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>最近 {LATEST_N} 个交易日(原始价)</Text>
        <View style={styles.table}>
          <View style={[styles.row, styles.headerRow]}>
            <Text style={[styles.cell, styles.dateCell]}>日期</Text>
            <Text style={styles.cell}>开</Text>
            <Text style={styles.cell}>收</Text>
            <Text style={styles.cell}>高</Text>
            <Text style={styles.cell}>低</Text>
          </View>
          {bars.map((b, i) => (
            <View key={i} style={styles.row}>
              <Text style={[styles.cell, styles.dateCell]}>{b.date}</Text>
              <Text style={styles.cell}>{b.open.toFixed(2)}</Text>
              <Text style={[styles.cell, { color: b.close >= b.open ? '#d33' : '#1a8f3d' }]}>{b.close.toFixed(2)}</Text>
              <Text style={styles.cell}>{b.high.toFixed(2)}</Text>
              <Text style={styles.cell}>{b.low.toFixed(2)}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>最新指标(computeAll 末根)</Text>
        <View style={styles.chips}>
          {indicatorKeys.map((k) => (
            <View key={k} style={styles.chip}>
              <Text style={styles.chipLabel}>{k}</Text>
              <Text style={styles.chipValue}>{Number.isFinite(indicators[k] ?? NaN) ? (indicators[k] as number).toFixed(3) : 'N/A'}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>分析上下文(build_stock_information 输出)</Text>
        {hasStockInfo ? (
          <Text style={styles.infoText}>{stockInformation.slice(0, 2400)}{stockInformation.length > 2400 ? '\n…(截断)' : ''}</Text>
        ) : (
          <Text style={styles.muted}>尚未运行分析——上下文将在「设置」点击开始后生成。</Text>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f7f7f7', padding: 12 },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 10 },
  section: { marginBottom: 14 },
  sectionTitle: { fontSize: 15, fontWeight: '600', marginBottom: 6, color: '#333' },
  table: { backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#e5e5e5', overflow: 'hidden' },
  row: { flexDirection: 'row', paddingVertical: 5, paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eee' },
  headerRow: { backgroundColor: '#f0f0f0' },
  cell: { flex: 1, fontSize: 12, textAlign: 'right' },
  dateCell: { flex: 1.6, textAlign: 'left', color: '#555' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { backgroundColor: '#fff', borderRadius: 6, borderWidth: 1, borderColor: '#e0e0e0', paddingHorizontal: 8, paddingVertical: 5 },
  chipLabel: { fontSize: 11, color: '#666' },
  chipValue: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  infoText: { backgroundColor: '#fff', borderRadius: 8, padding: 10, fontSize: 11, lineHeight: 16, fontFamily: 'monospace', color: '#333' },
  muted: { color: '#999', fontSize: 12 },
});
