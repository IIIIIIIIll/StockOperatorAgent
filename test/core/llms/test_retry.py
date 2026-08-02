"""invoke_with_retry 单元测试（review #6）：_FlakyLlm 注入，离线。

house style 无 mock 框架——假 LLM 对象直接实现 invoke 接口，计数验证
重试次数；base_delay 传小值避免测试等待退避。
"""

import openai
import pytest
from langchain_core.messages import AIMessage

from core.llms.retry import invoke_with_retry

_FAST = 0.01  # 测试用退避基数（毫秒级）


class _FlakyLlm:
    """前 fails 次抛指定异常，之后返回 AIMessage('ok')。"""

    def __init__(self, fails=0, exc=None):
        self.fails = fails
        self.exc = exc
        self.calls = 0

    def invoke(self, payload, config=None):
        self.calls += 1
        if self.calls <= self.fails:
            raise self.exc
        return AIMessage(content="ok")


def _status_exc(cls, status_code):
    """构造 openai APIStatusError 子类——openai 2.x 构造时读
    response.request，必须用真实 httpx.Response。"""
    import httpx
    request = httpx.Request("POST", "https://api.deepseek.com")
    return cls("boom", response=httpx.Response(status_code, request=request), body=None)


class TestInvokeWithRetry:

    def test_success_first_try_no_retry(self):
        llm = _FlakyLlm()
        assert invoke_with_retry(llm, {"query": "q"}, base_delay=_FAST).content == "ok"
        assert llm.calls == 1

    def test_rate_limit_recovers(self):
        llm = _FlakyLlm(fails=2, exc=_status_exc(openai.RateLimitError, 429))
        assert invoke_with_retry(llm, {"query": "q"}, base_delay=_FAST).content == "ok"
        assert llm.calls == 3  # 首次 + 2 次重试

    def test_exhausted_reraises(self):
        llm = _FlakyLlm(fails=5, exc=_status_exc(openai.RateLimitError, 429))
        with pytest.raises(openai.RateLimitError):
            invoke_with_retry(llm, {"query": "q"}, attempts=3, base_delay=_FAST)
        assert llm.calls == 3  # 耗尽即止

    def test_http_5xx_retried(self):
        llm = _FlakyLlm(fails=1, exc=_status_exc(openai.InternalServerError, 500))
        assert invoke_with_retry(llm, {"query": "q"}, base_delay=_FAST).content == "ok"
        assert llm.calls == 2

    def test_business_error_not_retried(self):
        """400 业务错误（认证/参数）→ 零重试直抛。"""
        llm = _FlakyLlm(fails=999, exc=_status_exc(openai.BadRequestError, 400))
        with pytest.raises(openai.BadRequestError):
            invoke_with_retry(llm, {"query": "q"}, attempts=3, base_delay=_FAST)
        assert llm.calls == 1

    def test_config_passthrough(self):
        seen = {}
        class _CfgLlm:
            def invoke(self, payload, config=None):
                seen["config"] = config
                return AIMessage(content="ok")
        cfg = {"configurable": {"thread_id": "1"}}
        invoke_with_retry(_CfgLlm(), {"query": "q"}, config=cfg, base_delay=_FAST)
        assert seen["config"] == cfg
