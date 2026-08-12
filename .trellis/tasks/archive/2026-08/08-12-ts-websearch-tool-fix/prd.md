# 修复 web_search 工具 schema——bindTools 序列化 400

## 目标与用户价值

真实 LLM 下交易员/经理工具轮(联网搜索)被严格 provider 以
`tools[0]: missing field type` 400 拒绝(08-12 流式任务真实 LLM 冒烟实测,
deepseek-v4-flash via /llm-proxy)。root cause:`makeWebSearchTool` 返回裸
`{name, invoke}` 对象,`ChatOpenAI.bindTools` 对非 LangChain tool 原样透传
(`_convertToOpenAITool` else 分支),请求体 tools[0] 缺 `type:'function'`
包装。修复后真实 LLM 工具轮可实际联网搜索。

## 现状盘点(证据)

- `ts/src/webSearch.ts` `makeWebSearchTool` 返回 `{ name:'web_search',
  invoke }`(ToolLike 契约,ts/src/toolLoop.ts)。
- `ts/src/agents.ts` 构造:`llm.bindTools(tools)` 直接传 ToolLike 数组。
- `@langchain/openai` utils/tools.js `_convertToOpenAITool`:`isLangChainTool`
  → convert;否则**原样透传**;`@langchain/core` tools/types.js
  `isStructuredToolParams`:`{name, schema}`(schema 为 JSON Schema 形态)即命中
  → convertToOpenAIFunction 取 `name/description/schema` 产出
  `{type:'function', function:{name, description, parameters}}`。
- Python 侧对齐目标:core/llms/tools/web_search.py `@tool("web_search")`
  StructuredTool,`query: str` required,docstring「联网搜索(DuckDuckGo 中文
  财经源,cn-zh),可验证行业与市场的最新论据(如新闻、公告、政策)。查询失败
  时返回占位文本。」

## 需求

- **R1** `ToolLike`(`ts/src/toolLoop.ts`)增可选 `schema?`(JSON Schema)与
  `description?`(OpenAI function description);可选 → 现有 fake/调用方
  零改动。
- **R2** `makeWebSearchTool` 补 `description`(对齐 Python docstring)与
  `schema`(`{type:'object', properties:{query:{type:'string', description:
  '搜索查询词'}}, required:['query']}`);invoke 执行语义不变。
- **R3** `agents.ts` bindTools 调用点不改逻辑(bindTools(tools) 原样——
  `{name,schema}` 自动被识别转换);执行路径(toolLoop 按 name 查 invoke)
  零变化。
- **R4** 不回归:离线 stub/demo 无 bindTools → 跳过绑定(现状);vitest 全绿。

## 明确不做(Out of Scope)

- `/web-search` 代理拒绝含空格 q 的 400(信息面预抓降级正常,既有校验行为)。
- Python 侧工具改动。
- 其他供应商工具调用适配。

## Acceptance Criteria

- [ ] **AC1** 序列化断言:捕获 ChatOpenAI 请求体的离线验证(自定义 fetch)
      显示 `tools[0]` 为 `{type:'function', function:{name:'web_search',
      description, parameters:{type:'object', ..., required:['query']}}}`。
- [ ] **AC2** 真实 LLM(deepseek via /llm-proxy)交易员/经理工具轮触发
      web_search 调用不再 400,搜索结果以 ToolMessage 回流、最终回答含
      搜索依据(或至少不再 400)。
- [ ] **AC3** vitest 全绿(ts/test,新增 schema 形状断言;既有 tool-loop/
      committee/agents 用例零改动通过);tsc clean。
- [ ] **AC4** 演示模式/离线 stub 行为不变(状态条/瞬时填充照常)。

## Open Questions

(无阻塞项。修复形状已由源码确认:isStructuredToolParams 判定 `{name,schema}`。)
