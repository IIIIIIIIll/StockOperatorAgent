# 桌面端开发 — 执行计划

## 实施顺序(依赖序)

1. **Spike:child strip-types 实证**(最先行,解除设计最大风险)
   - 安装 electron(desktop/package.json),`ELECTRON_RUN_AS_NODE=1` 跑 `--experimental-strip-types` 加载 `src/store-node.ts` 的探针脚本 → 通过后继续。
2. **服务层提取(纯 Node,可探针验证)**
   - `app/server.mjs`:`createAppServer()` 提取,serveStatic 保持导出。
   - `app/lib/logs-server.cjs`:`setLogDir(dir)` 显式注入。
   - `src/store-file.ts`:`FileStore.listStocks()`。
   - `tools/desktop-probe.mts` 扩展:listStocks + 快照 round-trip + store-op 应用断言。
3. **child 服务进程**:`desktop/child.mjs`(http server + store 服务 + settings 服务 + setLogDir;argv 收路径;ready 消息带端口+设置)。
4. **renderer 桥**:`app/lib/desktopBridge.ts`(DesktopStore 镜像 + 队列;bridgeStorage);`runner.ts` + `settingsStore.ts` 钩子(flag 门控)。
5. **Electron 壳**:`desktop/main.mjs`(窗口 + IPC + spawn/relay + quit 清理)、`desktop/preload.cjs`、`desktop/package.json`。
6. **构建与联调**:`expo export --platform web` → `npm start`(desktop/)→ WSLg 验证 AC1–AC4。

## 验证命令(每步)

- 单测回归:`npx vitest run`(根,405+ 用例,含 architecture.test.ts)
- 类型:`npx tsc --noEmit`(根)+ `cd app && npx tsc --noEmit`
- 探针:`node --experimental-transform-types tools/desktop-probe.mts`
- 桌面:`cd desktop && npm start`(WSLg;验证后截屏/日志留证)
- 退出检查:`pgrep -f desktop/child.mjs` 无残留

## 风险文件/回滚点

- `app/server.mjs`(导出重构)—— 回滚=git checkout 单文件;vitest serveStatic 用例守护
- `app/lib/runner.ts` / `app/lib/settingsStore.ts`(钩子)—— flag 门控,缺省惰性;浏览器/Android 回归靠 vitest + 现有探针
- `desktop/*` 全新目录 —— 整目录删除即回滚

## start 前检查

- [ ] prd/design/implement 三件套齐备,用户已批准最终规划总结
- [ ] implement.jsonl / check.jsonl 已含真实条目
- [ ] electron 版本锁定方案确认(desktop/package.json devDep 精确版本)
