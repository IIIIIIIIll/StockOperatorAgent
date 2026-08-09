"""make_llm 离线测试（08-09-llm-provider-agnostic）。

构造配置正确、必填校验（三键缺一即抛）、URL 格式校验、可选
reasoning_effort。ChatOpenAI 构造客户端不发起网络请求，但要求 api_key
存在（缺失时构造即抛 OpenAIError）——工厂在构造前先做必填校验，抛可读
ValueError；UI 层 display.py 已在渲染前做三键齐全检查。

env 卫生：每个用例先清空全部 LLM_* 键（monkeypatch 自动还原），防
开发者 shell/.env 残留翻转断言。
"""

import pytest

from core.llms.llm_factory import make_llm

_LLM_ENV_KEYS = ("LLM_API_KEY", "LLM_MODEL", "LLM_BASE_URL",
                 "LLM_REASONING_EFFORT")


class TestMakeLlm:

    def _clear_env(self, monkeypatch):
        for key in _LLM_ENV_KEYS:
            monkeypatch.delenv(key, raising=False)

    def _set_required(self, monkeypatch, **overrides):
        self._clear_env(monkeypatch)
        env = {"LLM_API_KEY": "test-key", "LLM_MODEL": "test-model",
               "LLM_BASE_URL": "https://api.example.com/v1"}
        env.update(overrides)
        for key, value in env.items():
            monkeypatch.setenv(key, value)

    def test_required_keys_configured(self, monkeypatch):
        self._set_required(monkeypatch)
        llm = make_llm()
        assert llm.model_name == "test-model"
        assert llm.openai_api_base == "https://api.example.com/v1"

    def test_missing_api_key_raises(self, monkeypatch):
        self._set_required(monkeypatch)
        monkeypatch.delenv("LLM_API_KEY")
        with pytest.raises(ValueError, match="LLM_API_KEY"):
            make_llm()

    def test_missing_model_raises(self, monkeypatch):
        self._set_required(monkeypatch)
        monkeypatch.delenv("LLM_MODEL")
        with pytest.raises(ValueError, match="LLM_MODEL"):
            make_llm()

    def test_missing_base_url_raises(self, monkeypatch):
        self._set_required(monkeypatch)
        monkeypatch.delenv("LLM_BASE_URL")
        with pytest.raises(ValueError, match="LLM_BASE_URL"):
            make_llm()

    def test_invalid_base_url_scheme_rejected(self, monkeypatch):
        # 裸域名不是 http(s) 前缀——格式级校验拒绝
        self._set_required(monkeypatch, LLM_BASE_URL="api.example.com")
        with pytest.raises(ValueError, match="http"):
            make_llm()

    def test_reasoning_effort_omitted_by_default(self, monkeypatch):
        # 供应商私有参数默认不传——任意 OpenAI 兼容服务安全
        self._set_required(monkeypatch)
        llm = make_llm()
        assert "reasoning_effort" not in llm._default_params

    def test_reasoning_effort_when_set(self, monkeypatch):
        # DeepSeek 用户配 LLM_REASONING_EFFORT=max 保持推理档
        self._set_required(monkeypatch, LLM_REASONING_EFFORT="max")
        llm = make_llm()
        assert llm._default_params["reasoning_effort"] == "max"
