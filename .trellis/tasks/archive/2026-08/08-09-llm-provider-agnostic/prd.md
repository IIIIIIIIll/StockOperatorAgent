# LLM 服务去供应商化：可配置 endpoint/key/模型名

## Goal

LLM 服务不再绑定 DeepSeek 供应商：通过可配置的 endpoint / API key / 模型名，
任何 OpenAI 兼容服务（DeepSeek 官方、OpenCode Zen 网关、OpenAI、本地
vLLM/Ollama 网关等）都能直接接入，改配置即可切换，不改代码。配置面
（env / UI / 校验 / 文档）全面收敛到通用 `LLM_*` 键，供应商专属键与
死代码一并清除。

## 背景与已确认事实（代码证据，2026-08-09）

- 生产只有 DeepSeek 一条 LLM 路径：`core/investment_committee.py:101`
  `llm = _llm or DeepSeekApi()` 永远构造 `DeepSeekApi`；QwenApi 无消费点
  （.env.example 注明"当前生产未接线"，其测试整文件 skip）
- `DeepSeekApi`（`core/llms/deepseek/deepseek_api.py`）：
  `DEEPSEEK_MODEL`（默认 deepseek-v4-flash）/ `DEEPSEEK_API_KEY` /
  `DEEPSEEK_BASE_URL`（默认 https://api.deepseek.com）；`seed=114514`；
  `reasoning_effort="max"`（DeepSeek 推理档，OpenAI 兼容参数，第三方网关
  如 /zen/go 实测接受；但非标准 OpenAI 参数，部分兼容服务会 400 拒绝）
- `QwenApi`（`core/llms/qwen/qwen_api.py`）：`DASHSCOPE_API_KEY`，
  endpoint 写死 DashScope 兼容模式，`extra_body` 带 DashScope 私有参数
  `enable_search` / `enable_search_extension`
- UI（`core/ui/display.py`）：`_has_deepseek_key` 门控只认 `DEEPSEEK_API_KEY`
  （display.py:21-27）；设置面板模型下拉只有 flash/pro 两项
  （display.py:232-239）；持久化区 password 字段含 settings_deepseek_key→
  DEEPSEEK_API_KEY、settings_dashscope_key→DASHSCOPE_API_KEY
  （display.py:157-163）；`_collect_persisted_updates` 恒写 `DEEPSEEK_MODEL`
  （display.py:195）；st.error 提示要求设置 `DEEPSEEK_API_KEY`（display.py:373）
- `utils/env_file.py`：`UPDATE_WHITELIST` 含 DEEPSEEK_API_KEY /
  DEEPSEEK_MODEL / DASHSCOPE_API_KEY；`_MODELS = ("deepseek-v4-flash",
  "deepseek-v4-pro")` 枚举校验；`DEEPSEEK_BASE_URL` 不在白名单
- `.env.example` 与 `README.md:16`：DEEPSEEK_* 三键文档
- 测试面：`test/core/llms/deepseek/test_deepseek_api.py`（6 离线测试）、
  `test/core/llms/qwen/test_qwen_api.py`（整文件 skip，随死代码删）、
  `test/core/ui/test_display.py`（key 门控 + 面板收集）、
  `test/utils/test_env_file.py`（白名单/校验）、`test/e2e/test_settings_panel.py`
  （面板 e2e 流程）、`test/e2e/conftest.py:72-73,229,258` 与
  `test/e2e/mock_app.py:9-12`（dummy env 注入，键名随迁移改名）

## Requirements（决策已收敛）

- **R1**：配置只认通用三键 `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL`，
  DEEPSEEK_* / DASHSCOPE_* 全库移除（直接迁移，不保留回退；现有 .env 手动迁移）
- **R2**：供应商私有参数默认不传；`LLM_REASONING_EFFORT` 可选 env，
  设了才传（DeepSeek 用户配 max 保持现状）；Qwen 的 enable_search 私有
  参数随 QwenApi 一并移除
- **R3**：删除 `core/llms/qwen/` 与 `test/core/llms/qwen/`（死代码）
- **R4**：设置面板改造——模型改自由文本、新增 Base URL 文本框（持久化
  到 .env）、API Key 改 LLM_API_KEY、删 DashScope 字段
- **R5**：必填强校验——`LLM_API_KEY` / `LLM_MODEL` / `LLM_BASE_URL` 任一
  缺失或空 → 拒绝保存 / 拒绝构造 / UI 渲染前门控拦截；Base URL 另加
  URL 格式校验（http:// 或 https:// 开头，格式级，不做网络可达性探测）

## Acceptance Criteria

- [ ] AC1：`core/llms/` 提供通用 OpenAI 兼容工厂，仅凭三键构造 ChatOpenAI；
      无供应商专属参数（LLM_REASONING_EFFORT 设了才传）
- [ ] AC2：全库 `DEEPSEEK_*` / `DASHSCOPE_*` / `DeepSeekApi` / `QwenApi`
      grep 零残留（代码/测试/注释/.env.example/README）
- [ ] AC3：缺任一必填键 → 工厂构造抛错（消息列出缺失键）；UI 渲染前
      门控只认三键齐全才放行
- [ ] AC4：env_file 白名单与校验更新——LLM_API_KEY / LLM_MODEL 非空；
      LLM_BASE_URL 非空且 http(s):// 开头；非法值拒绝写入并返回中文消息
- [ ] AC5：设置面板——模型自由文本 + Base URL 文本框 + LLM API Key；
      校验失败拒绝保存并 st.error 提示；DashScope 字段消失
- [ ] AC6：QwenApi 相关文件（源码 + 测试）删除
- [ ] AC7：pytest 全量 + e2e 设置面板 mock 用例更新后全绿
- [ ] AC8：.env.example 与 README 更新为 LLM_* 文档（含 DEEPSEEK 迁移说明）

## Out of Scope

- 多 LLM 并行配置 / UI 切换（本次只支持单 LLM 配置）
- `LLM_REASONING_EFFORT` 不进 UI（.env 手配，白名单外）
- endpoint 网络可达性校验（只做格式校验）
- 现有 .env 自动迁移（README 注明手动迁移步骤）
