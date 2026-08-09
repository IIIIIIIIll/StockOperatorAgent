import os
from langchain_openai import ChatOpenAI

class DeepSeekApi(ChatOpenAI):
    """默认 DeepSeek 官方 API（OpenAI 兼容）。

    默认模型 deepseek-v4-flash，可用环境变量 DEEPSEEK_MODEL 切换为
    deepseek-v4-pro；默认 endpoint https://api.deepseek.com，可用
    DEEPSEEK_BASE_URL 覆盖（如 OpenCode Zen 网关：
    https://opencode.ai/zen/go/v1，同模型走第三方 OpenAI 兼容网关）。
    reasoning_effort 固定 max（deepseek-v4-flash 是推理模型，走最强
    推理档；OpenAI 兼容参数，2026-08-09 实测 /zen/go 网关接受）。
    不传 enable_search —— 那是
    DashScope 私有参数，DeepSeek 服务端不接受（投资经理 prompt 中的
    联网搜索指示随之失效，见 agents spec）。
    """

    def __init__(self):
        super().__init__(
            model=os.getenv("DEEPSEEK_MODEL", "deepseek-v4-flash"),
            api_key=os.getenv("DEEPSEEK_API_KEY"),
            base_url=os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
            seed=114514,
            reasoning_effort="max",
        )
