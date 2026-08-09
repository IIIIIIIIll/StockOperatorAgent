# 配置可发现性（env.example/README 补漏）

## Goal

让所有生产生效的配置键在 `.env.example` 可发现、README 准确描述当前系统。审计确认：`WEB_SEARCH_DISABLED` 与 `TDX_MCP_DISABLED` 两个生产开关三处（.env.example / env_file 白名单 / UI 面板）都不可见，部署者只能翻源码。

## Requirements

- **`.env.example` 补两个开关**（含 truthy 语义注释，对齐 `env_disabled` 的 `("", "0", "false", "no")` 假值约定）：
  - `TDX_MCP_DISABLED`（读者 `core/llms/tools/get_market_intel.py:45`）——当前 `.env` 里就有 `=1`
  - `WEB_SEARCH_DISABLED`（读者 `core/llms/tools/web_search.py:46`）
- **全键核对**：`os.getenv` / `env_disabled` / `env_int` 读取的全部生产键（TDX_API_KEY、TDX_MCP_DISABLED、WEB_SEARCH_DISABLED、BILLIONS 族 8 键、DEEPSEEK_API_KEY/MODEL、DASHSCOPE_API_KEY、LANGSMITH_TRACING/API_KEY/PROJECT、ENV_FILE_PATH）逐一在 .env.example 有条目或明确注释（ENV_FILE_PATH 标注"内部测试用"）。
- **DASHSCOPE_API_KEY 现状处理**（最小动作，不做功能变更）：UI 设置面板可写但 `QwenApi` 生产无构造点（`core/ui/display.py:24` docstring 已声明"Qwen 已降级为可选项"）——.env.example 该键注释标注"可选，当前生产未接线（QwenApi 无消费点）"，保留键与 UI 不动。
- **README 修正**：
  - 补亿信（亿信）集成：`BILLIONS_API_KEY` 总闸 + 能力开关族 + 调用上限（08-08 功能完全未提）
  - 补设置面板（模型/密钥/开关全部进网页）与 LangSmith tracing
  - 修正 akshare 误导说法（"备用路径…仍可走该路径" → "备用路径，主流程（纯 TDX 链路）不再调用，方法保留"）
  - 顺带修正 `core/data_acquisition.py:229-232` 注释里"Use the akshare fallback path instead"的过时指引（属本任务文档一致性范围，改注释不改行为）
- **零行为变化**：只动 .env.example / README / 注释，不动任何判定逻辑。

## Acceptance Criteria

- [ ] 核对脚本（grep 生产全部 env 读取键）输出 == .env.example 条目集合（含明确注释的例外项），无遗漏。
- [ ] `.env.example` 中 TDX_MCP_DISABLED 与 WEB_SEARCH_DISABLED 有注释说明语义与假值约定。
- [ ] README 含亿信段、设置面板段、LangSmith 段；无"akshare 主流程可走"误导表述。
- [ ] `grep -rn "Use the akshare fallback" core/` 无残留（或已改为准确表述）。
- [ ] 无生产代码行为改动（`git diff` 只含文档/注释）。

## Notes

- 开关族 truthy 语义统一说明（`.env.example` 顶部注释即可）：`X_DISABLED` 存在且值非 `""/0/false/no` → 禁用；`BILLIONS_*_DISABLED` 同理；`BILLIONS_*_MAX_CALLS` 为调用上限整数。
- 不做项：QwenApi 死代码移除（另议）；env 键极性统一（负极性是 08-09-unify-config-parsing 的既定设计，不改）。
