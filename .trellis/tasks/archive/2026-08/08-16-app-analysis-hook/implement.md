# 实施计划:App.tsx 抽取 useAnalysis hook

## 执行顺序

1. **建 `app/hooks/useAnalysis.ts`**(新目录 + 新文件):按 design.md 契约搬入状态/启动 effect/订阅 effect/`start(ticker)`/`onSettingsChange`;import 面:`src/events.ts`(PipelineEvent/FinalReport)、`src/progress.ts`(RoleStatus)、`src/committee.ts`(enabledRoles)、`./lib/runner`(runner/store/loadDemoData/collectForWeb/saveLastRun 等)、`./lib/settings`、`../src/tdx/deviceCollect`、`./modules/soa-keepalive`、`./lib/log`。
2. **改 `app/App.tsx`**:删搬走的代码,接入 `const a = useAnalysis();`,`start()` 调用改为 `start(ticker)`,渲染引用 `a.events` 等;保留 UI 状态/派生/`__soa`/渲染/样式。**只删只搬,不改逻辑**。
3. **类型门**:`cd app && npx tsc --noEmit`;`cd .. && npx vitest run`(不应有业务层测试变化)。
4. **diff 审查**:`git diff app/App.tsx` 逐段确认搬移等价(启动链顺序/错误文案/keepalive/双算注释)。
5. **web 冒烟(AC4)**:启动 dev server → 无缓存 demo 路径 → 注入种子缓存 → 刷新恢复路径(标记行/7 chips/报告 Tab)。完成后清种子缓存。
6. **模拟器冒烟(AC5)**:重启 App 恢复上次真实分析 → 跑一次真实分析验证 `start()` 全链路(采集→报告→done→缓存覆盖)→ force-stop 重启确认新缓存恢复。
7. **spec 更新**:`.trellis/spec/ts/index.md` 补一行 `app/hooks/` 目录约定(分析编排 hook 化,UI 渲染与逻辑分离)。
8. **提交**:`feat(refactor): 抽取 useAnalysis hook,App.tsx 瘦身为渲染层`。

## 验证命令

```bash
cd app && npx tsc --noEmit
cd .. && npx vitest run
# 冒烟见步骤 5-6(web 浏览器驱动 + adb 模拟器)
```

## 风险文件 / 回滚点

- `app/App.tsx`:唯一修改文件;步骤 2 后行数目标 ≤330。
- `app/hooks/useAnalysis.ts`:新文件,零回滚风险。
- 回滚:`git revert` 本任务 commit。
- 禁用规则:不跑全量 e2e、不动 `src/`、不引入新依赖、不顺手重构 start() 内部。

## 提交前检查

- [ ] app tsc 全绿(AC2)
- [ ] vitest 全绿(AC3)
- [ ] web 冒烟完成:demo 路径 + 恢复路径(AC4)
- [ ] 模拟器冒烟完成:重启恢复 + 真实分析跑通 + 缓存覆盖(AC5/AC6)
- [ ] diff 审查:搬移等价,无顺手改动
