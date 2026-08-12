# TS 全流式输出——token 事件流 + UI 打字机渲染

## 目标与用户价值

TS 侧(web 浏览器 + RN app)agent 运行全程黑盒:委员会 7 个角色(信息面分析师
条件注册)跑数分钟,用户只能看到扁平 progress 文本与最终 tab,无法感知
「谁在跑、谁已完、输出长什么样」。目标:**每个 agent 独立状态(running/done/
retry)+ 报告文本 token 级实时流式渲染**,LLM 生成过程可见(对齐用户诉求
「每个 agent 独立的回答状态/进度」与「整个输出流式」二选一——用户选定全流式,
状态作为流式协议的自然副产品一并交付)。

## 现状盘点(证据)

- **事件协议扁平无角色**:`PipelineEvent = progress | report | done | error`
  (`ts/src/events.ts`);`ProgressUpdater.info(msg)` 只传扁平字符串
  (`ts/src/progress.ts`),agent 仅发 startMsg/doneMsg(`ts/src/agents.ts:93,98`),
  toolLoop 发「正在联网搜索。。。」(`ts/src/toolLoop.ts:51,69`)。
- **LLM 调用非流式**:全部走 `invokeWithRetry`(`ts/src/retry.ts`,`.invoke()`
  整段返回);`graph.stream()` 只被用来 drain 节点完成(`ts/src/events.ts:76-78`),
  未开任何流式模式。
- **web 代理整体缓冲**:dev(`ts/app/metro.config.js` `llmProxyHandler`:
  `await upstream.text()` 后 `res.end`)与生产(`ts/app/server.mjs` `llmProxy`
  同模式)都先收完整响应再回包——**即使 SDK 发 SSE,浏览器也一次性收到**,
  无实时性。RN 真机 LLM 直连(无代理),天然可流。
- **LLM 栈支持流式**:`ChatOpenAI`(`@langchain/openai` ^1.5.6)原生 `.stream()`;
  `prompt.pipe(llm)` 是 RunnableSequence,`.stream()` 转发末步 chunk;demo
  stub(`ts/app/lib/runner.ts` `demoLlm`,纯函数)经 sequence `.stream()` 产出
  单 chunk 全量消息。
- **LangGraph 备选路径(已评估,否决)**:`streamMode:'messages'` 依赖图回调
  注入 + chunk 级 `tool_call_chunks` 嗅探区分工具轮文本,版本敏感且演示
  stub/工具轮边界处理繁琐——见 design.md 决策 D1。

## 需求

- **R1 事件协议加角色维度**:`PipelineEvent` 新增
  `{ type:'token'; roleKey; node; delta }`(流式文本增量,node 区分初稿/修订
  轮)与 `{ type:'roleStatus'; roleKey; node; status:'running'|'done'|'retry' }`
  (每 agent 生命周期)。
- **R2 agent 级流式**:`retry.ts` 新增 `streamWithRetry`(流式 + 聚合 + 指数
  退避重试,复用 `isRetryable`);专家/工具角色 LLM 调用改流式;工具轮文本
  轮末回滚(reset),最终回答实时上屏;重试发生时 reset 该角色缓冲。
- **R3 每 agent 状态**:agent 在节点开始/结束/重试时发射 roleStatus;UI 渲染
  每角色状态条(待运行/分析中/完成/重试中)。
- **R4 web SSE 透传**:dev metro 中间件 + 生产 server.mjs 的 `/llm-proxy`
  改为流式转发(pipe `upstream.body`),不整体缓冲。
- **R5 UI 打字机**:角色 tab 内报告文本随 token 实时增长;report 事件到达后
  以最终内容为准替换;final_decision 同流式;演示 stub 退化为瞬时填充。
- **R6 不回归**:progress/report/done/error 既有事件与 UI 行为保持;
  `report` 事件仍是最终报告权威来源;Python 侧零改动。

## 明确不做(Out of Scope)

- LangGraph `streamMode` 相关改造(graph 保持默认 updates 模式,仅 drain)。
- 演示 stub 假打字机(瞬时填充即可;真机/演示模式不追求打字效果)。
- RN 真机验收(现状真机本就跑 demo 数据;代码路径同 App.tsx,流式天然生效)。
- LLM 推理过程/思考链(token 之外的 reasoning 展示)。
- Python 侧任何改动。

## Acceptance Criteria

- [ ] **AC1** 真实 LLM 下(web dev,三键配置),浏览器内角色 tab 文本随生成
      实时增长(token 事件驱动),非一次性整段出现;`curl -N` 验证
      `/llm-proxy` 返回 SSE 分块(非整体缓冲)。
- [ ] **AC2** 每个启用角色有独立状态:待运行 → 分析中 → 完成;重试发生时
      显示「重试中」且该角色已流出的文本被清空重来;信息面分析师未启用时
      不出现在状态条。
- [ ] **AC3** 交易员/经理工具轮:搜索轮的中间文本轮末回滚不残留;最终回答
      完整流入对应 tab;report 事件到达后 tab 内容与最终报告逐字一致。
- [ ] **AC4** 演示模式(无三键)与离线测试 stub:状态照常流转,报告瞬时填充,
      事件流包含 token(单 chunk)+ roleStatus。
- [ ] **AC5** vitest 全绿(新增 streamWithRetry/事件序列/工具轮回滚用例;
      `events.test.ts` 既有断言按新事件流更新);Python 全量 `pytest -q`
      零新增失败。
- [ ] **AC6** Node 探针(`SOA_LIVE=1 npm run probe -- 600036`)订阅方可看到
      token/roleStatus 事件,`probe-output/report.json` 结构不变。

## Open Questions

(无阻塞项。UX 取舍均已定案,见 design.md 决策 D3/D5/D6。)
