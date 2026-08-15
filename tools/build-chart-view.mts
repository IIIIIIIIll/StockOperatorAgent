// tools/build-chart-view.mts
// ─────────────────────────────────────────────────────────────────────────
// 生成 app/assets/chart-view.html(独立多面板图渲染页,RN WebView 用)与
// app/lib/chartHtml.ts(同 HTML 的 TS 内联常量 CHART_HTML,组件 import 用)。
//
// 运行:node --experimental-transform-types tools/build-chart-view.mts
// 产物:
//   app/assets/chart-view.html   ~200KB(内联 lightweight-charts UMD 生产包)
//   app/lib/chartHtml.ts         CHART_HTML 模板字符串(转义后与 HTML 字节等价)
//
// ─── JSON 数据契约(window.__SOA_CHART_DATA__)──────────────────────────────
// RN 侧在 WebView onLoadEnd 后注入:
//   window.__SOA_CHART_DATA__ = <JSON>; window.renderChart && window.renderChart();
// 渲染器为通用多面板:蜡烛主图 + 各 pane 线/柱系列 + 页内图例,全部数据驱动。
//
// interface ChartViewData {
//   height: number;                       // 总图高 px(与 web 分支 CHART_HEIGHT 同值)
//   layout: {                             // 主题色(Theme.colors 映射)
//     background: string;                 //   背景(theme.colors.background)
//     text: string;                       //   刻度/图例文字(theme.colors.textSecondary)
//     border: string;                     //   网格/边框(theme.colors.border)
//   };
//   legend: Array<{                       // 图例组(web 分支 LEGEND 同构;空数据也渲染)
//     title?: string;                     //   分组标题(如「主图」;财务图缺省 → 单行 chips)
//     series: Array<{ label: string; color: string }>;
//   }>;
//   panes: Array<{                        // 面板(数组序 = pane 序;stretch 比例布局)
//     stretch: number;                    //   PANE_STRETCH[i](全部 series 建完后 setStretchFactor)
//     series: Array<{                     //   该面板系列(同 pane 多系列叠加)
//       type: 'candles' | 'line' | 'histogram';
//       title: string;                    //   系列名(契约/诊断用;图例 label 见 legend 组)
//       // candles:                       //   主图 K 线(web 分支 CandlestickSeries 同参)
//       upColor?: string;                 //     阳线色(theme.colors.up)
//       downColor?: string;               //     阴线色(theme.colors.down)
//       // line:                          //   线系列(web 分支 LineSeries:lineWidth 1)
//       color?: string;                   //     线色(C 常量)
//       lineStyle?: 0 | 1 | 2;            //     LineStyle 枚举:0 Solid / 1 Dotted / 2 Dashed
//       // histogram:                     //   柱系列(web 分支 HistogramSeries)
//       color?: string;                   //     柱默认色(逐点 color 覆盖)
//       base?: number;                    //     0 轴(涨跌幅/MACD 柱;缺省 0)
//       priceFormat?: 'volume';           //     成交量格式
//       data: Array<{                     //   数据点(与 web 分支 lineData/histData/蜡烛同构)
//         time: string;                   //     'YYYY-MM-DD'(lightweight-charts 业务日)
//         value: number;                  //     线/柱值
//         color?: string;                 //     逐点色(柱涨跌着色)
//         open?: number; high?: number; low?: number; close?: number; volume?: number;  // candles
//       }>;
//     }>;
//   }>;
// }
//
// 渲染器语义(镜像 IndicatorChart / FinancialTrendChart web 分支):
// - chart.addSeries(ctor, opts, paneIndex) 建系列(paneIndex = 数组序)
// - 全部系列建完后 chart.panes()[i].setStretchFactor(stretch);禁 setHeight
//   (Pane 初始 height=0,首帧布局前 setHeight 会以 totalHeight=0 重分配导致
//   高度错乱——见 .trellis/spec/ts/index.md 图表节)
// - crosshair Normal + time scale 缩放/平移 = 库默认开启,不关闭
// - 空 series/空 panes → 仅渲染图例,不建图(空数据不崩)
// - 图例由 legend 数据在页内渲染(原生分支不在 RN 侧重复渲染图例)
// ─────────────────────────────────────────────────────────────────────────
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'app/assets');
const LIB_DIR = resolve(ROOT, 'app/lib');

/** 定位 lightweight-charts UMD 生产包:app/node_modules 优先,根 node_modules 兜底 */
function findUmd(): string {
  const candidates = [
    resolve(ROOT, 'app/node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js'),
    resolve(ROOT, 'node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error(`找不到 lightweight-charts.standalone.production.js(试过:${candidates.join(', ')})`);
}

/** TS 模板字符串转义:反斜杠 → 双反斜杠,反引号 → \` ,${ → \${ */
function escapeTemplate(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

// 注意:模板内 JS 不用反引号/模板插值/反斜杠(保持 .mts 字面量安全);
// UMD 通过 __LWC_UMD__ 占位符运行时内联(replace 用函数形,防 $& 等替换语义)。
const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<title>SOA Chart View</title>
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
  #legend { padding: 8px 8px 0; display: flex; flex-direction: column; }
  .lg-row { display: flex; flex-wrap: wrap; align-items: center; margin-bottom: 4px; }
  #chart { width: 100%; }
  #pane-labels { position: absolute; left: 0; top: 0; right: 0; pointer-events: none; z-index: 10; }
  .pane-label { position: absolute; left: 8px; display: flex; align-items: center; gap: 10px; max-width: 92%; white-space: nowrap; overflow: hidden; opacity: .95; font-size: 11px; }
  .pane-label .pl-title { font-weight: 700; }
  .pane-label .pl-chip { display: inline-flex; align-items: center; gap: 4px; }
  .pane-label .pl-dot { width: 8px; height: 8px; border-radius: 4px; }
  .pane-label .pl-label { font-weight: 400; opacity: .85; }
  #empty { display: none; padding: 16px 8px; font-size: 12px; }
</style>
</head>
<body>
<div id="chart-wrap" style="position:relative">
  <div id="chart"></div>
  <div id="pane-labels"></div>
</div>
<div id="empty">暂无图表数据</div>
<script>__LWC_UMD__</script>
<script>
(function () {
  'use strict';
  var LWC = window.LightweightCharts;
  var currentChart = null; // 流式重渲染(重复 renderChart)时先移除旧实例,防堆积

  function lineStyleValue(v) {
    // LineStyle 枚举:0 Solid / 1 Dotted / 2 Dashed(与 IndicatorChart web 分支一致)
    return v === 1 || v === 2 ? v : 0;
  }

  function seriesCtor(type) {
    if (type === 'candles') return LWC.CandlestickSeries;
    if (type === 'histogram') return LWC.HistogramSeries;
    return LWC.LineSeries;
  }

  function renderChart() {
    // 重渲染安全:先清空 pane 标题叠加(与 #chart 平级,不受 chartEl.innerHTML='' 影响)
    var labelsEl = document.getElementById('pane-labels');
    labelsEl.innerHTML = '';
    var data = window.__SOA_CHART_DATA__;
    if (!data) {
      document.getElementById('empty').style.display = 'block';
      document.getElementById('chart').style.display = 'none';
      return;
    }
    // 主题文字色同步给页内文本(继承);图例随各 pane(见下方 pane 覆盖层)
    var layout = data.layout || {};
    var textColor = layout.text || '#6b7280';
    document.body.style.color = textColor;

    var chartEl = document.getElementById('chart');
    var emptyEl = document.getElementById('empty');
    var panes = data.panes || [];
    var hasData = false;
    for (var pi = 0; pi < panes.length && !hasData; pi++) {
      var sers = panes[pi].series || [];
      for (var si = 0; si < sers.length; si++) {
        if (sers[si].data && sers[si].data.length) { hasData = true; break; }
      }
    }
    if (!hasData || !LWC) {
      // 空 series/空 panes:仅渲染图例,不建图(空数据不崩)
      chartEl.style.display = 'none';
      emptyEl.style.display = 'none';
      return;
    }
    emptyEl.style.display = 'none';
    chartEl.style.display = 'block';
    var height = typeof data.height === 'number' ? data.height : 400;
    chartEl.style.height = height + 'px';

    // 重复渲染(流式数据更新)时先移除旧图表实例与其 canvas,防多次建图堆积
    if (currentChart) { currentChart.remove(); currentChart = null; }
    chartEl.innerHTML = '';
    var chart;
    try {
      chart = LWC.createChart(chartEl, {
        height: height,
        layout: {
          background: { type: LWC.ColorType.Solid, color: layout.background || '#FFFFFF' },
          textColor: textColor,
        },
        grid: {
          vertLines: { color: layout.border || '#e5e7eb' },
          horzLines: { color: layout.border || '#e5e7eb' },
        },
        timeScale: { borderColor: layout.border || '#e5e7eb' },
        rightPriceScale: { borderColor: layout.border || '#e5e7eb' },
        crosshair: { mode: LWC.CrosshairMode.Normal }, // 默认即开启;显式声明(缩放/平移不关闭)
      });
    } catch (err) {
      // 建图失败:退回图例-only(不抛给 WebView 宿主)
      chartEl.style.display = 'none';
      return;
    }
    currentChart = chart;

    for (var pi2 = 0; pi2 < panes.length; pi2++) {
      var pane = panes[pi2];
      var sers2 = pane.series || [];
      for (var si2 = 0; si2 < sers2.length; si2++) {
        var def = sers2[si2];
        var pts = def.data || [];
        if (!pts.length) continue; // 空序列跳过(不建 series)
        var opts = {};
        if (def.type === 'candles') {
          opts = {
            upColor: def.upColor,
            downColor: def.downColor,
            borderVisible: false,
            wickUpColor: def.upColor,
            wickDownColor: def.downColor,
          };
        } else if (def.type === 'histogram') {
          opts = { base: typeof def.base === 'number' ? def.base : 0, color: def.color };
          if (def.priceFormat === 'volume') opts.priceFormat = { type: 'volume' };
        } else {
          opts = { color: def.color, lineWidth: 1, lineStyle: lineStyleValue(def.lineStyle) };
        }
        var s = chart.addSeries(seriesCtor(def.type), opts, pi2);
        s.setData(pts);
      }
    }

    // 面板比例:全部 series 建完后设置 stretch(比例布局,与 web 分支同序;禁 setHeight)
    var paneApis = chart.panes();
    for (var k = 0; k < paneApis.length; k++) {
      paneApis[k].setStretchFactor(typeof panes[k].stretch === 'number' ? panes[k].stretch : 70);
    }

    // 面板标题叠加:每 pane 顶部左上角(标题 + 系列名);top 用**纯比例**定位
    // (stretch/总和 × 总高,与 setStretchFactor 布局语义一致)。不用
    // paneApis[k].getHeight()——真实 lightweight-charts v5.2 在 createChart 后
    // 立即读取返回未布局值(≈全高,2026-08-15 真机/Chromium 实测),导致附图
    // 标签全部堆到图表底部不可见。
    var sumStretch = 0;
    for (var k3 = 0; k3 < panes.length; k3++) {
      sumStretch += typeof panes[k3].stretch === 'number' ? panes[k3].stretch : 70;
    }
    var acc = 0;
    var tops = [];
    for (var k2 = 0; k2 < panes.length; k2++) {
      tops.push(acc);
      var st2 = typeof panes[k2].stretch === 'number' ? panes[k2].stretch : 70;
      acc += (height * st2) / sumStretch;
    }
    labelsEl.innerHTML = '';
    for (var pi3 = 0; pi3 < panes.length; pi3++) {
      if (pi3 >= tops.length) continue; // 防御:pane 数据缺失(理论不触发,stretch 循环同假设)
      var g2 = data.legend && data.legend[pi3];
      var sers3 = panes[pi3].series || [];
      var stitle = sers3.length ? (sers3[0].title || '') : '';
      var paneTitle = (g2 && g2.title) || stitle;
      // 图例 chips:组有标题(K线图)→ 用组 series(色点+label);无标题(财务图)→
      // 用 pane series,过滤 label==paneTitle 避免与标题重复
      var chips = [];
      if (g2 && g2.title) {
        chips = (g2.series || []).map(function (s) { return { color: s.color, label: s.label }; });
      } else {
        chips = sers3
          .filter(function (s) { return s.title && s.title !== paneTitle; })
          .map(function (s) { return { color: s.color, label: s.title }; });
      }
      if (!paneTitle && !chips.length) continue;
      var lab = document.createElement('div');
      lab.className = 'pane-label';
      lab.style.top = tops[pi3] + 'px';
      if (paneTitle) {
        var tt = document.createElement('span');
        tt.className = 'pl-title';
        tt.textContent = paneTitle;
        lab.appendChild(tt);
      }
      for (var ci = 0; ci < chips.length; ci++) {
        var chip = document.createElement('span');
        chip.className = 'pl-chip';
        var dot = document.createElement('span');
        dot.className = 'pl-dot';
        dot.style.backgroundColor = chips[ci].color;
        var l2 = document.createElement('span');
        l2.className = 'pl-label';
        l2.textContent = chips[ci].label;
        chip.appendChild(dot);
        chip.appendChild(l2);
        lab.appendChild(chip);
      }
      labelsEl.appendChild(lab);
    }
  }

  window.renderChart = renderChart;

  // 数据在文档加载前注入(injectedJavaScriptBeforeContentLoaded)时自动渲染;
  // 加载后注入(onLoadEnd + injectJavaScript)由 RN 侧显式调用 renderChart。
  if (window.__SOA_CHART_DATA__) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', renderChart);
    } else {
      renderChart();
    }
  }
})();
</script>
</body>
</html>
`;

function main(): void {
  const umdPath = findUmd();
  const umd = readFileSync(umdPath, 'utf8');
  const html = HTML_TEMPLATE.replace('__LWC_UMD__', () => umd);
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(LIB_DIR, { recursive: true });
  const htmlPath = resolve(OUT_DIR, 'chart-view.html');
  const tsPath = resolve(LIB_DIR, 'chartHtml.ts');
  writeFileSync(htmlPath, html);
  const ts =
    `// 由 tools/build-chart-view.mts 生成 —— 勿手改。\n` +
    `// app/assets/chart-view.html 的 TS 内联(React Native WebView source.html 用)。\n` +
    `// 数据契约见 tools/build-chart-view.mts 头部注释。\n` +
    `export const CHART_HTML: string = \`${escapeTemplate(html)}\`;\n`;
  writeFileSync(tsPath, ts);
  console.log(`chart-view.html: ${Buffer.byteLength(html)} bytes -> ${htmlPath}`);
  console.log(`chartHtml.ts:    ${Buffer.byteLength(ts)} bytes -> ${tsPath}`);
}

main();
