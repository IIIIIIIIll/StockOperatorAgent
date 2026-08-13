# PRD: ts 侧指标图 —— 全部指标图表化

## 背景

`ts/app/screens/DataScreen.tsx` 目前只有一张图:K线 + 成交量(web-only,
lightweight-charts)。`computeAll` 已算出全部通达信口径指标(MA/EMA/MACD/RSI/
KDJ/BOLL/ATR/量比/MACD-VH/刘晨明乖离率),但只在「最新指标」chips 里显示
末根数值。用户要求:我们的那些指标都要(图表化)。

## 需求

1. 采集数据 Tab 的技术图表区从单张 K 线图扩展为全指标多面板图,每个指标
   族一张面板,全部来自 `computeAll` 输出行(与「最新指标」chips 同源,
   不新算第二遍)。
2. 面板编排(对齐通达信习惯 + Python `get_trend_indicators` 分组):
   - 主图:蜡烛 + MA5/10/20/60 + EMA5/10/20/60 + BOLL_UP/MB/DN(叠加)
   - 成交量:量柱 + VOL_MA5(独立面板)
   - MACD:DIF/DEA 线 + MACD 柱
   - KDJ:K/D/J 线
   - RSI:RSI6/12/24 线
   - MACD-VH:MACD_V/SIGNAL 线 + MACD_VH 柱
   - ATR 单线面板
   - VOL_RATIO 单线面板
   - LIU_BIAS 单线面板
3. 每面板有图例(系列名 + 颜色),方便辨认 20 条线。
4. 沿用现有约束:web-only(与现有 K 线一致,原生端 canvas polyfill 未接);
   同一 `createChart` 多 pane(时间轴/十字线天然同步)。

## 非目标

- 不做面板开关/指标显隐交互(图例仅展示)。
- 不做 TURNOVER_RATE 面板:需要流通股本,当前数据链未提供(对齐 Python:
  值为 NaN 时显示 N/A,不重复拉取)。
- 不改业务层 `computeAll` / 指标口径;图表只消费现有行。
- 不接原生端 canvas polyfill。

## 验收标准

1. web 端采集数据 Tab 渲染全部 9 个面板,指标与「最新指标」chips 同源
   (同一 `computeAll` 结果切片,窗口与 K 线一致 = 近 60 根)。
2. 图例完整:每个系列有名称与颜色,颜色与图上线条一致。
3. `tsc --noEmit`(ts/ 根 + ts/app)零错误;`vitest run`(ts/ 根)全绿。
4. 浏览器实测:面板齐全、无空窗/NaN 崩溃;切主题后图表跟随主题色。

## 风险

- lightweight-charts v5.2 多 pane 用 `paneIndex` + `chart.panes()[i].setHeight()`
  (已确认 API 存在);若面板高度控制失效,退化为统一高度面板。
- 指标 warmup 前导 NaN(如 MACD 前 ~33 根):线条数据过滤 null,仅头部缺失,
  无中间断档。
