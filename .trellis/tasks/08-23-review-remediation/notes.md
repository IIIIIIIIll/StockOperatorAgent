# Task Notes

## F2 手动双开验证记录(2026-08-23,FinalCheck)

desktop 层无 vitest(implement.md 预定验收形态为手动双开记录),实测环境
WSL2 + WSLg(DISPLAY=:0)、Electron 43.4.0(desktop/node_modules):

1. 启动实例 A:`cd desktop && ./node_modules/.bin/electron . --no-sandbox --disable-gpu`
   → 完整启动:`[main] child ready: http://127.0.0.1:45085`,renderer 载入
   (演示数据 5840 根日K + F10),进程树 7 个 electron 进程(含 child.mjs store 子进程)。
2. A 存活期间启动实例 B(同命令)→ **B 立即自行退出,exit code 0、耗时 <1s**
   ——`requestSingleInstanceLock()` 模块顶层失败 → `app.quit()`,先于 mkdir/spawn
   (main.mjs:73-75;whenReady 内 `if (!gotSingleInstanceLock) return` 双保险 :307)。
   对照语义:若无锁,B 会照常 spawn child 并开窗(不会自退)。
3. `second-instance` 聚焦分支:mainWindow 模块级引用在 createWindow 赋值、closed 置 null
   (main.mjs:68/:297-300);B 触发锁失败即 A 收到 second-instance(headless 下聚焦
   效果不可截图断言,handler 接线经代码走查确认)。
4. 清理:SIGTERM 主进程 → 全部 7 个 electron 进程退出(pgrep 复核为 0)。

结论:**AC2 PASS**(二次启动立即退出实证;聚焦 handler 代码走查确认)。
