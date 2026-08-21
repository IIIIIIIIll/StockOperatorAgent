# Implement: 窄屏主图图例修复执行计划

## 步骤

1. `app/components/IndicatorChart.tsx`
   - import `useWindowDimensions`;组件内 `const { width } = useWindowDimensions()`,
     `const narrow = width < 560`。
   - web 分支 JSX:图表相对容器上方渲染 `{narrow && LEGEND[0] 主图块}`(行内
     换行块:标题 + 9 chips);浮层 map 中 `i === 0 && narrow` 跳过。
   - makeStyles 增加 `mainLegendBlock`(row + flexWrap + gap + marginLeft 8 +
     paddingBottom 8)。
2. `tools/build-chart-view.mts`
   - CSS 增加 `.pane-label.inline`(position: static; max-width: none;
     flex-wrap: wrap; padding: 0 8px 8px;)。
   - JS:构建 label 时 `var narrow = window.innerWidth < 560`;pane 0 且窄屏 →
     `lab.classList.add('inline')` + `insertBefore(lab, chartWrap)`,否则原
     浮层路径。
3. 生成与校验:`npm run chart:build`(在 app/ 下)再 `npm run chart:check`。
4. 静态验证:`npm run typecheck`(根)+ `npm test`(根,现有 511)。
5. 浏览器验证:
   - `npx expo export --platform web` 重建 dist + `node server.mjs` 起服务
     (hub start)。
   - Chromium(devtools MCP):视口 375×667 → 分析 600036 → 截图 → inspect_image
     确认主图图例完整(EMA20/EMA60/BOLL)、不遮图;视口 1280 → 截图确认浮层
     原样。
6. 更新 spec(chart-ui.md:窄屏图例行为约定)+ journal。
7. 提交(代码 + 生成物 + spec 记录)。

## 回滚点

- 步骤 4 失败 → 修正后重跑;步骤 5 视觉不符 → 回到步骤 1/2 调整阈值或布局。
- 提交前任一验证失败不提交。
