"""DeepSeekApi 离线测试：构造配置正确、模型可覆盖、无 key 行为与 QwenApi 一致。

ChatOpenAI 构造客户端不发起网络请求，但要求 api_key 存在（缺失时构造即抛
OpenAIError——与 QwenApi 同构；UI 层 display.py 已在渲染前做 key 检查）。
"""

import os

import pytest
from openai import OpenAIError

from core.llms.deepseek.deepseek_api import DeepSeekApi


class TestDeepSeekApi:

    def test_default_model_and_base_url(self):
        saved_key = os.environ.get("DEEPSEEK_API_KEY")
        saved_model = os.environ.pop("DEEPSEEK_MODEL", None)
        saved_base = os.environ.pop("DEEPSEEK_BASE_URL", None)
        os.environ["DEEPSEEK_API_KEY"] = "test-key"
        try:
            api = DeepSeekApi()
            assert api.model_name == "deepseek-v4-flash"
            assert api.openai_api_base == "https://api.deepseek.com"
        finally:
            os.environ.pop("DEEPSEEK_API_KEY", None)
            if saved_key is not None:
                os.environ["DEEPSEEK_API_KEY"] = saved_key
            if saved_model is not None:
                os.environ["DEEPSEEK_MODEL"] = saved_model
            if saved_base is not None:
                os.environ["DEEPSEEK_BASE_URL"] = saved_base

    def test_base_url_override_via_env(self):
        # DEEPSEEK_BASE_URL 覆盖 endpoint（如 OpenCode Zen 网关）
        saved_key = os.environ.get("DEEPSEEK_API_KEY")
        saved_base = os.environ.get("DEEPSEEK_BASE_URL")
        os.environ["DEEPSEEK_API_KEY"] = "test-key"
        os.environ["DEEPSEEK_BASE_URL"] = "https://opencode.ai/zen/go/v1"
        try:
            api = DeepSeekApi()
            assert api.openai_api_base == "https://opencode.ai/zen/go/v1"
        finally:
            os.environ.pop("DEEPSEEK_API_KEY", None)
            os.environ.pop("DEEPSEEK_BASE_URL", None)
            if saved_key is not None:
                os.environ["DEEPSEEK_API_KEY"] = saved_key
            if saved_base is not None:
                os.environ["DEEPSEEK_BASE_URL"] = saved_base

    def test_model_override_via_env(self):
        saved_key = os.environ.get("DEEPSEEK_API_KEY")
        os.environ["DEEPSEEK_API_KEY"] = "test-key"
        os.environ["DEEPSEEK_MODEL"] = "deepseek-v4-pro"
        try:
            api = DeepSeekApi()
            assert api.model_name == "deepseek-v4-pro"
        finally:
            os.environ.pop("DEEPSEEK_API_KEY", None)
            os.environ.pop("DEEPSEEK_MODEL", None)
            if saved_key is not None:
                os.environ["DEEPSEEK_API_KEY"] = saved_key

    def test_missing_key_raises_like_qwen(self):
        # 与 QwenApi 行为一致：无 key 构造即失败，UI 层负责提示
        saved = os.environ.pop("DEEPSEEK_API_KEY", None)
        try:
            with pytest.raises(OpenAIError):
                DeepSeekApi()
        finally:
            if saved is not None:
                os.environ["DEEPSEEK_API_KEY"] = saved

    def test_reasoning_effort_max(self):
        # deepseek-v4-flash 是推理模型，走最强推理档（langchain-openai
        # 1.4.1 已把 reasoning_effort 收为 ChatOpenAI 一等参数）
        os.environ["DEEPSEEK_API_KEY"] = "test-key"
        try:
            api = DeepSeekApi()
            assert api._default_params["reasoning_effort"] == "max"
        finally:
            os.environ.pop("DEEPSEEK_API_KEY", None)

    def test_no_dashscope_private_params(self):
        os.environ["DEEPSEEK_API_KEY"] = "test-key"
        try:
            api = DeepSeekApi()
            extra = api._default_params.get("extra_body") or {}
            assert "enable_search" not in extra
            assert "enable_thinking" not in extra
        finally:
            os.environ.pop("DEEPSEEK_API_KEY", None)
