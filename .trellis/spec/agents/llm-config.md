---
description: LLM 配置 — make_llm 通用 OpenAI 兼容工厂、invoke_with_retry、依赖版本与 Gotcha
paths:
  - core/llms/llm_factory.py
  - core/llms/retry.py
---
# LLM 配置（`core/llms/`）

**通用 OpenAI 兼容工厂**（08-09-llm-provider-agnostic）：
`core/llms/llm_factory.py` 的 `make_llm() -> ChatOpenAI` 是**全库唯一
ChatOpenAI 构造点**，不绑定供应商——改 env 即换供应商（DeepSeek 官方、
OpenCode Zen 网关、OpenAI、本地 vLLM/Ollama 网关等）。契约（R5 必填强
校验，缺任一构造即抛 ValueError，消息列出缺失键）：

| env 键 | 必填 | 校验 |
|--------|------|------|
| `LLM_API_KEY` | ✅ | 非空 |
| `LLM_MODEL` | ✅ | 非空（自由文本，不再枚举供应商模型） |
| `LLM_BASE_URL` | ✅ | 非空且 `http://` / `https://` 开头（格式级，不做网络探测） |
| `LLM_REASONING_EFFORT` | 可选 | 设了才传 `reasoning_effort`（DeepSeek 用户配 `max` 保持推理档；空/未设 → 不传，任意兼容服务安全） |

`seed=114514` 恒定；`extra_body` 一律不传（供应商私有参数不内置于工厂）。
UI 层 display.py 渲染前 `_llm_configured()` **三键齐全才放行**（与实现对齐
——缺任一键构造即崩）。历史：旧 `DeepSeekApi`（deepseek_api.py）/
`QwenApi`（qwen_api.py）及其 `DEEPSEEK_*` / `DASHSCOPE_*` env 于 08-09
删除；迁移映射见 `.env.example` 迁移说明。

图装配（`core/investment_committee.py`）：`llm = _llm or make_llm()`。

**LLM 调用重试（2026-08-02，review #6）**：节点 invoke 统一走
`core/llms/retry.py` 的 `invoke_with_retry(llm, payload, config)`——
可恢复错误（429 限流 / 500/502/503/504 / APIConnectionError / 超时）
指数退避重试 3 次（1s 起，上限 8s）；业务错误（400/认证）直抛零延迟；
耗尽后 reraise 原异常（既有 UI 守护行为不变）。判定用
`openai.APIStatusError.status_code` + 连接/超时类型（openai 2.x 构造
测试异常需真实 httpx.Response）。新增 agent 节点沿用同一包装。

**依赖版本（2026-08-02 升级 0.3/0.6 → 1.x）**：langchain 1.3.14 /
langchain-core 1.5.3 / langchain-openai 1.4.1 / langgraph 1.2.10 /
langgraph-checkpoint 4.1.1 / langgraph-prebuilt 1.1.0 / langgraph-sdk 0.4.2 /
langsmith 0.10.15 / openai 2.52.0（传递）。代码零改动，全量回归 116 passed
（含 graph streaming / reducer / get_state_history 集成测试）。
**08-09 依赖清单对齐（08-09-debt-cleanup/deps-manifest）**：requirements.txt
全部 pin 对齐本环境已验证安装版（46 项降对齐——ZODB 6.2→6.0.1、altair
6.0.0→5.5.0 为模板遗留零验证 pin（ffc94c6 带入，历次真实升级未触碰，环境
从未安装过）；langchain-text-splitters 0.3.11→1.1.2 反向对齐），补回漏 pin
的 python-dotenv==1.1.1（`main.py:1` / `investment_committee.py:1` direct
import，08-09 前只靠 conda 传递依赖存在——fresh 非 conda 安装即缺）。
**Gotcha**：
requirements.txt 是全量 freeze，但曾漏 pin 直接导入的包（langchain /
langchain-openai / openai 缺失——fresh `pip install -r requirements.txt` 会
缺 `langchain_openai`；08-09 后同类的 dotenv 已修）；更新依赖时确保
**直接 import 的包**也在 freeze 中，
不能只靠传递依赖。升级 langgraph 大版本后先跑 test/integration（reducer
行为是 0.x → 1.x 最大风险面）。**Gotcha（08-03-websearch-tool-calling）**：
`langchain-community==0.4.2`（已停更自担维护）的 `DuckDuckGoSearchResults`
**只能从顶层 `langchain_community.tools` 导入**——子包
`tools.ddg_search.__init__` 只 re-export 旧名 `DuckDuckGoSearchRun`（实测
ImportError）；community 0.4.2 依赖声明不含 `ddgs`（惰性导入）——fresh
环境必须显式 pin `ddgs==9.14.4`（旧包 duckduckgo-search 已死不可用）；
`langchain-classic==1.0.8` 为传递依赖一并 freeze。
