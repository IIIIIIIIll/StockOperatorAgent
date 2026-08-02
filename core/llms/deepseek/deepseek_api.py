import os
from langchain_openai import ChatOpenAI

class DeepSeekApi(ChatOpenAI):
    """DeepSeek 官方 API（OpenAI 兼容）。

    默认模型 deepseek-v4-flash，可用环境变量 DEEPSEEK_MODEL 切换为
    deepseek-v4-pro。不传 enable_search —— 那是 DashScope 私有参数，
    DeepSeek 服务端不接受（投资经理 prompt 中的联网搜索指示随之失效，
    见 agents spec）。
    """

    def __init__(self):
        super().__init__(
            model=os.getenv("DEEPSEEK_MODEL", "deepseek-v4-flash"),
            api_key=os.getenv("DEEPSEEK_API_KEY"),
            base_url="https://api.deepseek.com",
            seed=114514
        )
