---
description: 图表数据纯函数与 UI 编排(chartData/chartLayout/IndicatorChart/FinancialTrendChart/analysisController/useAnalysis/App 安全区)
paths:
  - src/chartData.ts
  - src/chartLayout.ts
  - src/format.ts
  - app/components/IndicatorChart.tsx
  - app/components/FinancialTrendChart.tsx
  - app/lib/analysisController.ts
  - app/hooks/useAnalysis.ts
  - app/App.tsx
  - app/lib/chartHtml.ts
---

# 图表与 UI 编排

## 图表数据纯函数(src/chartData.ts)

- `changePctHistData(values, dates, upColor, downColor)` — 涨跌幅柱;NaN/非
  有限值过滤(首根无前值 → NaN 跳过),正红负绿着色,0 归红(涨);values/dates
  同长同序(DataScreen computeAll 同窗口切片)。
- `financialTrendSeries(reports, profit, market: Market = 'cn')` — 财务跨期折线:净利润/每股收益取
  performance_reports 跨期;第三条线优先**销售毛利率**(F10 盈利能力节,
  performance_reports 恒 NaN——见源码注释);N/A 期跳过。ROE/毛利率为 %,
  label 内嵌单位(08-15 用户反馈:图无单位很怪)。
  market(S5)驱动币种标签:cn 输出与改造前逐字节不变(亿元/元),hk
  亿HKD/HKD、us 亿USD/USD(`marketInfo(market).currency`;与 chartData.ts
  头注、hk-us-data.md §3 单位/货币条同源)。
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
- **窄屏图例(08-21-mobile-pane-label)**:宽度 < 560px 时主图图例(9 chips
  单行 ≈ 470px 放不下)改为图表容器上方**文档流内换行块**(flexWrap,不遮挡
  K 线),其余 pane(≤3 chips)保持浮层;宽屏维持浮层叠加。判定:
  web 分支 `useWindowDimensions().width`、WebView 分支 `window.innerWidth`
  (chartHtml `.pane-label.inline`),两分支规则一致。

## 财务趋势图(app/components/FinancialTrendChart.tsx)

净利润/销售毛利率/每股收益各自一 pane(单位不同不混轴——对齐 Python
financial_charts dataviz 单轴原则);数据由 DataScreen 的
`financialTrendSeries` 纯函数准备;**空 series → 不渲染**(空数据不崩)。
原生分支(WebView)渲染同一数据(JSON 契约 NativeTrendData,与
tools/build-chart-view.mts 头部文档一致:财务 3 pane 折线,stretch 等比例,
图例单行 chips);`PANE_STRETCH = [100,100,100]` 等比例(禁 setHeight,与
IndicatorChart 同约定);pane 顶 y 坐标经 chartLayout `paneTops` 计算。

## UI 编排(analysisController + useAnalysis + App.tsx,08-16-app-analysis-hook;U13 双层化)

- **双层编排(U13 可测化)**:分析编排主体在 app/lib/analysisController.ts
  (`AnalysisController` 纯 TS 类:bootstrap 启动链/lastRun 恢复/runner 事件
  归约/start(ticker, market)/设置变更);runner/store/设置读写/采集/intel/
  keepalive/log/clock 经 AnalysisDeps 注入,vitest 以假 runner 直测
  (test/analysis-controller.test.ts)。useAnalysis.ts 是薄 React 桥(deps 接线
  实例化 + 快照订阅挂载 effect + start/onSettingsChange 转发,对外字段与抽取前
  逐一对应);App.tsx 是纯渲染层(UI 状态 activeTab/ticker/showSettings +
  派生 + `__soa` 调试钩子 + 样式)。
- **订阅时机**:runner 订阅随控制器生命周期存在(**构造即订阅**;根 hook 常驻
  不卸载,与抽取前「hook 内空依赖数组 mount effect 订阅/unmount 退订」对外可
  观察行为一致)。UI 快照监听走 controller.subscribe()(挂载 effect 建立,
  卸载退订)。编排逻辑变更进 AnalysisController(可测层),useAnalysis 只做
  React 状态桥接;后续 UI 逻辑(新页面/新入口)一律进 hooks/ 或 components/,
  不回流 App.tsx。
- **约束**:`start(ticker, market)` 参数化(ticker 输入框与市场下拉均在 App;
  市场手动选择,默认沪深A股;lastRun 恢复按 ticker 反推市场)。
- **启动链与 start 的优先级(N-2 教训,08-29 上线前复审)**:bootstrap 的
  lastRun/demo 恢复块是**异步恢复**(await storeReady 之后),而 start 的重入
  守卫只挡 start-vs-start——storeReady 未决时用户点「开始分析」,start 已
  running=true,bootstrap 恢复块随后覆写共享状态会把上一会话报告事件/状态
  chip 污染进行中的 run。守则:bootstrap 在 await storeReady(+设备注入)之后、
  恢复块之前必须 `if (s.running) return;`(start 优先),防交错窗口。任何新增
  的异步启动链步骤都要保持该守卫在恢复写共享状态之前。
- **D15**:hasDone(done → true;start/error → false;恢复按 final_decision
  非空同步)由控制器维护;App 进度区整体门消费——运行中显最新进度行,仅
  !running && hasDone 显「✓ 分析完成」,失败终态整块不渲染防空横条
  (外层容器一并门控)。
- `__soa` 调试钩子:App.tsx effect 内 `typeof window !== 'undefined'` 守卫
  挂载(start/switchTab/getState)。
- **市场下拉(Modal 弹层,08-22-modal-dropdown)**:菜单用 RN `Modal`
  (`transparent`, `animationType='fade'`)渲染,portal 到 root 层——**在 web 和
  原生都盖住表单内容**(修复 RN-web 层叠上下文 bug:表单里「未配置 LLM三键」警告
  文字等信息 View 被绘制到菜单卡片之上,导致菜单看似透明、内容透出;曾尝试纯
  zIndex 提升无效,必须用 Modal 隔离层叠上下文)。菜单定位:触发按钮
  `measureInWindow` 测量窗口坐标存 `menuAnchor`,Modal 内菜单 `position:absolute`
  `left/top` 到按钮下方。菜单卡片本身不透明(`surface` + 边框 + 阴影);全屏透明
  点击层(`marketModalRoot`)负责点外关闭,开始分析先关菜单。**禁止用 marginTop
  推移下方内容**(08-22 移除 116px 推移——布局跳动换零遮挡不可取)。

## iOS/Android 安全区(08-16-audit-remediation)

`SafeAreaProvider` 包根(App.tsx),header 用 `useSafeAreaInsets().top` 上移
(`paddingTop: insets.top + spacing.lg`)。**`RNStatusBar.currentHeight` 是
android-only,禁止用于顶部布局**——edge-to-edge 下 Android 15+ 状态栏会盖住
☰ 等顶部控件,统一走 insets(勿用 currentHeight 补偿)。
