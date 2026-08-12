# Implement — TS 全流式输出

执行顺序(每步含验证)。全部在 `ts/` 内;Python 侧零改动(仅回归跑一次)。

## 实施清单

1. **协议层(progress.ts)** — `ProgressUpdater` 增可选
   `pushDelta?(node, delta)` / `pushStatus?(node, status)`;导出
   `RoleStatus` 类型。安全守卫 `safePushDelta`/`safePushStatus`(对齐
   `safeProgress`,缺失/抛错 → no-op)。
   验证:`npm test`(既有用例应零改动通过——方法可选)。

2. **流式重试(retry.ts)** — 新增 `streamWithRetry`(见 design.md §3):
   聚合用 `concat`(来自 `@langchain/core/utils/stream`);退避/可恢复判定
   复用 `isRetryable` + 常量;onDelta/onRetry 回调;耗尽 reraise。**退避前
   warn 照抄 `invokeWithRetry` 已合入模式(1fc7828)**:`warn('LLM stream
   attempt N failed with <errType>; retrying in <delay>s')`,errType 用
   constructor.name 探针——两个重试路径行为对齐。
   验证:先写 `ts/test/retry.test.ts` 新用例(聚合顺序、onDelta 逐 chunk、
   可恢复错误触发 onRetry 后成功、业务错误直抛零延迟、退避间隔),跑
   `npx vitest run test/retry.test.ts`。

3. **agent 层(agents.ts / toolLoop.ts)** —
   - `LlmLike` 增可选 `stream?`;`CompleteOptions` 增 `nodeName`(各调用点
     填:fundamental_analysis_expert / bullish_trader / bullish_revise /
     investment_manager …)。
   - `completeExpert`:streamWithRetry + onDelta→pushDelta(node) +
     onRetry→pushStatus(node,'retry');调用前 pushStatus 'running'、pushReport
     后 'done';无 `.stream()` 回退 invokeWithRetry + 单次全量 delta。
   - `invokeWithTools`:增 opts `onDelta`/`onRetry`/`onReset`(round 级);
     每轮 streamWithRetry;轮末 tool_calls 非空 → onReset;收尾轮同样流式。
   - `completeWithTools` 透传 node 维度回调(内部按 round 聚合 delta 后
     单发?否——直接逐 chunk 透传,reset 兜底)。
   验证:`npx vitest run test/agents.test.ts test/tool-loop.test.ts`
   (工具轮回滚:stub LLM 首轮 tool_calls → onReset 被调、末轮文本完整)。

4. **事件桥(events.ts)** — updater 实现 pushDelta/pushStatus → emit
   token/roleStatus;node→roleKey 经 `ROLES` nodeName 查表
   (`enabledRoles().find(r => r.nodeName === node)`);run() 其余不变。
   验证:更新 `ts/test/events.test.ts` 断言——stub LLM(纯函数 sequence)
   单 chunk → 事件序列含 roleStatus(running→done)+ token(全量)+ report;
   retry 注入 → roleStatus 'retry' 且后续 token 重来。跑全量 vitest。

5. **web SSE 透传(lib/proxies.cjs 单处)** — `handleLlmProxy` 去掉
   `await upstream.text()`,改 pipe `upstream.body` 分块 `res.write`(dev
   metro 与生产 server.mjs 共用此函数,双入口同步生效);错误/断连兜底保持,
   **upstream.body 流中断时 `res.destroy()`**(防客户端挂起——原缓冲实现
   无此路径);`writeHead` 后抛错要 catch 住避免 unhandled rejection。
   验证:`curl -N -X POST localhost:8090/llm-proxy/chat/completions -d
   '{"base":"<真实base>","model":"<模型>","messages":[...],"stream":true}'`
   观察分块到达(非一次性);`curl -N` 头含 `text/event-stream`。

6. **UI(App.tsx / ReportContent.tsx)** —
   - App:partials/statuses state;subscribe 分发(token 追加 / roleStatus 写
     状态 + retry 清 partial / report 清 partial);角色状态条(chip 列表);
     报告 tab 传 partial+streaming。
   - ReportContent:opinion 初稿/修订槽位 partial ?? report;final_decision
     partial ?? finalDecision;running 光标「▍」。
   验证:浏览器冒烟(Step 7)。

7. **验证(必做)** —
   - `npm test`(ts/test 全绿)。
   - web dev 冒烟:`npm run web`(或 expo)起 dev server;演示模式跑
     `600036` → 状态条流转、报告瞬时填充;配真实三键再跑 → 每个角色 tab
     打字机可见、状态条 running→done、中途断网/429(可选)触发 retry 复位。
   - Node 探针:`SOA_LIVE=1 npm run probe -- 600036` → 订阅方打印
     token/roleStatus;`probe-output/report.json` 结构不变。
   - 回归:`pytest -q`(仓库根)零新增失败。

8. **收尾** — 无新依赖无文档;确认与 08-11-ts-log-persistence 的 retry.ts
   改动不冲突(本任务先合;日志任务随后给两个重试路径补 warn)。

## 风险文件 / 回滚点

- `ts/src/retry.ts`(新增 streamWithRetry,invokeWithRetry 不动)→ 可独立回退。
- `ts/src/agents.ts` / `ts/src/toolLoop.ts`(调用层切换)→ 回退为
  invokeWithRetry 即恢复现状,UI/协议层可保留(降级为 report 即时渲染)。
- `ts/app/lib/proxies.cjs`(SSE 透传,dev/prod 共用单处)→ 单文件可回退;
  若透传有问题,web 退回整体缓冲(功能正确、无实时性),不阻断其他步骤。
- `ts/app/App.tsx` / `ts/app/components/ReportContent.tsx`(UI)→ 纯增量。

## 协作顺序

08-11-ts-log-persistence 已归档(2dafe01),retry.ts 退避 warn 已合入
(1fc7828)——`streamWithRetry` 直接照抄 warn 模式,无跨任务冲突;代理已
收敛单份(5d0d8ab),SSE 透传只改 proxies.cjs 一处。
