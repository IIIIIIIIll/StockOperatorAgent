"""通用 OpenAI 兼容 LLM 工厂（08-09-llm-provider-agnostic）。

LLM 服务不再绑定供应商：仅凭三个通用环境变量构造 OpenAI 兼容客户端，
任意 OpenAI 兼容服务（DeepSeek 官方、OpenCode Zen 网关、OpenAI、本地
vLLM/Ollama 网关等）改配置即可接入，不改代码。

配置契约（前三个必填，缺任一构造即抛 ValueError——R5 必填强校验）：
- LLM_API_KEY    API Key（非空）
- LLM_MODEL      模型名（非空，自由文本；例 deepseek-v4-flash、gpt-4o）
- LLM_BASE_URL   OpenAI 兼容 endpoint（非空且以 http:// 或 https:// 开头；
                 格式级校验，不做网络可达性探测）

可选：
- LLM_REASONING_EFFORT  设了才传 reasoning_effort（供应商 OpenAI 兼容
                 私有参数，如 DeepSeek 推理档 max；空/未设 → 不传，
                 任意兼容服务安全）。DashScope 的 enable_search 等私有
                 extra_body 参数不再提供——extra_body 一律不传。
"""

import os

from langchain_openai import ChatOpenAI

_REQUIRED = ("LLM_API_KEY", "LLM_MODEL", "LLM_BASE_URL")


def make_llm() -> ChatOpenAI:
    """构造通用 OpenAI 兼容 LLM（全库唯一 ChatOpenAI 构造点）。

    无 key / 缺模型 / 缺 endpoint → ValueError（消息列出缺失键）；base_url
    非 http(s) 前缀 → ValueError。UI 层 display.py 渲染前已做三键齐全门控。
    """
    missing = [name for name in _REQUIRED if not (os.getenv(name) or "").strip()]
    if missing:
        raise ValueError(
            f"缺少 LLM 配置：{' / '.join(missing)}（详见 .env.example）")
    base_url = os.getenv("LLM_BASE_URL").strip()
    if not (base_url.startswith("http://") or base_url.startswith("https://")):
        raise ValueError("LLM_BASE_URL 必须以 http:// 或 https:// 开头")
    kwargs = {
        "model": os.getenv("LLM_MODEL").strip(),
        "api_key": os.getenv("LLM_API_KEY").strip(),
        "base_url": base_url,
        "seed": 114514,
    }
    effort = (os.getenv("LLM_REASONING_EFFORT") or "").strip()
    if effort:
        kwargs["reasoning_effort"] = effort
    return ChatOpenAI(**kwargs)
