import os
from langchain_openai import ChatOpenAI

class QwenApi(ChatOpenAI):

    def __init__(self):
        super().__init__(
            model="qwen-plus-latest",
            api_key=os.getenv("DASHSCOPE_API_KEY"),
            base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
            extra_body={
                # "enable_thinking": True,
                # "thinking_budget": 10000
                "enable_search": True,
                "enable_search_extension": True
            },
            seed=114514
        )