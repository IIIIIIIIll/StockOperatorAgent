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
  .lg-title { font-size: 11px; font-weight: 600; min-width: 56px; }
  .lg-chip { display: inline-flex; align-items: center; margin-right: 10px; }
  .lg-dot { width: 8px; height: 8px; border-radius: 4px; margin-right: 3px; }
  .lg-label { font-size: 10px; }
  #chart { width: 100%; }
  #pane-labels { position: absolute; left: 0; top: 0; right: 0; pointer-events: none; z-index: 10; }
  .pane-label { position: absolute; left: 8px; font-size: 11px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 85%; opacity: .92; }
  .pane-label .pl-series { font-weight: 400; opacity: .8; margin-left: 8px; }
  #empty { display: none; padding: 16px 8px; font-size: 12px; }
</style>
</head>
<body>
<div id="legend"></div>
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

  function renderLegend(data) {
    var legendEl = document.getElementById('legend');
    legendEl.innerHTML = '';
    var groups = (data && data.legend) || [];
    for (var gi = 0; gi < groups.length; gi++) {
      var g = groups[gi];
      var row = document.createElement('div');
      row.className = 'lg-row';
      if (g.title) {
        var t = document.createElement('span');
        t.className = 'lg-title';
        t.textContent = g.title;
        row.appendChild(t);
      }
      var items = g.series || [];
      for (var si = 0; si < items.length; si++) {
        var chip = document.createElement('span');
        chip.className = 'lg-chip';
        var dot = document.createElement('span');
        dot.className = 'lg-dot';
        dot.style.backgroundColor = items[si].color;
        var lab = document.createElement('span');
        lab.className = 'lg-label';
        lab.textContent = items[si].label;
        chip.appendChild(dot);
        chip.appendChild(lab);
        row.appendChild(chip);
      }
      legendEl.appendChild(row);
    }
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
    // 主题文字色同步给页内图例/占位文本(继承)
    var layout = data.layout || {};
    var textColor = layout.text || '#6b7280';
    document.body.style.color = textColor;
    renderLegend(data);

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

    // 面板标题叠加:每 pane 顶部左上角(标题 + 系列名);top 用 getHeight 累计
    // (禁 setHeight 后 getHeight 是唯一可靠高度源;v5.2 paneApis[k].getHeight() 存在)
    var acc = 0;
    var tops = [];
    for (var k2 = 0; k2 < paneApis.length; k2++) {
      tops.push(acc);
      acc += paneApis[k2].getHeight();
    }
    labelsEl.innerHTML = '';
    for (var pi3 = 0; pi3 < panes.length; pi3++) {
      if (pi3 >= tops.length) continue; // pane 全空时 paneApis 短于 panes(与 stretch 循环同假设)
      var g2 = data.legend && data.legend[pi3];
      var sers3 = panes[pi3].series || [];
      var stitle = sers3.length ? (sers3[0].title || '') : '';
      var paneTitle = (g2 && g2.title) || stitle;
      if (!paneTitle) continue;
      // 系列标签:图例组有标题 → 用图例组 label(镜像 web 分支);
      // 否则用该 pane 系列 title(财务图单系列 label==title 被过滤 → 无冗余副标签)
      var src = [];
      if (g2 && g2.title) {
        src = (g2.series || []).map(function (s) { return s.label; });
      } else {
        src = sers3.map(function (s) { return s.title; });
      }
      var subs = [];
      for (var li = 0; li < src.length; li++) {
        if (src[li] && src[li] !== paneTitle) subs.push(src[li]);
      }
      var lab = document.createElement('div');
      lab.className = 'pane-label';
      lab.style.top = tops[pi3] + 'px';
      var tt = document.createElement('span');
      tt.textContent = paneTitle;
      lab.appendChild(tt);
      if (subs.length >= 2) {
        var ss = document.createElement('span');
        ss.className = 'pl-series';
        ss.textContent = subs.join(' ');
        lab.appendChild(ss);
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
