// 根组件 —— 布局对齐 Python display.write_ui:
// 标题 → ticker 表单(首页最显眼)→ 主 Tab 条([采集数据] + 角色报告)
// → 内容区;设置四节放侧边栏(宽屏固定 / 窄屏按钮切换)。
// 分析编排(状态/启动链/订阅/start)在 app/hooks/useAnalysis.ts(08-16 重构),
// 本组件只保留 UI 状态(activeTab/ticker/drawer)、派生与渲染。
// 入口合并:☰ 打开抽屉菜单(设置/历史),二级页在抽屉内切换 —— 原右上角历史按钮已取消。
import React from 'react';
import { AppState, BackHandler, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions, type Role } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';
import ReportContent from './components/ReportContent';
import ErrorBoundary from './components/ErrorBoundary';
import DataScreen from './screens/DataScreen';
import SettingsPanel from './screens/SettingsPanel';
import HistoryPanel from './screens/HistoryPanel';
import { THEME_HEADING, useTheme, type Theme } from './theme';
import { missingLlmKeys } from './lib/settings';
import { reportRoles } from '../src/committee.ts';
import { DEMO_TICKER } from '../src/metaKeys.ts';
import { marketInfo, MARKET_CHOICES, type Market } from '../src/market.ts';
import { useAnalysis } from './hooks/useAnalysis';
import { useDrawer } from './hooks/useDrawer';
import { formatRunTime } from '../src/runHistory.ts';
import type { PipelineEvent } from './lib/runner';

type TabId = 'data' | string; // 'data' 或角色 stateKey

/** 模块实例令牌:只有同一模块实例重复挂载（同一次热重载内）才跳过安装。
 *  之前只看 `if (g.__soa) return`，Fast Refresh 后新模块实例会直接返回，
 *  `window.__soa` 永久闭包住已卸载的旧控制器（getState/start 全部失效）。 */
const SOA_HOOK_TOKEN = {};

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // makeStyles 每次渲染都建 ~60 个 StyleSheet 对象;流式 token 期间每帧都跑 → memo
  const styles = React.useMemo(() => makeStyles(theme, insets), [theme, insets]);
  const { width, height } = useWindowDimensions();
  const [activeTab, setActiveTab] = React.useState<TabId>('data');
  const [ticker, setTicker] = React.useState(DEMO_TICKER);
  // 市场手动选择(输入框旁下拉):默认沪深A股;无自动识别
  const [market, setMarket] = React.useState<Market>('cn');
  const [showMarketMenu, setShowMarketMenu] = React.useState(false);
  // 下拉锚点:按钮在窗口中的位置(用于 Modal 全屏层里定位菜单浮层)
  const [menuAnchor, setMenuAnchor] = React.useState<{ x: number; y: number; width: number; bottom: number } | null>(null);
  // 菜单浮层实测尺寸(onLayout):翻转/右缘 clamp 用真实宽高,避免估算漂移
  const [menuSize, setMenuSize] = React.useState<{ width: number; height: number } | null>(null);
  const marketButtonRef = React.useRef<View>(null);
  // 抽屉:☰ 打开一级菜单(设置/历史),点进去在该抽屉内换成二级页(← 返回菜单)。
  // R-11:页面状态机在 hooks/useDrawer.ts,这里只消费。
  const drawer = useDrawer();
  // 宽度只用「比例 + clamp」决定(见 drawerWidthFor),不写死 dp:
  // 窄屏 88% 覆盖式、宽屏 28% 占位;切窄到覆盖阈值直接懒切换布局,不强制关抽屉
  const drawerOverlay = width < DRAWER_OVERLAY_MAX_WIDTH;
  const drawerWidth = drawerWidthFor(width);
  // D1:菜单打开期间窗口尺寸变化(web resize/zoom)→ 重测锚点;measureInWindow
  // 是异步快照,尺寸变化后旧锚点即过期。native 旋转已锁 portrait(app.json),
  // 此 effect 仅窗口尺寸真实变化时触发,无害
  React.useEffect(() => {
    if (!showMarketMenu) return;
    marketButtonRef.current?.measureInWindow((x, y, w, h) => {
      setMenuAnchor({ x, y, width: w, bottom: y + h });
    });
  }, [showMarketMenu, width, height]);

  const a = useAnalysis();
  // 恢复/上次运行后下拉跟随真实市场(a.market 仅 start()/恢复时变更,不影响运行中选择)
  // S5-3(评审 2026-11-08):查看历史时 applyReportBody 会把 a.market 改成归档市场,
  // 若照抄进下拉,退出历史后下一次「开始分析」会静默使用归档的市场。历史态不同步。
  React.useEffect(() => {
    if (a.viewingRun) return;
    setMarket(a.market);
  }, [a.market, a.viewingRun]);
  // 锁屏/切后台时关掉市场下拉的透明 Modal:RN Modal 是真 Dialog 窗口,持有焦点
  // 时 eats 所有触摸+滚动;带着它进后台再回来是「点不动」的一个可达路径。
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') setShowMarketMenu(false);
    });
    return () => sub.remove();
  }, []);
  // S5-4(评审 2026-11-08):安卓硬件返回键 —— app.json 关了 predictiveBackGestureEnabled,
  // 又全无 BackHandler,于是抽屉/下拉开着时按返回键直接退出 App。现按逐层叠退:
  // 市场下拉 → 抽屉二级页 → 抽屉菜单 → 收起后才交回系统。
  // Platform 门 + 可选链:web(RNW 无 BackHandler)与 iOS 不会进这里。
  React.useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const sub = BackHandler?.addEventListener('hardwareBackPress', () => {
      if (showMarketMenu) {
        setShowMarketMenu(false);
        return true;
      }
      return drawer.handleBack();
    });
    return () => sub?.remove();
  }, [drawer.page, drawer.handleBack, showMarketMenu]);
  const roles = reportRoles(); // (stateKey, tabTitle) —— report_tabs() 契约

  const missing = missingLlmKeys(a.settings.keys);
  const gateNotice = missing.length
    ? `未配置 LLM 三键(${missing.join('/')})—— 将使用演示占位报告;在 ☰ → 设置 →「LLM(大模型)」填写后保存。`
    : null;

  // 主 Tab 列表:[采集数据] + 角色报告(与 Python tabs = [DATA_TAB_TITLE] + report_tabs() 同序)
  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'data', label: '采集数据' },
    ...roles.map((r) => ({ id: r.stateKey!, label: r.tabTitle! })),
  ];

  const activeReports = a.events.filter(
    (e): e is Extract<PipelineEvent, { type: 'report' }> => e.type === 'report' && e.key === activeTab,
  );
  const activeRole = roles.find((r) => r.stateKey === activeTab);
  const progress = a.events.filter((e): e is Extract<PipelineEvent, { type: 'progress' }> => e.type === 'progress');
  // 菜单定位:menuSize(onLayout 实测)齐备后经 menuGeometry 约束(右缘 clamp/
  // 高度不足上翻);首帧未实测时退化为锚点原始定位,onLayout 随即回填
  const menuPos = menuAnchor && menuSize ? menuGeometry(menuAnchor, menuSize, width, height) : null;

  // 调试/自动化钩子(headless 验证用;不参与正常交互)。
  // 只挂载一次:依赖数组空 + ref 转发,避免无依赖数组的 effect 每帧重建闭包
  // (每帧一次 → 几百次/分钟的无意义分配,且一旦将来在里面 setState 就是死循环)。
  const debugRef = React.useRef({ start: a.start, ticker, market, setActiveTab, a });
  debugRef.current = { start: a.start, ticker, market, setActiveTab, a };
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    // SAFETY: window 在 web/RN 都存在但无只读索引签名;__soa 仅调试钩子,
    // 写入不改变 window 的已有形状(读回时同样走 Record 路径)
    const g = window as unknown as Record<string, unknown>;
    const prev = g.__soa as { token?: unknown } | undefined;
    if (prev && prev.token === SOA_HOOK_TOKEN) return; // 同实例已安装(不重复覆盖)
    g.__soa = {
      token: SOA_HOOK_TOKEN,
      start: () => void debugRef.current.start(debugRef.current.ticker, debugRef.current.market),
      switchTab: (id: TabId) => debugRef.current.setActiveTab(id),
      getState: () => {
        const s = debugRef.current.a;
        return { finalDecision: s.finalDecision, eventCount: s.events.length, running: s.running, partials: s.partials, statuses: s.statuses };
      },
    };
  }, []);

  return (
    <View style={styles.root}>
      <StatusBar style="auto" />
      {/* 标题行:☰ 汉堡按钮(抽屉开关)+ 标题 */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Pressable
            style={styles.hamburger}
            onPress={() => drawer.toggle()}
            hitSlop={8}
            accessibilityLabel={!drawer.isOpen ? '打开菜单' : '关闭菜单'}
            accessibilityRole="button"
            aria-expanded={drawer.isOpen}
          >
            <Text style={styles.hamburgerIcon}>☰</Text>
          </Pressable>
          <Text style={styles.heading} numberOfLines={1} ellipsizeMode="tail">{THEME_HEADING}</Text>
        </View>
      </View>

      {/* ticker 表单(首页最显眼,对齐 Python 主区表单;S5 三市场输入) */}
      <View style={styles.form}>
        <Text style={styles.formLabel}>输入股票代码（沪深A股 / 港股 / 美股）</Text>
        <View style={styles.formRow}>
          <TextInput
            style={styles.tickerInput}
            value={ticker}
            onChangeText={setTicker}
            placeholder={`${DEMO_TICKER} / 00700 / AAPL`}
            maxLength={10}
            autoCapitalize="characters"
          />
          {/* 市场下拉面板:手动选市场(默认沪深A股) */}
          <View style={styles.marketSelectWrap}>
            <Pressable
              ref={marketButtonRef}
              style={styles.marketSelect}
              onPress={() => {
                // 测量按钮在窗口中的位置,供 Modal 全屏层定位菜单浮层
                marketButtonRef.current?.measureInWindow((x, y, width, height) => {
                  setMenuAnchor({ x, y, width, bottom: y + height });
                  setShowMarketMenu(true);
                });
              }}
              accessibilityLabel="选择市场"
              // a11y#15:显式 button 角色 + 展开态(读屏可发现开合)
              accessibilityRole="button"
              aria-expanded={showMarketMenu}
            >
              <Text style={styles.marketSelectText}>
                {MARKET_CHOICES.find((c) => c.value === market)?.label ?? '沪深A股'}
              </Text>
              <Text style={styles.marketSelectCaret}>▾</Text>
            </Pressable>
          </View>
          <Pressable style={[styles.startButton, a.running && styles.buttonDisabled]} disabled={a.running} onPress={() => { setShowMarketMenu(false); void a.start(ticker, market); }}>
            <Text style={styles.startButtonText}>{a.running ? '分析中…' : '开始分析'}</Text>
          </Pressable>
          {/* 取消:唯一的「卡住也能自己停」出口。之前 running 时开始按钮 disabled,
              又没有 cancel → 网络断流/LLM 无超时的挂起只能靠重启 App。 */}
          {a.running ? (
            <Pressable style={styles.cancelButton} onPress={a.cancel} accessibilityRole="button" accessibilityLabel="取消分析">
              <Text style={styles.cancelButtonText}>取消</Text>
            </Pressable>
          ) : null}
        </View>
        {/* 悬浮下拉:菜单经下方 RN Modal portal 渲染(见 Modal 注释);与全屏点击层均未设
            zIndex —— 命中顺序靠 DOM 顺序(点击层先渲染、菜单后渲染 → 菜单区域可命中) */}
        <View>
          {/* 市场徽标(S5):start() 归一化后 market 已知;有结果/错误/上次分析时展示 */}
          {a.lastRunAt || a.error || a.stockInformation ? (
            <View style={styles.marketBadgeRow}>
              <Text style={styles.marketBadge}>{marketInfo(a.market).label}</Text>
            </View>
          ) : null}
          {gateNotice ? <Text style={styles.warn}>⚠ {gateNotice}</Text> : null}
          {a.lastRunAt && !a.running && !a.viewingRun ? (
            <Text style={styles.info}>
              已显示上次分析结果 · {new Date(a.lastRunAt.at).toLocaleString()} · {a.lastRunAt.mode === 'real' ? '真实 LLM' : '演示模式'}
            </Text>
          ) : null}
          {a.error ? <Text style={styles.error}>✗ {a.error}</Text> : null}
        </View>

      </View>

      {/* 市场下拉菜单:用 RN Modal(transparent)渲染,portal 到 root 层,确保在 web/原生
          都盖住表单内容(修复 RN-web 层叠上下文中警告文字压在卡片上的 bug);全屏透明
          点击层负责点外关闭。菜单卡片不透明浮层,定位在触发按钮下方。 */}
      <Modal
        visible={showMarketMenu}
        transparent
        // web:RNW ModalAnimation fade-out 期全屏 pointerEvents:none 容器保留 ~250ms,
        // 菜单区可视但点击穿透(ghost-click 落到市场按钮 → 菜单重开)→ web 禁动画;
        // native fade 走系统层动画无此问题,保留观感(design §4)。
        animationType={Platform.OS === 'web' ? 'none' : 'fade'}
        onRequestClose={() => setShowMarketMenu(false)}
      >
        {/* 全屏透明点击层:点菜单外区域关闭 */}
        <Pressable style={styles.marketModalRoot} onPress={() => setShowMarketMenu(false)} accessibilityLabel="关闭市场选择" />
        {/* 菜单浮层:定位到按钮下方,尺寸不足时上翻(右缘 clamp/翻转见 menuGeometry) */}
        <View
          pointerEvents="box-none"
          onLayout={(e) => setMenuSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
          style={[
            styles.marketModalMenu,
            menuAnchor
              ? {
                  left: menuPos?.left ?? menuAnchor.x,
                  top: menuPos?.top ?? menuAnchor.bottom + MENU_GAP,
                  minWidth: menuAnchor.width,
                }
              : null,
          ]}
        >
          {/* 菜单容器 listbox 语义(a11y#15):选项组对读屏暴露为可选择列表 */}
          <View style={styles.marketMenuInner} role={'listbox' as Role}>
            {MARKET_CHOICES.map((c) => {
              const active = c.value === market;
              return (
                <Pressable
                  key={c.value}
                  // a11y#15:选项 role=option + aria-selected 标记当前选中
                  role="option"
                  aria-selected={active}
                  style={[styles.marketOption, active && styles.marketOptionActive]}
                  onPress={() => {
                    setMarket(c.value);
                    setShowMarketMenu(false);
                  }}
                >
                  <Text style={[styles.marketOptionText, active && styles.marketOptionTextActive]}>{c.label}</Text>
                  {active ? <Text style={styles.marketOptionCheck}>✓</Text> : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>

      {/* 主体:左侧抽屉(菜单 → 设置/历史二级页)+ 内容区 */}
      <View style={styles.main}>
        {drawer.isOpen ? (
          <>
            {/* 窄屏:抽屉改覆盖式(绝对定位 + 遮罩),不再挤占内容区宽度 */}
            {drawerOverlay ? (
              <Pressable style={styles.drawerBackdrop} onPress={() => drawer.close()} accessibilityLabel="关闭菜单" />
            ) : null}
            <View testID="drawer" style={[styles.sidebar, { width: drawerWidth }, drawerOverlay && styles.sidebarOverlay]}>
              {drawer.page === 'menu' ? (
                <>
                  <View style={styles.sidebarHeader}>
                    <Text style={styles.sidebarTitle}>菜单</Text>
                    <Pressable onPress={() => drawer.close()} hitSlop={8} accessibilityLabel="关闭菜单" accessibilityRole="button">
                      <Text style={styles.sidebarClose}>✕</Text>
                    </Pressable>
                  </View>
                  <Pressable style={styles.menuItem} onPress={() => drawer.showSettings()} accessibilityRole="button" accessibilityLabel="设置">
                    <Text style={styles.menuItemIcon}>⚙</Text>
                    <Text style={styles.menuItemLabel}>设置</Text>
                    <Text style={styles.menuItemChevron}>›</Text>
                  </Pressable>
                  <Pressable style={styles.menuItem} onPress={() => drawer.showHistory()} accessibilityRole="button" accessibilityLabel="历史分析">
                    <Text style={styles.menuItemIcon}>↺</Text>
                    <Text style={styles.menuItemLabel}>历史</Text>
                    {a.history.length ? <Text style={styles.menuItemBadge}>{a.history.length}</Text> : null}
                    <Text style={styles.menuItemChevron}>›</Text>
                  </Pressable>
                </>
              ) : drawer.page === 'settings' ? (
                <>
                  <View style={styles.sidebarHeader}>
                    <Pressable onPress={() => drawer.showMenu()} hitSlop={8} accessibilityLabel="返回菜单" accessibilityRole="button">
                      <Text style={styles.sidebarBack}>←</Text>
                    </Pressable>
                    <Text style={[styles.sidebarTitle, styles.sidebarTitleGrow]}>设置</Text>
                    <Pressable onPress={() => drawer.close()} hitSlop={8} accessibilityLabel="关闭菜单" accessibilityRole="button">
                      <Text style={styles.sidebarClose}>✕</Text>
                    </Pressable>
                  </View>
                  <SettingsPanel onSettingsChange={a.onSettingsChange} />
                </>
              ) : (
                <HistoryPanel
                  history={a.history}
                  loading={a.historyLoading}
                  error={a.historyError}
                  viewingId={a.viewingRun?.id ?? null}
                  running={a.running}
                  // R-22:PRD R5 只要求「在当前报告 Tab 内打开该次运行」——
                  // 不再顺手改写表单 ticker(静默改用户输入)也不再强切 Tab。
                  onOpen={(id) => {
                    drawer.close();
                    void a.openRun(id);
                  }}
                  onDelete={(ids) => void a.deleteRuns(ids)}
                  onClear={() => void a.clearHistory()}
                  onBack={() => drawer.showMenu()}
                  onClose={() => drawer.close()}
                  onRefresh={() => void a.refreshHistory()}
                />
              )}
            </View>
          </>
        ) : null}
        <View style={styles.contentColumn}>
          {/* 历史查看条:任何 Tab 都可见;返回最新 = 点开前的实时态 */}
          {a.viewingRun ? (
            <View style={styles.historyBar}>
              <Text style={styles.historyBarText} numberOfLines={1}>
                正在查看历史 · {formatRunTime(a.viewingRun.at)} · {a.viewingRun.ticker}
              </Text>
              <Pressable onPress={a.closeRun} accessibilityRole="button" accessibilityLabel="返回最新结果">
                <Text style={styles.historyBarAction}>返回最新</Text>
              </Pressable>
            </View>
          ) : null}
          {/* 主 Tab 条(采集数据 + 角色报告) */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar}>
            {tabs.map((t) => {
              const active = t.id === activeTab;
              return (
                <Pressable key={t.id} style={[styles.tab, active && styles.tabActive]} onPress={() => setActiveTab(t.id)} accessibilityRole="tab" accessibilityState={{ selected: active }}>
                  <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* 角色状态条:每启用角色一 chip(待运行/分析中/完成/重试中);
              信息面分析师未启用 → 不在 roles 中,自然不渲染 */}
          <View style={styles.statusBar}>
            {roles.map((r) => {
              const st = r.reviseNodeName && a.statuses[r.reviseNodeName]
                ? a.statuses[r.reviseNodeName] // opinion 角色取修订节点(最新阶段)
                : a.statuses[r.nodeName];
              const label = st === 'running' ? '分析中' : st === 'done' ? '完成' : st === 'retry' ? '重试中' : '待运行';
              const color = st === 'done' ? theme.colors.ok : st === 'retry' ? theme.colors.warn : st === 'running' ? theme.colors.primary : theme.colors.textSecondary;
              return (
                <View key={r.nodeName} style={[styles.statusChip, { borderColor: color }]}>
                  <Text style={[styles.statusChipText, { color }]}>{r.tabTitle} · {label}</Text>
                </View>
              );
            })}
          </View>

          {/* 进度区(所有 Tab 可见;替换语义,对齐 Python updatable_container)。
              D15 整体门控:运行中显示最新进度行;仅成功终态(!running && hasDone)
              才显示「✓ 分析完成」;失败运行(error 终态 hasDone=false)整块不渲染
              ——外层容器一并门控,避免渲染空的带边框横条。 */}
          {progress.length > 0 && (a.running || a.hasDone) ? (
            <View style={styles.progressBar}>
              {a.running ? (
                <Text style={styles.progressLatest}>⏳ {progress[progress.length - 1].message}</Text>
              ) : (
                <Text style={styles.progressLine}>✓ 分析完成({progress.length} 步)</Text>
              )}
            </View>
          ) : null}

          {/* 内容(N-3:错误边界仅包内容区——DataScreen/ReportContent 渲染崩溃降级
              为错误卡+重试;App 壳/设置侧边栏不被边界捕获)。CR-35:key 随 Tab 变化
              ——否则一次崩溃后切到其他 Tab 仍停在错误卡,必须手点重试。 */}
          <ErrorBoundary key={activeTab} theme={theme}>
            <View style={styles.content}>
              {activeTab === 'data' ? (
                <DataScreen stockInformation={a.stockInformation} dataVersion={a.dataVersion} ticker={a.lastRunTicker} market={a.market} />
              ) : activeRole ? (
                <ReportContent
                  key={activeRole.stateKey!} // F43:按角色 remount → 展开态不跨 看涨/看跌 tab 泄漏
                  roleKey={activeRole.stateKey!}
                  opinion={activeRole.opinion === true}
                  tabTitle={activeRole.tabTitle!}
                  reports={activeReports.map((e) => ({ key: e.key, content: e.content }))}
                  finalDecision={a.finalDecision}
                  partials={a.partials}
                  statuses={a.statuses}
                  nodeName={activeRole.nodeName}
                  reviseNodeName={activeRole.reviseNodeName}
                />
              ) : null}
            </View>
          </ErrorBoundary>
        </View>

      </View>
    </View>
  );
}

// ── 市场菜单几何(D4/D5)───────────────────────────────────────
// 菜单在透明 Modal 全屏层内绝对定位,坐标为窗口坐标(vw/vh 取 useWindowDimensions)。
// 全部尺寸/位置计算集中于此:① 右缘 clamp(窄窗时菜单不右溢);② 视口高度不足
// 时上翻到按钮上方。不选 maxHeight 截断:RNW Modal 无滚动条,截断会把选项裁掉
// 不可选;上翻在常规短视口(按钮距顶 ≥ 菜单高 + 边距)下完整保留三个选项。
const MENU_GAP = 4; // 菜单与按钮/视口边缘的间距(px),原内联字面量

/** 覆盖式抽屉的触发宽度(dp):窄于此值 → 抽屉脱离文档流占满右侧(不挤内容区)。
 *  单一阈值 —— 之前「<900 强制关抽屉 + <720 改覆盖式」两套阈值中间夹着
 *  720–900 的夹缝,抽屉在夹缝里只能挤内容区;现在全程只有一种布局切换。 */
const DRAWER_OVERLAY_MAX_WIDTH = 760;

/** 抽屉宽度:只跟视口成比例,不写死 dp。
 *  窄屏(覆盖式):88% 视口,上限 360(平板上不至于整屏只剩一条缝);
 *  宽屏(占位式):28% 视口,clamp 320–420(小窗口留够内容区,大屏不拉成巨栏)。 */
function drawerWidthFor(width: number): number {
  if (width < DRAWER_OVERLAY_MAX_WIDTH) return Math.round(Math.min(width * 0.88, 360));
  return Math.round(Math.min(Math.max(width * 0.28, 320), 420));
}

function menuGeometry(
  anchor: { x: number; y: number; width: number; bottom: number },
  menu: { width: number; height: number },
  vw: number,
  vh: number,
): { left: number; top: number } {
  // 右缘 clamp:left ≤ vw - 菜单宽 - 边距;菜单比视口还宽 → 退化贴左缘
  const maxLeft = Math.max(MENU_GAP, vw - menu.width - MENU_GAP);
  const left = Math.min(anchor.x, maxLeft);
  // 默认放按钮下方;下方放不下 → 上翻;上方也不够(极端短视口)→ 贴顶,底部裁切可接受
  const belowTop = anchor.bottom + MENU_GAP;
  const top =
    belowTop + menu.height <= vh
      ? belowTop
      : Math.max(MENU_GAP, anchor.y - menu.height - MENU_GAP);
  return { left, top };
}

function makeStyles(theme: Theme, insets: EdgeInsets) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    header: { paddingHorizontal: theme.spacing.lg, paddingTop: insets.top + theme.spacing.lg, paddingBottom: theme.spacing.sm, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
    headerRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
    historyBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.md, paddingVertical: 6, backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
    historyBarText: { flex: 1, fontSize: 12, color: theme.colors.text },
    historyBarAction: { fontSize: 12, fontWeight: '700', color: theme.colors.primary },
    // 窄屏覆盖式抽屉:遮罩 + 贴左浮层(不占布局宽度)
    drawerBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.25)', zIndex: 19 },
    sidebarOverlay: { position: 'absolute', top: 0, left: 0, bottom: 0, zIndex: 20, elevation: 8 },
    hamburger: { paddingVertical: 2, paddingRight: 2 },
    hamburgerIcon: { fontSize: 22, color: theme.colors.text, lineHeight: 24 },
    // minWidth:0 + flexShrink:窄屏(安卓竖屏 ~411dp)标题+☰ 按钮总宽超屏时
    // 标题让位并省略号截断 —— 否则按钮被推出屏外不可点(11-04 真机实测)
    heading: { flexShrink: 1, minWidth: 0, fontSize: 24, fontWeight: '800', color: theme.colors.primary, letterSpacing: 0.5 },
    form: { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.colors.border, backgroundColor: theme.colors.surface },
    formLabel: { fontSize: 13, color: theme.colors.text, marginBottom: theme.spacing.sm },
    formRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
    tickerInput: { flex: 1, backgroundColor: theme.colors.background, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.sm, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: theme.colors.text, maxWidth: 220 },
    marketSelectWrap: { position: 'relative', justifyContent: 'center' },
    marketSelect: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: theme.colors.background, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.sm, paddingHorizontal: 10, paddingVertical: 10, minWidth: 92 },
    marketSelectText: { fontSize: 13, color: theme.colors.text, fontWeight: '600' },
    marketSelectCaret: { fontSize: 10, color: theme.colors.textSecondary },
    marketModalRoot: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'transparent' },
    // D5:maxWidth 与右缘 clamp 同源;3 个短标签下菜单宽 ~110px < 280,无视觉变化
    marketModalMenu: { position: 'absolute', maxWidth: 280 },
    marketMenuInner: { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.sm, elevation: 4, shadowColor: theme.colors.shadow, shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, paddingVertical: 2 },
    marketOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 9 },
    marketOptionActive: { backgroundColor: theme.colors.background },
    marketOptionText: { fontSize: 13, color: theme.colors.text },
    marketOptionTextActive: { color: theme.colors.primary, fontWeight: '700' },
    marketOptionCheck: { fontSize: 12, color: theme.colors.primary, fontWeight: '700' },
    startButton: { backgroundColor: theme.colors.primary, borderRadius: theme.radius.sm, paddingHorizontal: 24, justifyContent: 'center' },
    startButtonText: { color: theme.colors.onPrimary, fontWeight: '700', fontSize: 15 },
    cancelButton: { borderWidth: 1, borderColor: theme.colors.error, borderRadius: theme.radius.sm, paddingHorizontal: 16, justifyContent: 'center' },
    cancelButtonText: { color: theme.colors.error, fontWeight: '700', fontSize: 15 },
    buttonDisabled: { opacity: 0.5 },
    warn: { color: theme.colors.warn, fontSize: 12, marginTop: theme.spacing.sm },
    marketBadgeRow: { flexDirection: 'row', marginTop: theme.spacing.sm },
    marketBadge: { alignSelf: 'flex-start', backgroundColor: theme.colors.primary, color: theme.colors.onPrimary, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2, fontSize: 11, fontWeight: '700', overflow: 'hidden' },
    info: { color: theme.colors.textSecondary, fontSize: 12, marginTop: theme.spacing.sm },
    error: { color: theme.colors.error, fontSize: 12, marginTop: theme.spacing.sm },
    main: { flex: 1, flexDirection: 'row' },
    contentColumn: { flex: 1 },
    tabBar: { flexGrow: 0, flexWrap: 'wrap', backgroundColor: theme.colors.background, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
    statusBar: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.xs, borderBottomWidth: 1, borderBottomColor: theme.colors.border, backgroundColor: theme.colors.surface },
    statusChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2 },
    statusChipText: { fontSize: 11, fontWeight: '600' },
    tab: { paddingHorizontal: 16, paddingVertical: 10 },
    tabActive: { borderBottomWidth: 2, borderBottomColor: theme.colors.primary },
    tabText: { fontSize: 14, color: theme.colors.textSecondary },
    tabTextActive: { color: theme.colors.primary, fontWeight: '700' },
    progressBar: { paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.xs, borderBottomWidth: 1, borderBottomColor: theme.colors.border, backgroundColor: theme.colors.surface },
    running: { color: theme.colors.warn, fontWeight: '700', marginBottom: 2, fontSize: 12 },
    progressLine: { fontSize: 11, color: theme.colors.textSecondary, marginRight: 14 },
    progressLatest: { color: theme.colors.primary, fontWeight: '600' },
    content: { flex: 1 },
    // 抽屉在左侧:描边画右边(原来误画左边,和内容区之间出现双线)
    sidebar: { borderRightWidth: 1, borderRightColor: theme.colors.border, backgroundColor: theme.colors.surface },
    sidebarHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
    sidebarTitle: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
    // 二级页:标题占据中间,← 贴左、✕ 贴右
    sidebarTitleGrow: { flex: 1 },
    sidebarBack: { fontSize: 16, color: theme.colors.textSecondary, paddingHorizontal: 4 },
    sidebarClose: { fontSize: 16, color: theme.colors.textSecondary, paddingHorizontal: 4 },
    // 一级菜单行:图标 + 标签(+ 历史条数) + ›
    menuItem: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.md, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
    menuItemIcon: { fontSize: 16, minWidth: 22, textAlign: 'center', color: theme.colors.text },
    menuItemLabel: { flex: 1, fontSize: 14, fontWeight: '600', color: theme.colors.text },
    menuItemBadge: { fontSize: 11, fontWeight: '700', color: theme.colors.primary, borderWidth: 1, borderColor: theme.colors.primary, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' },
    menuItemChevron: { fontSize: 18, color: theme.colors.textSecondary },
  });
}
