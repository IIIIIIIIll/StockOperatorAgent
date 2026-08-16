# 实施计划:上次分析结果缓存与启动恢复

## 执行顺序

1. **`src/lastRun.ts`(新增)**:`LAST_RUN_KEY`、`LastRunRecord`、`saveLastRun`、`loadLastRun`(损坏→null)。复用 `FinalReport`/`Opinion`(`src/events.ts` 类型 import)。纯函数,不 import UI/平台。
2. **`test/last-run.test.ts`(新增)**:InMemoryStore 测例——round-trip 全字段;缺失键→null;损坏 JSON→null 不抛;二次 save 覆盖;demo/real mode 透传。参照 `test/store-gates.test.ts` 风格。
3. **`app/App.tsx` 接线(写)**:done 分支 `saveLastRun(store, report, modeRef.current, new Date().toISOString())` + `setLastRunAt`;`start()` 内 mode 计算处同步 `modeRef.current = mode`;新增 `modeRef`/`lastRunAt` state,`start()` 开头清 `lastRunAt`。
4. **`app/App.tsx` 接线(读)**:启动 effect `storeReady()` 后 `loadLastRun(store)` 分支(见 design.md 代码块),else 分支维持现状 demo 展示;`loadDemoData()` 保持无条件。
5. **标记 UI**:表单下方展示"已显示上次分析结果 · 时间 · 模式"行(`lastRunAt` 非空且非 running 时)。
6. **验证**:
   - `npx vitest run`(含新 last-run 测试)
   - `npx tsc --noEmit`
   - 浏览器冒烟(web):启动 → 无 key 演示分析 → 刷新 → 恢复展示 + 标记行可见 + 采集数据 Tab 为上次 ticker(AC7)
   - 冒烟通过后清理:无临时文件/日志残留
7. **spec 更新(Phase 3.3)**:`.trellis/spec/ts/index.md` 持久化段补一行 `soa:last-run` 键约定。
8. **提交(Phase 3.4)**:单次 commit,消息 `feat: 上次分析结果缓存与启动恢复`。

## 验证命令

```bash
npx vitest run
npx tsc --noEmit
# 冒烟:cd app && npm start(web),浏览器驱动分析→刷新→断言恢复
```

## 风险文件 / 回滚点

- `app/App.tsx`(459 行,唯一 UI 接线点):改动集中在启动 effect + subscribe effect + start() + 表单区;小步编辑。
- `src/lastRun.ts` / `test/last-run.test.ts` 全新文件,无回滚风险。
- 回滚:删除 lastRun 两文件 + 还原 App.tsx 三处改动。
- 禁用规则:不跑全量 e2e / 不动 store schema / 不动代理层。

## 提交前检查

- [ ] vitest 全绿(新增 last-run 用例覆盖 AC1/AC5 核心)
- [ ] tsc 全绿
- [ ] 冒烟完成:恢复路径 + 无缓存路径均验证
- [ ] 无遗留 TODO/console/debug 代码
