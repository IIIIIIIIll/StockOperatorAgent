# ts-app-ui 审查报告

TS App UI 层(web + RN 共享 React 组件;用户要求最仔细)。12 文件逐行全读,跨文件引用经
grep/read 核实(committee.ts / events.ts / pipeline.ts / indicators.ts / overview.ts /
store.ts / f10.ts / format.ts / settings.ts / runner.ts / metro.config.js / demo 数据)。
审查重点逐条对照 `.trellis/spec/ts/index.md`「图表(web-only;08-13-ts-all-indicator-charts)」
与「事件流协议」章节。

## 审阅覆盖

|文件|行数|结论|
|---|---|---|
|ts/app/App.tsx|401|有发现(INFO×2)|
|ts/app/index.ts|8|无发现|
|ts/app/theme.ts|67|有发现(WARNING×1,与 app.json 联动)|
|ts/app/app.json|25|有发现(WARNING×1,INFO×1)|
|ts/app/package.json|32|有发现(INFO×1,与 app.json 联动)|
|ts/app/tsconfig.json|8|无发现|
|ts/app/screens/DataScreen.tsx|192|有发现(INFO×2)|
|ts/app/screens/SettingsPanel.tsx|200|无发现|
|ts/app/screens/ReportScreen.tsx|118|有发现(WARNING×1,死代码)|
|ts/app/components/IndicatorChart.tsx|221|有发现(INFO×1)|
|ts/app/components/ReportContent.tsx|120|有发现(INFO×1)|
|ts/app/components/MarkdownText.tsx|38|无发现(markdown 安全:无 webview、无 raw HTML 渲染,link 仅样式,无 XSS 面)|

## 发现

### [WARNING] 原生端暗色主题不可达:app.json 强制 userInterfaceStyle "light"
- **位置**: ts/app/app.json:8;ts/app/theme.ts:62-64
- **问题**: theme.ts 显式实现系统跟随亮/暗(注释「跟随系统亮/暗(Streamlit 同语义)」,提供完整 dark 色板),
  但 app.json `userInterfaceStyle: "light"` 在 iOS(Info.plist UIUserInterfaceStyle=Light)/Android 强制
  亮色外观,`useColorScheme()` 恒返回 'light' → 原生端 dark 分支与暗色板全部成为死代码;仅 web
  (expo web 按系统 prefers-color-scheme 走)能进入暗色。同一主题契约在两端行为不一致,属配置与
  代码意图冲突(模板残留)。
- **证据**:
  ```json
  "userInterfaceStyle": "light",
  ```
  ```ts
  export function useTheme(): Theme {
    const scheme = useColorScheme();
    return scheme === 'dark' ? dark : light;
  }
  ```
- **建议**: 改为 `"userInterfaceStyle": "automatic"`,或明确 dark 仅 web 支持并在 app.json 注释说明。
- **spec 对照**: 违反 ts/index.md 图表约定之外的主题意图(theme.ts 注释「跟随系统亮/暗」);无明文 spec 条目,属
  TS UI 层自身一致性。

### [WARNING] ReportScreen.tsx 为死代码(重复实现,无任何导入)
- **位置**: ts/app/screens/ReportScreen.tsx:17(全文件)
- **问题**: 全仓库 grep 仅 slices.json(审查任务清单)与自身定义命中,App.tsx 实际使用 ReportContent.tsx
  渲染报告 Tab(进度条/Tab 条/最终结论/expander 全部在 App + ReportContent 内实现)。ReportScreen 是
  st.tabs 语义的早期重复实现(事件数组驱动 + 本地 activeKey),与 App 的 stateKey 驱动路线并存,
  属 spec 明列的「死代码/重复」。因其含独立进度条/展开逻辑,后续维护存在双实现漂移风险。
- **证据**:
  ```ts
  export default function ReportScreen({ events, finalDecision, running }: Props) {
  ```
  (无任何 `import ... from './screens/ReportScreen'` 或动态引用)
- **建议**: 删除 ts/app/screens/ReportScreen.tsx(或以一行注释说明保留原因)。
- **spec 对照**: ts/index.md WARNING 判据「死代码/重复」;TS UI 层应只有 App/ReportContent 一条报告渲染路径。

### [INFO] 图例柱色与图上柱体颜色漂移(MACD 柱 / VH 柱 chips)
- **位置**: ts/app/components/IndicatorChart.tsx:44,53(LEGEND);:157-162,173-179(实际柱数据)
- **问题**: spec 约定「图例 chips 与图上线条不漂移」;线系列(MA/EMA/BOLL/DIF/DEA/K/D/J/RSI/ATR/
  VOL_RATIO/LIU_BIAS)全部同源,但 MACD 柱与 VH 柱 chip 色为 `C.amber`,实际柱体用
  `theme.colors.up/down` 半透明(upA/downA)着色;成交量面板图例只有 VOL_MA5 一个 chip,量柱本身
  无图例项。用户看到的图例色与实际柱色不一致(琥珀 vs 红/绿)。
- **证据**:
  ```ts
  { label: 'DIF', color: C.amber }, { label: 'DEA', color: C.sky }, { label: 'MACD 柱', color: C.amber },
  ```
  ```ts
  macd.setData(histData(rows, dates, 'MACD', upA, downA)); // upA/downA = 主题 up/down 半透明
  ```
- **建议**: 柱图例 chip 改用「up/down 双色或半透明红/绿」表示(或标注「按涨跌着色」),与 LEGEND 同源原则
  一致化;量柱补一个图例项。
- **spec 对照**: 偏离 ts/index.md「图例与颜色单点定义……图例 chips 与图上线条不漂移」。

### [INFO] DataScreen 概览丢弃已采集的实时 snapshot
- **位置**: ts/app/screens/DataScreen.tsx:34
- **问题**: App.start() 经 /tdx-collect 采集到真实 `snapshot`(price/high/low/open)并传给
  buildStockInformation(分析上下文用实时价),但 DataScreen 渲染「采集数据」Tab 概览时硬编码
  `snapshot: null`,仅回退日K末根 close——盘中最新价/涨跌幅与采集到的快照不一致(差异在当日 bar
  收盘价 vs 盘中价)。代码注释解释了回退语义,但未解释为何连已采集的 snapshot 都不用;与 Python
  侧 data 视图(展示快照行情)存在保真度落差。
- **证据**:
  ```ts
  const overview = composeOverview({
    ticker,
    name: stock?.name ?? ticker,
    snapshot: null,
    capital: null,
  ```
- **建议**: App 将采集到的 snapshot/capital/name 作为 props 传入 DataScreen(或存 store 经 getStock 取),
  概览直接消费,与 build_stock_information 同一份快照。
- **spec 对照**: 数据同源原则的精神延伸(图表/概览/上下文同源);非硬性违反。

### [INFO] ReportContent expander 状态未按 roleKey 隔离(跨角色 Tab 泄漏)
- **位置**: ts/app/components/ReportContent.tsx:44,80
- **问题**: `expanded` 以槽位索引 `i`(0=初稿,1=修订)为键;切换角色 Tab(看涨↔看跌等)时组件类型不变、
  不重挂载,state 跨角色保留。用户展开看涨初稿后切到看跌,看跌初稿同样被展开;流式展开/手点折叠
  状态互相污染。影响轻微(槽位语义一致,仅展开状态串位)。
- **证据**:
  ```ts
  const [expanded, setExpanded] = React.useState<Record<number, boolean>>({});
  ...
  const open = expanded[i] ?? streaming; // 流式中的槽位默认展开
  ```
- **建议**: 以 `roleKey` 为前缀键(`expanded[`${roleKey}:${i}`]`),或切换 roleKey 时重置。
- **spec 对照**: 无明文条目;UI 状态生命周期问题。

### [INFO] App.tsx 单行双 import 语句
- **位置**: ts/app/App.tsx:15
- **问题**: `import { THEME_HEADING, useTheme, type Theme } from './theme';import {`——两个 import 语句挤在
  一行,语法合法但破坏可读性,格式化工具会拆分。
- **证据**:
  ```ts
  import { THEME_HEADING, useTheme, type Theme } from './theme';import {
  ```
- **建议**: 拆为两行。
- **spec 对照**: N/A(风格)。

### [INFO] 日K 表「量(手)」表头与「X万」单元格单位不一致
- **位置**: ts/app/screens/DataScreen.tsx:91,100
- **问题**: 表头写「量(手)」,单元格 `(b.volume / 10000).toFixed(1)}万` 实际显示万手;量纲标注与数值
  单位脱节(如显示「250万」实为 250 万手)。
- **证据**:
  ```tsx
  <Text style={styles.cell}>量(手)</Text>
  ...
  <Text style={styles.cell}>{(b.volume / 10000).toFixed(1)}万</Text>
  ```
- **建议**: 表头改「量(万手)」或单元格去掉「万」。
- **spec 对照**: N/A(展示层小瑕疵)。

### [INFO] app.json/package.json 模板残留(应用名/标识未个性化)
- **位置**: ts/app/app.json:3-5;ts/app/package.json:2-3
- **问题**: app.json `name: "HelloWorld"`、`slug: "expo-template-blank-typescript"`,package.json
  `name/description` 同为模板默认。发布/打包时应用标识会以 HelloWorld 出现。
- **证据**:
  ```json
  "name": "HelloWorld",
  "slug": "expo-template-blank-typescript",
  ```
- **建议**: 改为 StockOperatorAgent 对应标识。
- **spec 对照**: N/A(打包配置)。

## spec 符合性结论

- **图表约定(逐条核对,全部符合)**:
  1. web-only 动态 import:Platform.OS 守卫 + `void import('lightweight-charts')` 仅 web 执行;顶层
     `import type { IChartApi, LineStyle }` 类型擦除,不引入运行时依赖 ✓
  2. LineStyle 运行时枚举:动态 import 解构 `LineStyle: LineStyleValue`,线样式取
     `LineStyleValue.Solid/Dashed/Dotted` ✓
  3. 多 pane 布局:`chart.panes().forEach(p.setStretchFactor(PANE_STRETCH[i]))`,无任何 setHeight 调用 ✓
  4. 数据同源:`DataScreen` `bars = useMemo(() => store.getDatas(ticker), [ticker, dataVersion])`,
     `indRows` 派生同源,图表/最新指标 chips 消费同一 `computeAll` 结果 ✓
  5. 窗口切片与 K 线一致:`klineBars = bars.slice(-60)` 与 `chartRows = indRows.slice(-60)` 同长同序 ✓
  6. NaN 前导处理:`lineData/histData` 过滤 `null/undefined/!Number.isFinite`,柱系列 `base: 0` + 正负着色 ✓
  7. 图例与 C 同源:LEGEND 全部引用 C 常量(柱色漂移见 INFO #3,线系列完全同源)✓
- **事件流协议**:report 清 partial(按事件时刻 `enabledRoles()` 在 setPartials 更新器内查 stateKey→清
  nodeName+reviseNodeName)、retry 清 partial、token 追加、done/error 接线全部符合;`enabledRoles()` 事件
  时刻调用而非挂载闭包 ✓;设置开关即时 applySwitchesToEnv(开→删 env、关→'1')✓
- **SettingsPanel**:开关中途变更即时生效(update→onSettingsChange→App save+apply),持久化
  loadSettings/saveSettings 双向一致 ✓;缺三键禁用保存 + 可达性检测 ✓
- **主题**:色板与 Python core/ui/theme.py 语义对齐(亮 #D32F2F / 暗 #EF5350,涨红跌绿)✓;native 暗色
  不可达见 WARNING #1
- **依赖与配置**:lightweight-charts ^5.2.0(v5 paneIndex API 匹配)、react-native-markdown-display ^7.0.2、
  tsconfig strict + allowImportingTsExtensions + noEmit 合理;assets 齐全(icon/favicon/adaptive 全套存在)
  ✓;模板残留见 INFO #8

整体:图表核心实现与 spec 高度吻合,无 CRITICAL;发现集中在配置一致性、死代码与展示层小瑕疵。
