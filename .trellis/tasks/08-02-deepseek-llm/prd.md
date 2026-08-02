# 添加 DeepSeek API 并默认启用

## Goal

新增 DeepSeek LLM 支持并设为默认，Qwen 保留可用（不删除）。

## Requirements

- 新增 `core/llms/deepseek/deepseek_api.py`：`DeepSeekApi(ChatOpenAI)`
  - `model = os.getenv("DEEPSEEK_MODEL", "deepseek-v4-flash")`（可选 `deepseek-v4-pro`）
  - `api_key = os.getenv("DEEPSEEK_API_KEY")`
  - `base_url = "https://api.deepseek.com"`
  - **不传 `enable_search`**（DashScope 私有参数，DeepSeek 不支持）；`seed` 保持
- `core/investment_committee.py`：`llm = DeepSeekApi()`（默认），QwenApi 保留可切
- `core/ui/display.py`：key 缺失检查兼容两个 key（任一存在即可运行，提示缺失项）
- `.env.example`：增加 `DEEPSEEK_API_KEY=` 与 `DEEPSEEK_MODEL=deepseek-v4-flash`
- README：密钥配置说明更新
- spec：agents/index.md（LLM 配置节）、architecture.md、testing.md 中 Qwen/DashScope
  描述更新为"默认 DeepSeek，Qwen 可选"

## Acceptance Criteria

- [ ] `DeepSeekApi()` 默认 model 为 `deepseek-v4-flash`；设置 `DEEPSEEK_MODEL=deepseek-v4-pro` 后生效（离线单测）
- [ ] `DeepSeekApi` 构造不依赖网络；未设置 key 时构造不崩溃（调用时才失败，与 QwenApi 行为一致）
- [ ] `make_investment_committee` 使用 DeepSeekApi（可单测断言或代码审查确认）
- [ ] display.py 无任一 key 时显示中文提示；有一个 key 时正常
- [ ] 既有 pytest 无新增失败（28 过基线；test_qwen_api 等环境性失败不变）
- [ ] README/.env.example/spec 已更新

## Constraints

- 不删除 QwenApi 与 DASHSCOPE_API_KEY 支持——保留为可选项
- 不改 agent 类模式与 State（仅换 LLM 实例）
- 错误处理约定不变：key 缺失在 UI 层提示（display.py），不在数据管道 raise
