# 实施计划:审计整改(父)

## 执行顺序

1. **规划完成**:本父 prd/design 已定契约;7 子任务 prd 已填充(引用本设计)。
2. **批量派发 7 个 trellis-implement 子任务**(一个 task batch,并行):
   - 每个子任务读:父 design.md(契约 + 文件归属)+ 子 prd + 相关审计 research(archive/2026-08/08-16-modularity-audit/research/)。
   - 全部 **skip 验证/commit**(父统一)。
3. **子任务完成后,父任务统一验证**(验证矩阵见 design.md):
   - 根 vitest(含子任务新增单测)
   - app tsc + 根 tsc(基线 3 错误)
   - web bundle 去死链实证(生产 export 产物 grep node-tdx-market)
   - web 冒烟(启动/恢复/拦截)
   - 模拟器:重编 debug APK(含 safe-area-context)→ 安装 → 恢复路径 → **一次真实分析**(collect-refactor 回归门)
4. **交叉审查**:reviewer 视角检查子任务改动是否越界/漏契约(git diff 按文件归属表核对)。
5. **提交**:子任务各自 commit(已在子任务 prompt 中禁止,改为父统一)—— 更优:父验证通过后按子任务边界分 7 个 commit(每个子任务一个),最后父整合 commit。
6. **收尾**:`task.py finish` + archive(父+7 子)+ 会话记录。

## 子任务规格速查(详细契约在 design.md)

| 子 | 动作要点 | 新增文件 | 新增测试 |
|---|---|---|---|
| collect-refactor | useAnalysis:36 动态 import deviceCollect(Platform.OS!=='web' 时 await import);采集分支收敛为按平台选 MarketCollector 实现;freshness 门抽 resolveSkipGates(runner:73-85 + deviceCollect:60-82 共用);useAnalysis:40 log import 直连 src/log.ts | src/collector.ts | resolveSkipGates 单测 + collector 选择单测 |
| dead-code-cleanup | 删 ReportScreen.tsx;删 runner CFG_KEY/readSavedConfig/saveConfig/clearConfig;删 app/assets/chart-view.html(或 .gitignore 加条目);删 app/lib/log.ts(先改 settings.ts:7 直连 src/log.ts;useAnalysis:40 由 collect-refactor 改——**本子不动 useAnalysis**) | — | 无(删除) |
| probe-unify | log.ts 导出 detectPlatform(已有);runner.ts:30 store 选择 + webSearch.ts:79 改复用;删本地探针 | — | detectPlatform 复用单测(web/node/rn 三分) |
| constants-single-source | billionsTools 导出默认常量;settings DEFAULT_CAPS import;metaKeys.ts 新增 DEMO_F10_KEY/f10Key/capitalKey/DEMO_TICKER;替换 runner:50/useAnalysis:122/DataScreen:26,34/webCollect:55,65 字面量;App.tsx:25,84 与 useAnalysis:71,94,124 的 '600036' → DEMO_TICKER | src/metaKeys.ts | metaKeys 使用单测(键模板)+ caps 单源一致性测试 |
| chart-maintainability | src/chartLayout.ts paneTops 公共函数;IndicatorChart:217-224 / FinancialTrendChart:67-74 改引用;app/package.json 加 chart:build(生成)+ chart:check(重生成后 diff 校验)script;build-chart-view.mts fallback 注释标注"与 theme.ts light 对齐" | src/chartLayout.ts | paneTops 单测 |
| ios-safe-area | `npx expo install react-native-safe-area-context`(app/);App.tsx useSafeAreaInsets 替换 RNStatusBar.currentHeight;移除 RNStatusBar import;Android 布局不变(验证:模拟器无回归) | — | 无 |
| rn-env-keys | webSearch:82 → EXPO_PUBLIC_TAVILY_API_KEY ?? TAVILY_API_KEY;deviceCollect:29 → EXPO_PUBLIC_TDX_HOST ?? TDX_HOST ?? 默认;.env.example 注释文档 | — | env 读取单测(注入) |

## 验证命令

```bash
npx vitest run
cd app && npx tsc --noEmit
cd .. && npx tsc --noEmit   # 基线 3 错误(亿信/mcp AbortSignal),不得新增
cd app && npm run web      # 或 expo export --platform web:产物 grep node-tdx-market
# 模拟器:gradle 重编 + adb 安装 + 恢复冒烟 + 一次真实分析
```

## 回滚点

- 每个子任务独立 commit → 单子回滚互不影响。
- collect-refactor 的 commit 是最大回滚风险点(双平台加载路径)。
- ios-safe-area 的依赖添加若出问题:revert 子 commit 即移除依赖。

## 提交前检查(父)

- [ ] 7 子任务全部完成,file 归属表核对无越界
- [ ] 验证矩阵全绿
- [ ] 审计清单(00-summary.md"现在做"全部 + 跨平台前维护项)逐项关闭
- [ ] 按子任务边界 7 个 commit + 父整合 commit
- [ ] 任务树归档
