# 1.0.0 发版前评审 — 基线 `87e22f3..HEAD(6a49756)`

> **流程**：5 个只读 reviewer 分区并行（标准 / 运行时正确性 / 发版门禁 / 测试覆盖 / 文档自述核对），
> 再由 2 个 evidence-auditor 逐条**尝试推翻**。审计裁决：**VERIFIED 9 · NUANCED 8 · REFUTED 1**
> （REFUTED 是 reviewer 凭空推断 `app/android/` 未忽略 —— 实际在 `app/.gitignore` 里）。
>
> **范围**：上一轮全量评审 `87e22f3` 之后的 32 个提交、65 个文件、+3775/−962。
> **门禁现状**：root `tsc` 0 error、app `tsc` 0 error、`vitest` **909 passed / 1 skipped**。
> **结论：4 条阻断项已全部修复并各带一条会失败的回归用例（见 §1 的 ✅）。
> 可以打 `v1.0.0`。剩余 P2/P3 见 §2/§3，不挡发版。**

---

## 1. 阻断项（4 条，修完再打 tag）

### B1 · README 的「发版步骤」会让 tag 构建直接红 —— VERIFIED ✅ 已修

> 已修：README 发版步骤改为**四处** `version` + 新增 `node tools/derive-version-code.mjs`
> 一步（`test/app-config.test.ts` 的断言就是这步的强制点）。

- **位置**：`README.md:124-125`；`release.yml:90-93`；`test/app-config.test.ts:22`
- **实情**：README 只让改 **3 个** `version`（`desktop/package.json` / `app/package.json` /
  `app/app.json`），但 tag 门禁 `verify()` 校验 **4 个**文件（多一个根 `package.json`）；
  更关键的是 `npm test` 跑在 derive 步骤**之前**，而 `app-config.test.ts:22` 断言
  `versionCode === deriveVersionCode(version)` —— `1.0.0 → 10000 ≠ 113` → test job 红。
- **后果**：照文档执行 `git tag v1.0.0` → `test` job 失败 → desktop/android/publish 全不跑。
  失败得很响（不会错发），但**唯一一条写下来的发版路径是坏的**。
- **修**：README 发版步骤改成 4 个文件 + 补一步 `node tools/derive-version-code.mjs`。
  **~5 分钟，纯文档。**

### B2 · 看门狗在采集/情报阶段超时后，仍会启动完整 LLM 分析 —— VERIFIED ✅ 已修

> 已修：两处阶段边界改为 `if (this.timedOut || seq !== this.runSeq) return;`。
> 回归用例 `test/analysis-controller.test.ts`「看门狗在采集段到期 → 采集返回后不得
> 再启动 runner」；把 `|| this.timedOut` 去掉即红（已实测）。

- **位置**：`app/lib/analysisController.ts:219`（onTimeout）、`:563`、`:593`、`:614`
- **实情**：`onTimeout` 置 `timedOut`、`abort()`、`finishRun()`，但**不动 `runSeq`**。
  于是超时那一刻还在 `await d.collect(...)` 的 `start()` 继续往下走：
  `if (seq !== this.runSeq) return`（`:563`）**通过** → 重臂 300s → 跑 intel → `:614`
  `runner.run({ runTag: seq })` 起一条全新的委员会流水线。该链路所有事件被
  `eventReduce` 的 `ctx.timedOut` 门丢掉，只有最后那个 `done` 会落地。
- **后果**：用户看到「已 300 秒无进展，已中止」，几分钟后却弹出这份「已中止」的报告
  （且真的烧了 token）；期间点重试会撞 `runner.run` 的忙守卫，
  横幅变成「上一次分析仍在进行中」，而界面上什么都没有在跑。
- **触发**：采集或情报段 > 300s。代码自己的注释承认「TDX 逐 host 重试可能合法地跑几分钟」（`:576`）。
- **修**：两处阶段边界加 `|| this.timedOut`：
  `if (this.timedOut || seq !== this.runSeq) return;`（`:563`、`:593`）。
  不能改成递增 `runSeq` —— 会破坏「超时后真 `done` 仍要落地」。
  **~15 分钟。**

### B3 · `loadError` 在写入成功后从不清除 → 一次坏文件，之后每轮分析都报「数据损坏」 —— VERIFIED ✅ 已修

> 已修：`loadError` 字符串改为 `readFailures: Map<文件名, 原因>`，写成功后只删该
> 文件的记账（只清当前股票，不掩盖别的股票仍坏着）。回归用例
> `test/store-file.test.ts`「写成功后只清该股票的读侧记账」；删掉那行 `delete` 即红。

- **位置**：`src/store-file.ts:201`（唯一复位点在 `hydrate()` 内）、`:257`（getter）；
  `app/lib/analysisController.ts:711-714`
- **实情**：`readyPromise` 是 memo 的，`hydrate()` 一次进程只跑一回；写入成功分支只清
  `persistError`，**没有 `loadError` 的对应清理**。而 `finishDone` 每轮 `done` 都重读一次。
- **后果**：启动时任何一个被截断/无权限的文件，会让**此后每一次**分析都以「✓ 分析完成 +
  红色数据损坏横幅」收尾，只能靠重启或改设置清掉 —— 用户没法把它和当前故障区分开。
- **修**：写成功处补 `this.loadError = null;`。**~10 分钟。**

### B4 · P1-1 的跨运行污染修复没有被任何测试钉住 —— VERIFIED ✅ 已修

> 已修：`test/events.test.ts` 加两例 ——「每个事件都带调用方给的 tag」与
> 「abort 后重开，两条运行各自带自己的 tag」。第二例专门钉「`runTag` 被提升到
> 模块作用域」这种改法（B 一开跑就会把 A 的后续事件冒充成 B 的 tag）。
> 实测：删掉 `emit({ ...e, runTag })` 的 spread → 两例全红。

- **位置**：`src/events.ts:172`（`emitRun` 打 `runTag` 的**唯一**一处）；
  `test/analysis-controller.test.ts:722`（测试里 tag 是自己造的）
- **实情**：`test/` 里出现 `runTag` 的只有 controller 测试，且那里的 harness 用
  `tags[i] = opts?.runTag` **自己造** tag、再手搓事件。`test/events.test.ts` 只断言 `e.type`。
- **后果**：把 `runTag`/`emitRun`/`makeUpdater` 提到模块作用域（正是 `:125-126` 注释写的
  原始 bug），或删掉 `{ ...e, runTag }` 这个 spread → **906 个测试全绿**，
  被取消那轮的迟到 `token`/`done` 重新落进下一轮的正文与归档。
- **修**：`test/events.test.ts` 加一例：`run({runTag:7})` → 断言每个事件都带 `runTag 7`；
  再补「A 中途 abort、起 B，A 的迟到事件仍带 A 的 tag」。**~20 分钟。**

---

## 2. 应修（P2，可与 1.0.0 同批或紧随其后）

| # | 项 | 位置 | 裁决 |
| --- | --- | --- | --- |
| S1 | `release.yml` 的 test job 不是它自称的「与 ci.yml 相同门禁」：缺 `chart:check` / `e2e:web` / `secret-scan` | `release.yml:31-74` vs `ci.yml:79-133` | **NUANCED**（ci 只在 master push 上跑，master 上的 tag 已经过了这些门；缺口只在「tag 打在 CI 没见过的提交上」时生效） |
| S2 | `android-e2e.mjs` 的超时环境变量不校验：`"30m"` → `NaN` → 首次轮询就报「分析未完成」 | `tools/android-e2e.mjs:166` | **VERIFIED**（与它刚修掉的两类假失败同型） |
| S3 | 新广播单元 `AnalysisNotifier` 零测试，而它的注入口径是「测试用」却无人消费 | `app/lib/analysisNotifier.ts:18-19` | **VERIFIED**（删掉 `if (this.timer !== null) return;` 一行，每个 token 都广播 —— P1-6 的卡顿回归，测试全绿） |
| S4 | `historyLoading` 可能永久卡 true：`closeRun()` 无条件递增 `historySeq` 却不复位 loading | `historyController.ts:136,176-188` | **VERIFIED**（窗口窄：载入中点了「开始分析」） |
| S5 | 合并节流的唯一断言是 `setTimeout(200)` 真实睡眠，且只证明「来了一帧」不证明「N token → 1 帧」 | `test/analysis-controller.test.ts:754` | **VERIFIED** |
| S6 | 「删除后列表快照复活」的代数门**自认没有可区分用例** | `historyController.ts:114`；`test/analysis-controller-history.test.ts:504-507` | **VERIFIED**（守卫是搬过来的，没带新测试） |

---

## 3. 记录项（P3，不挡发版）

- **AAB 验签是空检查**：`jarsigner -verify "$aab" | tail -5` 丢掉退出码、不看证书 DN，然后无条件 `echo OK`。
  当前被同 job 的 APK `apksigner` 门掩盖（两者同一个 signingConfig），一旦 APK 门改动就露出来。
  → 改成 grep 证书 DN，2 行。
- **无回滚文档**：README 发布章节没有回滚流程；唯一记过的「删 tag 重推」其安全性前提是
  「publish 还没跑」。公开发布之后该怎么办，没写。
- **本地三个 `*-1.0.0.apk/.aab/.exe` 是 0.1.13 芯**（`app/app.json` 仍 0.1.13/113）：
  已 gitignore，CI 看不到；但**人工上传这个 apk 就会把 0.1.13 当成 1.0.0 发出去**。
  真正发版只能走 tag 流水线，或先 `aapt dump badging` 确认 `versionCode=10000`。
- 抽取后遗留的孤儿注释 2 处（`analysisController.ts:56-63`、`billionsTools.ts:24-25`）；
  `ViewingRunMarker` / log 接口在 controller 与 historyController 各声明一份（单向静默漂移）；
  `analysisController.ts:494` 两条语句挤在一行；`desktop/package.json` 缺 `license`；
  隐私政策里 3 行权限（`POST_NOTIFICATIONS` / `FOREGROUND_SERVICE*` / `WAKE_LOCK`）实际从未申请。

---

## 4. 自述核对（`docs/code-review-2026-11-09.md` §0/§8）

| 声明 | 裁决 | 说明 |
| --- | --- | --- |
| `a737685` concurrency | **HOLDS** | ci 取消旧 run，release 刻意不取消 |
| `a737685` APK 签名门 | **HOLDS** | tag 上检出 `CN=Android Debug` 即 `exit 1` |
| `a737685` 全平台安装包断言 | **HOLDS** | 按 `RUNNER_OS` 断尺寸，空或过小 `exit 1` |
| `2f9aa8d` P1-4「发布门禁 = CI 门禁」 | **PARTIAL** | 缺 chart:check / e2e:web / secret-scan（见 S1） |
| `9bdd6da` P1-1 runTag | **HOLDS**（代码）· 测试未钉住（见 B4） | |
| `f2a4f62` / `d3bbd21` / `65a3623` | **HOLDS** | publish 独立 job + `fail_on_unmatched_files` + 只读构建 job |
| B6 五个重构 | **HOLDS** | 文档写 730 行，实为 739 行（无关紧要） |
| R1-R4 | **HOLDS** | R4 三个 shim 测试确实存在（`net-shim-args` / `polyfill-parts` / `async-hooks-shim`） |
| `app/android/` 未忽略 | **REFUTED** | 在 `app/.gitignore` 里 |

---

## 5. 发版检查表（1.0.0）

1. 修 B1-B4，跑 root `tsc` + app `tsc` + `npm test`
2. 四个 `version` → `1.0.0`，`node tools/derive-version-code.mjs 1.0.0`（`versionCode` → 10000）→ 提交
3. `git tag v1.0.0 && git push origin master --tags`
4. Actions 确认 `test → desktop → android → publish` 全绿
5. Release 资产 `soa-1.0.0.apk` / `.aab` / 三个安装包都在，且
   `apksigner verify --print-certs soa-1.0.0.apk` 显示 `CN=SOA Release`
