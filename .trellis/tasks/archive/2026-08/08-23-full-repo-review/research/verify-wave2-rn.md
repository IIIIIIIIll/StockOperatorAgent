# Wave-2 复核:RN/App 切片 4 条(VerifyWave2RN)— 2026-08-23

**方法**:只读取证(read/grep/node_modules 源码),未运行 build/test/server。判定标准:`.trellis/spec/guides/index.md`(三类 FP:信任边界混淆/忽略设计注释/变量误读);每条均以 file:line + 引文独立取证,不转述第一波结论;双源发现(C1/AL1、D15/F1)亦逐条重验。
**HEAD**:e4d8680(master)。

## 总表

| 发现ID | 原判 | 复判定 | 严重度调整建议 | 一句话依据 |
|---|---|---|---|---|
| C1/AL1 AbortSignal.timeout | P1(CONFIRMED,双源) | **REFUTED**(机制不成立) | P1 → 无 bug;残留 **P3 文档注记** | expo@57 winter 运行时在 native 启动即给全局 AbortSignal 补上 `timeout` 静态方法——第一波漏了这一层 |
| D15 hasDone 未消费 | P2(双源) | **CONFIRMED** | 维持 P2 | App.tsx 零 hasDone 引用;完成横幅仍判 `!running && progress.length>0`;归档关闭表与 HEAD 直接矛盾 |
| TQ1 us+finnhub 绑定链零正向测试 | P2 | **CONFIRMED** | 维持 P2 | controller :341-344 绑定 + glue 三分派仅 :240 负向断言;`'us'` 在该测试文件零命中 |
| TQ2 child.mjs 校验器零测试 | P2 | **CONFIRMED** | 维持 P2 | desktop/ 无任何 test 文件;test/+tools/ 对校验表零引用 |

---

## 1. C1/AL1 —— billionsClient/mcp 用 `AbortSignal.timeout`,Hermes 恒 TypeError(P1)

### 复判定:**REFUTED**(核心机制「真机整体静默失效」不成立;调用点与部分前置证据属实)

### 属实的部分(逐条核过)

| 原证据 | 核验结果 |
|---|---|
| ① `src/billionsClient.ts:122-124` `_post` fetch init 内 `signal: AbortSignal.timeout(timeoutMs)` | ✅ 属实。且在 try 块内求值(:120-129):若 `AbortSignal.timeout` 缺失,TypeError 会先于网络请求抛出并被 catch 归一为 `BillionsApiError('亿信 API 请求失败：…')` |
| ② `src/mcp.ts:95` `signal: AbortSignal.timeout(this.timeoutMs)`;`:139` `AbortSignal.timeout(10_000)` | ✅ 属实。注意 :139 本就包在静默 catch 里(:141「通知失败不阻断握手」) |
| ④ `app/lib/polyfill.ts` 仅补 prototype.`throwIfAborted` 无 timeout 补丁 | ✅ 属实(:88-101),但**无关紧要**,见下 |
| ⑤ RN 全局 AbortSignal 来自 abort-controller 包,dist 无 timeout | ⚠️ 半属实:`app/node_modules/react-native/Libraries/Core/setUpXHR.js:41-44` 确以 `polyfillGlobal('AbortSignal', () => require('abort-controller/dist/abort-controller').AbortSignal)` 提供全局;但安装版本是 **abort-controller@3.0.0**(原报告写 1.x,版本有误);grep 该 dist `'timeout'` 确为零命中 |

### 决定性反证(第一波遗漏的层)

**expo@57.0.11 的 winter 运行时在 import 图内,native 平台启动时给全局 AbortSignal 补上 `timeout`/`any` 静态方法**。完整链路(每步实证):

```
app/index.ts:7        import { registerRootComponent } from 'expo'
  → expo package.json "main": "src/Expo.ts"(无 exports 字段,build/index.js 不存在,Met直接吃 TS 源)
  → node_modules/expo/src/Expo.ts:1      import './Expo.fx';
  → node_modules/expo/src/Expo.fx.tsx:2  import './winter';
  → node_modules/expo/src/winter/index.ts:1  import './runtime';
  → Metro 平台扩展解析 → winter/runtime.native.ts(native 生效)
      :6   import 'react-native/Libraries/Core/InitializeCore';   ← 先装 abort-controller 全局
      ~:31 installAbortSignalPatch(AbortSignal);
  → node_modules/expo/src/winter/AbortSignal.ts:9-11
      if (abortSignal.timeout == null) {
        defineAbortSignalStatic(abortSignal, 'timeout', timeout);
      }
```

- `runtime.native.ts` 头注自证其定位:「We must ensure that the core react-native globals are initialized before ours」→ 它就是设计为在 InitializeCore 之后对 RN 的 polyfill 面再打补丁。
- 补丁作用于**类对象静态**(非替换 global),与 `app/lib/polyfill.ts` 的 throwIfAborted(prototype 面)互补无冲突;billions/mcp 的调用发生在用户触发分析时,远晚于启动期补丁生效点。
- 排除干扰:app/metro.config.js 的 resolveRequest 只拦截 langsmith/node:/punycode/@langchain/langgraph,其余 fallthrough,不影响 expo 包内相对导入的平台扩展解析。

### 其余子断言

- **「web/Node 不受影响」✅**:现代浏览器原生 `AbortSignal.timeout`(2022 起);桌面 Electron **43.4.0**(desktop/package.json,内置 Node ≥22 原生支持)。web bundle 走 winter/runtime.ts 同样装补丁,更不受影响。
- **`src/yahoo/yahooClient.ts:67-69` 注释**「AbortSignal.timeout 静态 API 在 Hermes 未打补丁、不可靠」:相对当前依赖集(expo@57)**已失真**——正是任务书警示的「注释≠实证」。fetchWithTimeout 手写模式本身无害(任何平台都工作),仅注释前提过期。
- AL1 自带保留意见(agents-llm.md:52「需真机一次最小 repro 复验定谳」)是对的;C1 把它当已实证写进 P1 结论,超出了证据支撑面。

### 处置建议

1. 不修 billionsClient/mcp(功能在真机可用)。
2. **P3 文档注记**:更新 yahooClient.ts:67-69 注释(说明 expo@57 winter 已补 timeout 静态,手写模式保留理由=平台中立冗余而非 Hermes 缺失);可在 ts/rn-runtime.md 记一行依赖事实,防未来降级/移除 expo 时该结论复活无人知晓。

### 置信度:0.85
静态 import 图证据完整闭合;未能真机 repro(任务约束禁跑),扣 0.15。

---

## 2. D15 —— hasDone 生产链就绪但消费端未落地(P2,双源 verify-remediation + app-lib-ui F1)

### 复判定:**CONFIRMED**

### 证据

**(a) 生产链就绪、渲染层零消费**
- `app/lib/analysisController.ts`:162(初始 false)、290(start 重置)、451(`s.hasDone = true; // D15`)、455(`s.hasDone = false; // D15:error 终态撤销完成标记`)
- `app/hooks/useAnalysis.ts:53-54`:接口暴露 hasDone,注释「App『✓分析完成』消费,U16」
- `grep -n hasDone app/App.tsx` → **NO MATCH**;全仓命中仅 useAnalysis/analysisController/test/文档,渲染层 0 处

**(b) 完成横幅判据仍是 running 反相**
`app/App.tsx:269-275`(引文):
```tsx
{progress.length > 0 ? (            // :269
  <View style={styles.progressBar}>
    {a.running ? (                  // :271
      <Text style={styles.progressLatest}>⏳ {progress[progress.length - 1].message}</Text>
    ) : (
      <Text style={styles.progressLine}>✓ 分析完成({progress.length} 步)</Text>   // :274
    )}
</View>) : null}
```
判据 = `progress.length>0 && !running`,非 done 派生。

**(c) 失败运行两横幅同屏(机械推演成立)**
- error 事件归约:`s.error = e.error; s.hasDone = false`(analysisController.ts:452-455);finally:`s.running = false`(:409-411)
- 错误横幅独立渲染:App.tsx:166 `{a.error ? <Text style={styles.error}>✗ {a.error}</Text> : null}`
- ⇒ 失败且有 ≥1 条 progress 时,:274「✓ 分析完成(N 步)」与 :166 错误横幅**同时可见**——与上轮 D15 原始缺陷描述逐字相同

**(d) 归档关闭表 vs HEAD 矛盾**
- 归档 `.trellis/tasks/archive/2026-08/08-22-repo-review-remediation/findings_verified.md:159`:
  `| D15(U15 吸收) | U13 | 360681b | ✓分析完成仅 done 后显示 |` —— 与 HEAD App.tsx:269-275 **直接矛盾**
- 契约源头 archive/design.md:28 明确「App.tsx 的『✓ 分析完成』改为 hasDone 条件(替代 !running && progress.length>0)」;而 implement.md U16 范围只有 D1+D4+D5 —— 消费端在设计→实施交接中掉落,验收却按已关闭回填

### 严重度调整建议
**维持 P2**:纯 UX 影响(polish 级),但「声称已关闭而实际未关」属验收完整性缺口,verify-remediation 定 P2 的理由成立。修法两行级(App.tsx 三态:error 优先 / a.hasDone 才显 ✓ / 否则 null)。

---

## 3. TQ1 —— us+finnhub 采集绑定链(controller 绑定 + glue 三分派)零正向测试(P2)

### 复判定:**CONFIRMED**

### 证据

**(a) 被测分支属实**
- `app/lib/analysisController.ts:341-344`:
  ```ts
  const finnhub: { apiKey: string } | null =
    m === 'us' && s.settings.keys.finnhubApiKey.trim()
      ? { apiKey: s.settings.keys.finnhubApiKey.trim() }
      : null;
  ```
  采集入口 :353 `await d.collect(nt, m, finnhub)`
- `app/hooks/useAnalysis.ts:87-103` 三分派::89 webImpls.us 闭包捕获 finnhub 传入 collectForWeb opts;:91 `Platform.OS==='web'` → selectCollector('web');:94-97 `m==='us' && finnhub` → 动态 import deviceBridge 后 `collectYahooForDevice(ticker, undefined, finnhub)`;:102 else selectCollector('rn')

**(b) 测试面确无正向用例**
- `test/analysis-controller.test.ts` 中 finnhub 全部命中 = :70(recorder 类型)、:85-86(harness recorder)、:**240 `expect(h.collectCalls[0].finnhub).toBeNull(); // 非 us → 无 finnhub`**(位于 ticker='600036'/market='cn' 用例内,唯一断言且为负向)
- 同文件 grep `'us'` → **零命中**(无任何 us 市场 start 用例)
- 相邻层覆盖确认存在但不在被诉层:E4(test/yahoo-collect.test.ts:356-394,直调 collectYahooForDevice×finnhub 第三位参)、:505-576(直调 collectForWeb us+finnhub 合并)、collector.test.ts:94-121(selectCollector 注入 fake impls)——controller 真值表(us+key→trim 后非空 / 空 key 或 cn/hk→null)与 glue 闭包透传均无断言
- glue 不可测的结构性原因属实:useAnalysis.ts import react-native,根 vitest 无法加载(TQ1 已如实标注)

**(c) 影响逻辑复核**
绑定回归(trim 笔误/市场门写反/闭包漏捕获)→ finnhub=null → mergeFinnhubIndustry 早退(webYahooCollect.ts:21-24,warn 忽略)→ 美股 industry 富化静默消失,**无失败信号**。成立。

### 严重度调整建议
**维持 P2**(静默降级失效模式 + 刚整改过的回归高危区)。修法同 TQ1:controller 加 2 例(`start('AAPL','us')` 带 key → `collectCalls[0].finnhub` 非 null 且 trim 过;纯空白 key/cn → null)。

---

## 4. TQ2 —— desktop/child.mjs STORE_OP_VALIDATORS 零自动化测试(P2)

### 复判定:**CONFIRMED**

### 证据

**(a) 被测对象属实**(`desktop/child.mjs`)
- :170-211 `STORE_OP_VALIDATORS` 六 op 白名单(putStock/addDatas/replaceDatas/addPerformanceReports/updateOverview/setMeta),含 `isTicker` 路径分隔符拒绝(如 :178 「ticker must be a non-empty string without path separators」)
- :213-217 `checkStoreOpArgs`(unknown op 拒绝 + args 数组 gate + 分发)
- :250 op handler 入口 gate `const problem = checkStoreOpArgs(msg.op, msg.args); if (problem) throw …`;错误通道 :253-258(error+ack 分 tick 发送)

**(b) 测试缺位属实**
- glob `desktop/**/*.{test,spec}.*` → **NONE**(desktop 无任何 vitest/test 文件)
- grep `STORE_OP_VALIDATORS|checkStoreOpArgs|child.mjs|createChildForTest` 于 test/ + tools/ → **零命中**(根测试也未 import 校验表或拉起 child)

**(c) 回归风险双向成立**
误拒合法 op → 桌面全部写操作坏;漏放恶意形状 → A5 纵深(路径分隔符防御)静默失效。校验器为纯 Node ESM 可直接进根 vitest(TQ2 修法可行)。

### 严重度调整建议
**维持 P2**(安全纵深零守门 + 双向高害回归模式)。

---

## 复核后净效果

- 第一波 9 条 P1/P2 中本切片 4 条:**3 CONFIRMED + 1 REFUTED**。
- REFUTED 的 C1/AL1 是唯一 P1——拦截它避免了对 billionsClient/mcp 的无谓改造(以及可能引入的真回归面);同时产出一条新的 P3 文档债(yahooClient 注释失真 + rn-runtime 依赖事实缺失)。
