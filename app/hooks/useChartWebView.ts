// 图表 WebView 的共享生命周期钩子(IndicatorChart / FinancialTrendChart 同源)。
// 解决两个真机独有的假死来源(实测 1/5 概率):
//   1) 渲染进程被杀:react-native-webview 在 onRenderProcessGone 里返回 true 保住进程,
//      但不会替换这个哑掉的 WebView(RNCWebViewClient.java:279-308)。App 继续往死渲染器
//      injectJavaScript,evaluateJavascript 走 UI 线程命令分发(RNCWebView.java:298-300),
//      整窗口共用一条 RenderThread → 画面停在最后一帧、点不动、滚不动,也不 ANR。
//      这里用递增 key 强制重挂,拿到全新渲染进程,onLoadEnd 再重新注入。
//   2) 锁屏期间注入堆积:渲染器在后台被暂停,后台期间的注入会堆到解锁瞬间集中重建
//      (chartHtml.renderChart 每次 remove()+createChart 整图重建)。改成只在前台注入,
//      回前台补一次。
// source 用模块级常量:同一引用任何渲染都不触发 native setSource;旧架构按引用 diff,
// 每次渲染新建 { html } 对象会 loadDataWithBaseURL 整页重载(Fabric 深比较不会,但语义上
// 也不该每次换对象)。
import React from 'react';
import { AppState } from 'react-native';
import { WebView } from 'react-native-webview';
import { CHART_HTML } from '../lib/chartHtml';

/** 常量 source:引用稳定,渲染多少次都不会让 native 侧重载页面。 */
const CHART_SOURCE = { html: CHART_HTML };

/** WebView 的命令式面(运行时由 forwardRef 暴露)。 */
export interface WebViewHandle {
  injectJavaScript(script: string): void;
  reload(): void;
  goBack(): void;
  goForward(): void;
  stopLoading(): void;
  postMessage(data: string): void;
}

// SAFETY: 上游 react-native-webview 14.0.1 把 WebView 声明成
// `React.FunctionComponent<WebViewProps>` —— props 里没有 ref,但运行时确实通过
// forwardRef 暴露命令式方法。TS 无法表达这个「声明缺失」,只能强转:保留上游
// props 形状,只补上真实存在的 ref 面。上游修好后删掉本段。
export const ChartWebView = WebView as unknown as React.ComponentType<
  React.ComponentProps<typeof WebView> & { ref?: React.Ref<WebViewHandle> }
>;

export interface ChartWebViewHandle {
  /** WebView 引用(injectJavaScript 用) */
  ref: React.RefObject<WebViewHandle | null>;
  /** 挂到 WebView 的 key:渲染进程死亡后递增,触发重挂 */
  key: number;
  /** 稳定的 source prop */
  source: { html: string };
  onLoadEnd: () => void;
  onRenderProcessGone: () => void;
}

/**
 * @param chartDataJson 已序列化的图表数据;空串表示无数据(不注入)
 */
export function useChartWebView(chartDataJson: string): ChartWebViewHandle {
  const ref = React.useRef<WebViewHandle | null>(null);
  const loadedRef = React.useRef(false);
  // epoch 作为 WebView 的 key:渲染进程死亡 → 重挂 → 新进程
  const [epoch, setEpoch] = React.useState(0);

  const injectData = React.useCallback(() => {
    if (!chartDataJson) return;
    ref.current?.injectJavaScript(
      `window.__SOA_CHART_DATA__=${chartDataJson};window.renderChart&&window.renderChart();`,
    );
  }, [chartDataJson]);

  // 数据变化:页面已加载且 App 在前台才注入(后台堆注入会在解锁瞬间炸成整图重建)
  React.useEffect(() => {
    if (loadedRef.current && AppState.currentState === 'active') injectData();
  }, [injectData]);

  // 回到前台补一次:后台期间跳过的注入在此追平,用户不必手动切 tab 才看到更新
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active' && loadedRef.current) injectData();
    });
    return () => sub.remove();
  }, [injectData]);

  const onLoadEnd = React.useCallback(() => {
    loadedRef.current = true;
    injectData();
  }, [injectData]);

  const onRenderProcessGone = React.useCallback(() => {
    // 死掉的 WebView 不可复用:重置加载标记并递增 key 触发重挂
    loadedRef.current = false;
    setEpoch((e) => e + 1);
  }, []);

  return {
    ref,
    key: epoch,
    source: CHART_SOURCE,
    onLoadEnd,
    onRenderProcessGone,
  };
}
