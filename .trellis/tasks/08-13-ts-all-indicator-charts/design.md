# Design: 全指标多面板图

## 结构

新组件 `ts/app/components/IndicatorChart.tsx`,替换 DataScreen 内 `KLineChart`。

```
DataScreen
  └─ IndicatorChart(bars, rows, theme)
       ├─ 图例列(每个 pane 一行:标题 + 彩色系列 chips)
       └─ 单个 createChart(固定总高 = Σ pane 高)
            pane 0  主图   Candlestick + MA(实线) + EMA(虚线) + BOLL(点线)
            pane 1  成交量 Histogram + VOL_MA5 线
            pane 2  MACD   DIF/DEA 线 + MACD 柱(base 0)
            pane 3  KDJ    K/D/J 线
            pane 4  RSI    RSI6/12/24 线
            pane 5  MACD-VH MACD_V/SIGNAL 线 + MACD_VH 柱(base 0)
            pane 6  ATR    线
            pane 7  VOL_RATIO 线
            pane 8  LIU_BIAS 线
```

- 入参 `rows: IndicatorRow[]` = DataScreen 已算的 `indRows.slice(-KLINE_N)`,
  `bars` 与 K 线窗口同一份切片 —— 不重复计算、窗口天然对齐。
- 主题:跟随 `useTheme`;`theme.colors.up/down` 用于阳/阴柱与 MACD 柱。

## 关键实现点

1. **多 pane**:`chart.addSeries(LineSeries, {…}, paneIndex)`;全部 series
   建完后 `chart.panes()[i].setStretchFactor(n)` 设置面板比例(v5 API)。
   **坑**:不要用 `setHeight`——Pane 初始 `height=0`,首帧布局前 setHeight 以
   totalHeight=0 计算(`_internal_changePanesHeight`),面板高度错乱;
   stretch 是比例布局,与当前高度无关、顺序无关。
2. **总高**:主图 300 + 成交量 90 + 振荡器(4)×90 + 单线(3)×70 ≈ 960px
   (stretch 比例,实际像素按图高扣时间轴后等比缩放),ScrollView 内滚动无压力。
3. **null 处理**:指标 warmup 前导 NaN → `{time, value}` 过滤 null;NaN 只
   出现在序列头部,过滤后无中间断档。柱系列用 `base: 0`。
4. **柱色**:成交量/MACD/MACD_VH 柱按当日涨跌或正负取 `theme.colors.up/down`
   (半透明),沿用现有 volume 柱的做法。
5. **线型区分同色系**:MA 实线、EMA 虚线(Dashed)、BOLL 点线(Dotted),
   图例 chips 用同色小色块 + 系列名。
6. **主题切换**:`useEffect` 依赖 `[bars, rows, theme]`,重建 chart(沿用
   现有 dispose 模式:置 `disposed` 标志 + `chart.remove()`),web-only 守卫
   与现有 KLineChart 相同。
7. **图例数据结构**:静态数组 `{ pane, title, series: [{label, color}] }`,
   与 series 创建共用同一份颜色常量 —— 单点定义防漂移。

## 颜色常量(单点定义)

| 系列 | 颜色 |
|---|---|
| MA5/EMA5/DIF/MACD_V/K/RSI6 | `#f59e0b`(amber) |
| MA10/EMA10/VOL_MA5/DEA/SIGNAL/D/RSI12/VOL_RATIO | `#38bdf8`(sky) |
| MA20/EMA20/J/RSI24/LIU_BIAS | `#c084fc`(purple) |
| MA60/EMA60 | `#94a3b8`(gray) |
| BOLL_UP/MB/DN | `#10b981`(green) |
| ATR | `#eab308`(yellow) |

柱(成交量/MACD/MACD_VH):阳/正 `theme.colors.up`,阴/负 `theme.colors.down`。

## 验证

- `tsc --noEmit`(ts/ 根 + ts/app)零错误;`vitest run` 全绿(不新增测试:
  canvas UI,走浏览器实测)。
- 浏览器:expo web + server,采集数据 Tab 截图核对 9 面板 + 图例;
  明暗主题各查一次。
