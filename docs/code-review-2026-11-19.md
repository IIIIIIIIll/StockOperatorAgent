# Code Review 2026-11-19 —— 全仓（非 diff）

- 基线：`2da9740`；10 条只读 reviewer 子代理按 seam 并行审，父进程复核每条 P0/P1
- 原始分 lane 报告：`.scratch/review-r3/lanes/`（gitignored，本地留证）；
  **持久化台账见 [`docs/backlog.md`](./backlog.md)**（clone 后 lanes/ 会消失，以 backlog 为准）
- 门禁：`tsc --noEmit` 0 错；`vitest run` **1011 passed / 1 skipped**（审前 1008，新增 3 条回归）

## 结论

架构、Electron 加固、发布门禁、事件协议、时区/单位接线都是硬的。问题集中在**静默**：
静默错数（前复权、盘中 bar、`persistError`）与静默吞错（11 处 `catch {}` 无日志，
违反本仓 `error-handling.md` 自己的反模式条款）。

## P0 —— 前复权累计因子重复相乘（已修）

`src/adjust.ts` 旧实现把每轮累积的 `Π(r_1..r_k)` 乘进「已被 `Π(r_1..r_{k-1})` 缩过」
的前缀集合。因为前缀集合是**嵌套子集**（事件越老集合越小），结果老 bar 得到
`c0·Π r_m^(k-m+1)` 而非 `c0·Π r_m`。

实跑对拍（600036，5835 根 / 67 事件，独立参考实现）：

| 窗口 | 修前偏差 | 修后 |
|---|---|---|
| 最近 250 根（指标消费区） | 2.67% | 0.0000% |
| 最近 500 根 | 7.66% | 0.0000% |
| 第 N−1000 根 | 18.81 vs 32.13（−41%） | 一致 |
| 首根 | 0.0000 vs 1.5998（下溢） | 1.5998 |

**为什么测试没抓到**：`test/qfq.test.ts` 的 oracle 是 `test/fixtures/600036_daily.json#adjusted`，
由 Python `adjust.qfq_adjust` 导出，而 TS 是逐字节移植 —— **两处同错**，测试只证明移植忠实。
旧测试把早期成交量荒谬归因于「Python astype(int64) 溢出」，那其实是因子复合的症状。

修法：每个事件只乘自己的 `ratioPrice`/`ratioVol`（删掉 `factorPrice`/`factorVol`）；
测试改为**独立 oracle**（bar 主序、按「该日期之后的事件」逐条相乘，与实现结构相反）+
两个事件的手算回归用例；`test/live.integration.test.ts` 的比对目标由错值 oracle 换成
`fixture.raw`（探针职责是「服务器原始数据 ↔ 冻结夹具一致」）。

## 已修 P1

| 位置 | 缺陷 | 修法 |
|---|---|---|
| `src/webCollect.ts` | CN 链缺「盘中半根 bar」守卫：Yahoo 链有 `intradayBar` 三分支，CN 链把今天未收盘的 bar 写进 store 并把 `lastDataUpdate` 推到今天 → 当天剩余时间 `dailyFresh` 判新鲜，报告永远用残缺 bar | 复制三分支，`replaceDatas` 之后补一次 `putStock` 保持旧戳；`now` 可注入；新增「盘中不推进 / 收盘后可推进」两条测试 |
| `src/tdx/quoteClient.ts` | 四个 `catch` 静默降级，其中 `applyQfq` 抛错时**返回未复权价**、`fetchXdxrEvents` 抛错使复权变恒等（除权跳空直接进指标） | 四处各加 `warn`，含 ticker 与原因 |
| `src/store-file.ts` / `src/store-idb.ts` | `persistError` 是队列级单一 flag，被**任何**后续成功清空 → 一次分析 6+ 次写，ticker 写失败被 `setMeta` 成功掩盖，`analysisController` 读到 null，用户被告知「已保存」而盘上是旧数据 | 改成按目标记账（`ticker:<t>` / `meta:<k>`），只有同一目标再写成功才清除 |
| `app/lib/settings.ts:95` | `name in persisted` 对原始值抛 `TypeError`（盘上 `{"keys":"x"}` 就够）→ 被下层静默 catch 吞成「全部设置回默认」，明文 Key 一起丢 | `typeof persisted === 'object' && persisted !== null` 守卫 |
| `app/lib/settings.ts:98` | 持久化 `switches` 未归一：手改成 `"false"`（truthy 字符串）→ 能力静默开启；未知键回写 | 新增 `sanitizeSwitches`，只接受 boolean，未知键丢弃（与 keys 同口径） |
| `app/lib/settings.ts:103` | 读设置失败 `catch {}` 静默回默认，随后 `saveSettings` 把空默认写回盘 | `warn` + 保留文件不动 |
| `app/App.tsx` | 关掉角色开关后 `activeTab` 指向已不存在的角色，渲染分支 `activeRole ? … : null` → 内容区全白无提示 | `activeRole` 退回 `roles[0]`；一个都不剩时渲染「所有角色已停用」+ 指路文案；`activeReports` 同步按可用角色取 |
| `app/components/ReportContent.tsx` | 取消/失败后 `partial || fallback` 把半截草稿当报告渲染，chip 却写「待运行」 | `streamText` 增加 `stale`（有草稿、非运行中、无终稿）→ 卡头渲染「已中断：以下是未完成的草稿，非最终内容」 |
| `tools/web-e2e-hk.mjs:285` | `… \|\| /volume/i.test(ctx) \|\| true` —— `\|\| true` 让两个正则都是死代码，这条 check 永远打勾 | 删 `\|\| true`；顺带修 261 行 `/行业\nCommunication Services\|行业\n.+/` 的松散交替 |
| `test/architecture.test.ts` | 三条 import 契约正则漏副作用形态：`import 'node:fs';` 不含 `from`/`require(`/`import(`，直接放行（而 `app/index.ts:3` 就是这种写法） | 三条正则补 `|^\s*import\s+` 分支 |
| `.env.example` / `app/.env.example` | 示例教用户把计费 Key 放进 `EXPO_PUBLIC_*`，Expo 会原样内联进 `app/dist/*.js` 与 APK；只警告了 token（CR-59） | 两处加警示块：内联事实 + 托管时应改用服务端键走同源代理 |

## 已修 P2

- `src/retry.ts` 的取消链：`RetryOptions.signal` 早就在里面，但 `agents.ts` / `toolLoop.ts`
  两个调用点都没传 → 退避计时器与逐 chunk `throwIfAborted` 是死代码，取消后仍可能再打三次
  上游。现在按 `config.signal` 显式下传。
- `src/adjust.ts` 三处静默降级（分母非正、量因子非正、adjclose 全缺）补 `warn`；
  `applyYahooCollectedToStore` 同名路径同样有 `warn`。
- `src/store-file.ts` hydrate 的嵌套三元改为 `[META_FILE, LEGACY_META_FILE].find(...)`。

## 文档 vs 代码（已订正）

| 文档 | 原文错误 |
|---|---|
| `.trellis/spec/ts/events-streaming.md` | ① 称 abort「**不中断**在飞 LLM 请求」，实际 `src/events.ts` 已把 signal 塞进 RunnableConfig 且 `test/events.test.ts` 钉住真取消；② `roleStatus` 类型漏 `degraded`；③ 同源路由表漏 `/news-feed` |
| `.trellis/spec/error-handling.md` | 自己 prescribe 了被禁的第二日志出口 `console.error(...)`，代码已改 `logError` |
| `.trellis/spec/ts/web-e2e.md` | 仍把「错误终态后 chips 不复位」列为已知残留，`eventReduce` 早已清零（#96） |
| `.trellis/spec/ts/stores.md` | 桌面 StoreLike「11 个同步方法」→ 实为 10（`listStocks`/`listMetaKeys` 是 Node 侧具体类方法） |
| `.trellis/spec/ts/env-switches.md` | 人工白名单写「3 处直接访问」，实际 11 处；改为「凡 `process.env.EXPO_PUBLIC_*` 直接成员访问均豁免」并列出真实站点 |
| `.trellis/spec/ts/hk-us-data.md` | 称 `composeYahooReports`「QoQ 相邻期无 88-93 天门槛」，实际已按 `periods.gapKindOf` 门控 |
| `README.md` | `derive-version-code.mjs 1.1.0` 注释写 `11100`，公式是 `major*10000+minor*100+patch` → `10100` |

## 未修（判为不修或需产品决策）

| 位置 | 缺陷 | 为什么没动 |
|---|---|---|

- ~~`src/events.ts:268` abort 分支缺 `releaseRunning()`~~ —— **已修**：外部 `opts.signal`
  取消后 `running` 恒 true，后续 run 全被「上一次分析仍在进行中」永久拒绝。
  新增测试`外部 signal 取消后必须释放并发守卫`（去掉修复即红，已双向验证）。
| `src/toolLoop.ts:118` | 工具输出进 context 无上限（15 轮不截断） | 需要定一个截断上限与降级文案的产品决定 |
| `app/lib/settings.ts` 明文落盘 | 设置文件是明文，含 API Key | 已在注释里承认；改成加密存储是独立特性 |
| `src/store-node.ts` | tmp+rename 缺 fsync（断电场景不是真原子）、tmp 残留不清理 | 现状对进程崩溃足够；断电级 durability 需另立任务 |

其余 40+ 条 P2（东财 `Promise.race` 不 abort、TDX socket 空错误监听、F10 截断静默解码、
`webSearch` region 在浏览器分支丢失、snippet 按索引错位配对、meta 单文件全量重写、
日志换行未净化、`runHistory` 预览吃掉负号、`N/A%`、颜色判据不一致、`warn` 色对比度
3.3:1、控制器订阅无 dispose、`makeStyles` 每帧重建、三份 lockfile 版本 1.0.0、
`tools/*.mjs` 不进 typecheck 等）见 [`backlog.md`](./backlog.md)——
`.scratch/review-r3/lanes/` 是 gitignored 的本地证据，换机器后只剩 backlog 这份台账。

## 复查方式

```bash
npx tsc --noEmit                       # 0 error
npx vitest run                         # 1010 passed / 1 skipped
npx vitest run test/qfq.test.ts        # 独立 oracle + 两事件手算回归
node --experimental-transform-types .scratch/verify-qfq2.mts   # 5835 根对拍(0.0000%)
```

`test/fixtures/600036_daily.json#adjusted` 是**错值**（Python 同款算法导出），保留仅为
历史物证，`live.integration` 与 `qfq.test` 都已不再拿它当真值。

## 端到端校验（2026-11-20，真网络 + 真 LLM）

产物全部重建（`expo export --platform web` + `./gradlew :app:assembleRelease`），
LLM 三键取自 `.env`：web 经 `node --env-file=.env` 注入 localStorage；Android
release 包不可 `run-as`，改用 uiautomator 驱动设置面板填入（脚本
`.scratch/inject-llm-keys.mjs`，保存时面板自检「✓ LLM 可达 2149ms, 回复 Pong」）。

| 链路 | 市场 | LLM | 耗时 | 检查 | console.error |
|---|---|---|---|---|---|
| `npm run e2e:web` | 沪深 600036 | 占位(demo) | ~30s | 5/5 | 0 |
| `npm run e2e:web:hk:llm` | 港股 00700 | 真 | 805s | 21/21 | 0 |
| `SOA_E2E_TICKER=AAPL … web-e2e-hk.mjs` | 美股 AAPL | 真 | 895s | 20/20 | 0 |
| `node tools/android-e2e.mjs` | 沪深 600036 | 真 | 743.9s | 10/10 | 0 FATAL |
| `node tools/android-e2e-hk.mjs` | 港股 00700 | 真 | 613.0s | 23/23 | 0 FATAL |

采集侧实测：港股 5540 根日K、代码规范化 00700 → 0700.HK、概览 27 键全有值、
换手率列有值、Google News 8 条均近期。

**两点经验**
1. 真 LLM 的 7 角色委员会单次 600–900s —— `web-e2e-hk.mjs` 的
   `ANALYZE_TIMEOUT_MS` 缺省 600s 会误判超时（首跑止步 6/7 角色）。
   跑真 LLM 请用 `SOA_E2E_ANALYZE_MS=1500000`。
2. `画像行业 chip` 不能钉死 `Communication Services`（那是 00700 的值，AAPL 是
   Technology）；改为「有值且不是 N/A」并在断言里打印实际值。
