# 设计:整改切片与跨切片契约

> 依据:prd.md + findings_verified.md(每项的证据/锚点/严重度研判均引用其结论,不再重复)。

## 1. 任务形态

单任务、8 并行实现切片(非父/子树):一个用户交付物(整改收尾),切片是设计级分解,各自有独立验收面但共享同一变更集。切片并行期**禁止互相编辑共享文件**(下表所有权),也禁止中途跑测试(集成期串行)。单任务、**串行修复单元**(非父/子树;用户裁决:禁并行)。下表切片表仍作为「修复单元分组/文件所有权」参考——单元按序执行,任意时刻单写者;单元间门禁 = 全量回归 + 独立 commit(见 implement.md U1-U32)。单元执行期**禁止互相编辑共享文件**(下表所有权),也禁止中途跑测试(集成门禁串行)。

## 2. 切片表与文件所有权

| # | 切片 | 项 | 唯一所有权文件(只允许本片写) | 只读引用(可 import,勿写) |
|---|---|---|---|---|
| 1 | FixCoreEvents | C1, C2, C3 | src/events.ts, app/lib/runner.ts, src/store-idb.ts, test/events.test.ts | app/hooks/useAnalysis.ts(只读) |
| 2 | FixAnalysisHook | E1, D9, D15, C1-去重侧 | app/hooks/useAnalysis.ts(+新增 app/lib/分析控制器.ts / 新测试文件) | app/lib/runner.ts, src/events.ts(只读) |
| 3 | FixDataSource | B1, B2-残余, B3, B4, E9, E4-测, E5-测 | src/yahoo/**, app/lib/proxies.cjs, test/yahoo-collect.test.ts, test/proxies.test.ts | app/server.mjs(只读) |
| 4 | FixSecCI | A3, A4, A5, A6 | .github/workflows/release.yml, desktop/package.json, tools/configure-android-signing.mjs, desktop/child.mjs, desktop/main.mjs(如需), app/server.mjs | — |
| 5 | FixAppMenu | D1, D2-ghost, D4, D5, D12-1, a11y#15, D15-消费侧 | app/App.tsx(应用 #2 暴露的 hasDone 字段), .trellis/spec/guides/cross-platform-thinking-guide.md | app/hooks/useAnalysis.ts(只读,消费 hasDone) |
| 6 | FixAppMisc | D6, D7, D8, D11, D13, D14 | app/screens/SettingsPanel.tsx, app/lib/settings.ts, app/screens/DataScreen.tsx, app/components/ReportContent.tsx, app/components/IndicatorChart*.tsx, app/modules/soa-keepalive/** | — |
| 7 | AddTestGaps | E2, E3, E6, E11-测 | test/** 新增文件(不加到被 #1/#3/#8 所有的测试文件) | src/store-*.ts(只读) |
| 8 | CleanDocsHygiene | E7, E8, E10, E11-文档 | src/committee.ts, src/gates.ts, src/switches.ts(如需), src/market.ts, test/store-gates.test.ts, test/market.test.ts, .trellis/spec/ts/hk-us-data.md, .trellis/spec/ts/agents-tools.md, .trellis/spec/ts/chart-ui.md | — |

**冲突规则**:任何片在动文件前先 `git status`/读 ownership 表;自己所有权之外的文件 → 只读。写错所有权 = 返工整批。

## 3. 跨切片契约(必须遵守)

- **C1 契约**(#1 改,#2 消费):`runner.run` 对运行期错误**只 emit 'error' 事件,绝不 rethrow**;事件含错误对象。`useAnalysis`(由 #2)捕获函数仅保留防御性日志,**不重复 banner**(唯一 banner 来自 error 事件监听)。`test/events.test.ts:118-129`(#1)改为断言「error 事件 + 不抛」。
- **C2 契约**(#1 改,#2 受益):`runner.run` 并发时(已有在跑)**emit error('running'/'busy') 并直接返回**,不得启动第二个 pipeline、不得交错事件;`useAnalysis.start()` 不再自加 running 守卫(UI `disabled={a.running}` 保持,#2 不得重复实现);`__soa.start` 最终也受 runner 保护。
- **hasDone 字段**(#2 暴露,#5 消费):useAnalysis 暴露 `hasDone: boolean` — `done` 事件后 true;`start()` 开始时 / error 事件后 false。App.tsx 的「✓ 分析完成」改为 `hasDone` 条件(替代 `!running && progress.length>0`)。
- **B1 设计**(#3):所有 Yahoo 链 fetch 包 AbortController(超时 40s < 504 定时器 45s);RN/Hermes 兼容按 rn-runtime.md(polyfill 或手写 setTimeout+abort);**504 定时器与「settle 后释放锁」语义不变**(proxies.test.ts 的 504→429→200 逻辑不受影响);server.mjs 不加 requestTimeout(A6 只管 Host)。
- **E9 统一**(#3):`proxies.cjs` isYahooMarket → try/catch 包 `src/yahoo/webYahooCollect.ts` 的 yahooMarketOfTicker(行为等价:布尔谓词)。
- **E7 死导出**(#8):`makeInvestmentDecision`/`envDisabledBool`/`overviewNeedsRefresh`/`FetchScope` 四个符号删除;**store-gates.test.ts 中覆盖 overviewNeedsRefresh/FetchScope 的用例必须同步删除**;switches.ts 对 envDisabledBool 的提及为注释,确认后不改语义。
- **E1 可测化**(#2):优先**不新增依赖**的路径 — 把 useAnalysis 编排抽成可控注入的控制器(仿 runner/events 测试模式);若 react-test-renderer 已在仓库依赖中可用,允许 hook 级测试,否则控制器纯 TS 测试。
- **架构断言**:所有片不得引入 src 对 react-native/`node:`(除 store-node)/meta 键裸字面量/process.env 写入等七断言违规;新增日志一律走 src/log.ts。

## 4. 关键修复决策(逐项)

- **C1 方向**:契约(error-handling.md:26-40)权威 → 代码改到不抛;`events.test.ts:118-129` 与代码同改;若发现 `runner.run` 调用方依赖 throw(除 useAnalysis catch),按调用方清单逐个适配(全部是 error 事件监听路径,预计无第三方)。
- **C2 位置**:守卫放 `runner.run`(层级正确,UI 层守卫不可信);busy 以错误事件上报保证 UI 可感知。
- **C3**:`store-idb.ts close()` 改为先 `await flush()` 再清队列;若 close 现为同步签名,评估改 async 对唯一调用方(测试 teardown)的影响并适配;若存在同步契约依赖,降级为「同步 close: 触发 flush promise + 标记 closed」,以源码为准。
- **D1/D4/D5/D2-ghost 同批**(#5):菜单定位改为「open 时测量 + web 窗口尺寸变化时重测」;右/下 clamp(视口几何)+ maxHeight;web `animationType='none'`(平台判定走 src/log.ts detectPlatform,禁手写 typeof);maxWidth 与 clamp 同 styles 对象。
- **D6**:SettingsPanel 用 mounted ref + 请求序号(token)忽略过期结果;setState 均先查 mounted。
- **D11**:Kotlin SoaKeepAliveModule.start 前,Android 13+ 且 activity 可用时 `requestPermissions`(POST_NOTIFICATIONS);拒绝/不可用 → 保活照常(FGS 通知不可见是可接受降级),失败细节经现有通道暴露(不新增静默)。
- **D14**:IndicatorChart 以容器实测宽(useWindowDimensions/onLayout)传 createChart,或按 echarts 版本启用 autoSize;native WebView 分支不动。
- **E8**:仅按 findings_verified.md 指出的事实改措辞(§7 与代码一致 = 去一前导零 + 注明多前导零差异;agents-tools.md:49 改为 useAnalysis.ts:329-330;chart-ui.md:21 补 market 参数)。
- **B3**:修改点 = `applyYahooCollectedToStore.putStock`(单一入口);旧值有限且新值为 NaN/缺失 → 保留旧值;文档注释说明「degrade 不破坏已有好数据」。
- **B4**:`prevCloseOf` 在 lastIsToday && bars<2 时返回 null(与 CN 一致 → change_pct NaN),composeOver 已把 null prevClose 做 NaN 处理(证据 :138)。

## 5. 兼容性

- RN/Hermes:超时/平台判定遵守 rn-runtime.md 与 src/log.ts 单一来源;不新增 polyfill 需求(先查现有 polyfill 族)。
- 测试超时:5s 默认对 mock-LLM 全链路偏紧(并行即假失败)→ AddTestGaps(#7)可同时把 3 个套件的 `testTimeout` 上调(如 10s,仅 vitest 配置/文件级),属防假失败治理。
- 零新依赖承诺:除非 prd Out of Scope 被推翻。

## 6. 回滚形状

每切片独立 commit(可单点 revert);集成验证门后若有回归,按 commit 边界回退单片。C1 契约改动独立 commit(风险最高,最先回滚)。git revert 不冲突(切片文件互斥)。
