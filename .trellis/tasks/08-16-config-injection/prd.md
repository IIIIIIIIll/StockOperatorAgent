# config-injection:配置面显式化(applySwitches + env 读取收敛)

## Target
新 `src/switches.ts` + `src/env.ts`;`app/lib/settings.ts`(applySwitchesToEnv 删除 → setCapabilitySwitches);消费点 `src/committee.ts`/`webSearch.ts`/`mcp.ts`/`billionsTools.ts`/`agents.ts`;env 兜底读迁移(llm/billionsClient/mcp/webSearch/deviceCollect)。

## Change
按父 design.md 契约 2:显式开关配置(默认从 env 反推,与旧语义逐位等价;TDX_MCP_ENABLED 覆盖层优先级保留并单测);**process.env 零写入**;消费点惰性读 config(禁止模块级求值);env 读取统一 `src/env.ts` envValue 守卫单点,优先级:构造注入 > envValue > 默认。

## Acceptance
- process.env 零写入(grep 实证);开关默认等价单测(env 反推 == 面板全开)
- 全开关路径单测(每个开关 false/true 两态)
- skip 验证/commit(父统一)
