import os
from langchain_openai import ChatOpenAI

class QwenApi(ChatOpenAI):

    def __init__(self):
        super().__init__(
            model="qwen-flash",
            api_key=os.getenv("DASHSCOPE_API_KEY"),
            base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        )