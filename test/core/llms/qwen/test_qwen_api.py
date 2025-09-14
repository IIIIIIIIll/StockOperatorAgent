from core.llms.qwen.qwen_api import QwenApi
from dotenv import load_dotenv
from loguru import logger

class TestQwenApi():

    def test_qwen_api(self):
        load_dotenv()  # This loads the variables from .env
        qwen_api = QwenApi()

        def try_qwen_model(api):
            try:
                messages = [
                    {'role': 'system', 'content': 'You are a helpful assistant.'},
                    {'role': 'user', 'content': '你是谁？'}
                ]
                return api.invoke(messages)
            except Exception as e:
                print(f"错误信息：{e}")
                print("请参考文档：https://help.aliyun.com/zh/model-studio/developer-reference/error-code")
                return None

        ret = try_qwen_model(qwen_api)
        assert ret is not None
        logger.info(ret)
