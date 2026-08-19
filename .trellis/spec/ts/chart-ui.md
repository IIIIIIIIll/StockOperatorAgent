---
description: 图表数据纯函数与 UI 编排(chartData/chartLayout/IndicatorChart/FinancialTrendChart/useAnalysis/App 安全区)
paths:
  - src/chartData.ts
  - src/chartLayout.ts
  - src/format.ts
  - app/components/IndicatorChart.tsx
  - app/components/FinancialTrendChart.tsx
  - app/hooks/useAnalysis.ts
  - app/App.tsx
  - app/lib/chartHtml.ts
---

# 图表与 UI 编排

## 图表数据纯函数(src/chartData.ts)

- `changePctHistData(values, dates, upColor, downColor)` — 涨跌幅柱;NaN/非
  有限值过滤(首根无前值 → NaN 跳过),正红负绿着色,0 归红(涨);values/dates
  同长同序(DataScreen computeAll 同窗口切片)。
- `financialTrendSeries(reports, profit)` — 财务跨期折线:净利润/每股收益取
  performance_reports 跨期;第三条线优先**销售毛利率**(F10 盈利能力节,
  performance_reports 恒 NaN——见源码注释);N/A 期跳过。ROE/毛利率为 %,
  label 内嵌单位(08-15 用户反馈:图无单位很怪)。
- `salesGrossMargin(profit, reportDate)` — 业绩卡片:报告期('YYYYMMDD')
  对应销售毛利率,缺失 → NaN。
- `FINANCIAL_COLORS` 折线色单点(对齐 Python charts._FINANCIAL_LINES:
  净利润/销售毛利率/每股收益)。
- 消费方:IndicatorChart.tsx(涨跌幅 pane)、FinancialTrendChart.tsx、
  DataScreen 业绩卡片。纯函数零 RN 依赖,可单测。

## 布局公共函数(src/chartLayout.ts)

`paneTops` 计算 pane 顶比例(web 两图表组件共用);HTML 侧(WebView 内嵌 JS,
app/lib/chartHtml.ts / tools/build-chart-view.mts)保持镜像注释;`npm run
chart:build` 生成、`npm run chart:check` 校验一致性。

## 全指标多面板图(app/components/IndicatorChart.tsx,08-13-ts-all-indicator-charts)

- **web-only + 动态 import**:lightweight-charts 只走 `import('lightweight-charts')`
  运行时加载(独立 chunk,不拉进 RN 原生 bundle);类型注释放顶层 `import type`。
  **坑**:`LineStyle` 是运行时枚举(值),须从动态 import 解构取值
  (`LineStyle: LineStyleValue`),不能只 import type。
- **多 pane 布局**:addSeries(def, opts, paneIndex) 建面板,全部 series 建完
  后 `chart.panes()[i].setStretchFactor(n)` 设比例。**禁止 setHeight**:Pane
  初始 height=0,首帧布局前 setHeight 参与 `_internal_changePanesHeight`
  重分配 → 高度错乱;stretch 是比例布局,与当前高度/调用顺序无关。
- **数据同源**:图表消费 computeAll 结果行(与「最新指标」chips 同一份),不新
  算第二遍;窗口切片与 K 线一致。DataScreen useMemo([ticker, dataVersion])
  缓存 bars 与指标行,避免流式重渲染重建图表(store.getDatas 每次返回新数组)。
- **NaN 处理**:指标 warmup 前导 NaN → 线/柱数据过滤 null;柱系列 base:0 +
  正负着色。
- **图例与颜色单点**:系列色常量 `C` 与 `LEGEND` 数组同源,图例 chips 与图上
  线条不漂移;柱(成交量/MACD/MACD_VH)用 theme.colors.up/down 半透明。

## 财务趋势图(app/components/FinancialTrendChart.tsx)

净利润/销售毛利率/每股收益各自一 pane(单位不同不混轴——对齐 Python
financial_charts dataviz 单轴原则);数据由 DataScreen 的
`financialTrendSeries` 纯函数准备;**空 series → 不渲染**(空数据不崩)。
原生分支(WebView)渲染同一数据(JSON 契约 NativeTrendData,与
tools/build-chart-view.mts 头部文档一致:财务 3 pane 折线,stretch 等比例,
图例单行 chips);`PANE_STRETCH = [100,100,100]` 等比例(禁 setHeight,与
IndicatorChart 同约定);pane 顶 y 坐标经 chartLayout `paneTops` 计算。

## UI 编排(app/hooks/useAnalysis.ts + app/App.tsx,08-16-app-analysis-hook)

- 分析编排(状态/启动链/runner 订阅/start 编排/设置保存)在 useAnalysis.ts;
  App.tsx 是**纯渲染层**(UI 状态 activeTab/ticker/showSettings + 派生 +
  `__soa` 调试钩子 + 样式)。
- 约束:`start(ticker)` 参数化(ticker 输入框在 App);hook 内订阅 effect 保持
  **空依赖数组**——闭包只碰稳定引用(`modeRef`)+ 模块级 `enabledRoles()`,
  新增状态读取若来自 settings 必须经 ref 同步(防陈旧闭包);后续 UI 逻辑
  (新页面/新入口)一律进 hooks/ 或 components/,不回流 App.tsx。
- `__soa` 调试钩子:App.tsx effect 内 `typeof window !== 'undefined'` 守卫
  挂载(start/switchTab/getState)。

## iOS/Android 安全区(08-16-audit-remediation)

`SafeAreaProvider` 包根(App.tsx),header 用 `useSafeAreaInsets().top` 上移
(`paddingTop: insets.top + spacing.lg`)。**`RNStatusBar.currentHeight` 是
android-only,禁止用于顶部布局**——edge-to-edge 下 Android 15+ 状态栏会盖住
☰ 等顶部控件,统一走 insets(勿用 currentHeight 补偿)。
