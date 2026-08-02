"""LLM 调用重试包装（review #6，2026-08-02）。

agent 节点裸 `self.llm.invoke` 一次 429/超时/5xx 即整体失败（用户重付
全部 5 次调用 + 数据拉取）。包装：可恢复错误指数退避重试（默认 3 次，
1s 起），业务错误（400/认证）直抛零延迟。重试耗尽 reraise 原异常——
与裸 invoke 的冒泡语义一致，既有 UI 守护（display.py try/except）行为
不变。

可恢复性判定（OpenAI 兼容 SDK，langchain-openai 抛 openai/httpx 异常）：
- 可恢复：429 限流 / 500/502/503/504 / APIConnectionError / 超时
- 不重试：AuthenticationError / BadRequestError / PermissionDeniedError
  等业务错误（重试无意义）
"""

from __future__ import annotations

import httpx
import openai
import tenacity
from loguru import logger

_ATTEMPTS = 3
_BASE_DELAY = 1.0
_MAX_DELAY = 8.0

_RETRYABLE_STATUS = (429, 500, 502, 503, 504)


def _is_retryable(exc: BaseException) -> bool:
    """可恢复错误判定：限流/服务端错误/连接失败/超时 → 重试。"""
    if isinstance(exc, openai.APIStatusError) and exc.status_code in _RETRYABLE_STATUS:
        return True
    if isinstance(exc, (openai.APIConnectionError, openai.APITimeoutError,
                        httpx.ConnectError, httpx.TimeoutException)):
        return True
    return False


def invoke_with_retry(llm, payload, config=None, *, attempts=_ATTEMPTS, base_delay=_BASE_DELAY):
    """LLM 调用 + 可恢复错误退避重试（review #6）。

    :param llm: BaseChatModel（或任何 invoke(payload, config=) 兼容对象）
    :param payload: 传给 llm.invoke 的输入（agent 链为 {"query": query}）
    :param config: RunnableConfig（透传，不改变）
    :param attempts: 总尝试次数（含首次）
    :param base_delay: 退避基数（指数增长，上限 _MAX_DELAY）
    :return: llm.invoke 的返回值（AIMessage）
    :raises: 业务错误即时抛；可恢复错误耗尽后 reraise 原异常
    """
    @tenacity.retry(
        retry=tenacity.retry_if_exception(_is_retryable),
        wait=tenacity.wait_exponential(multiplier=base_delay, max=_MAX_DELAY),
        stop=tenacity.stop_after_attempt(attempts),
        reraise=True,
        before_sleep=lambda retry_state: logger.warning(
            "LLM invoke attempt {} failed with {}; retrying in {:.1f}s.",
            retry_state.attempt_number,
            type(retry_state.outcome.exception()).__name__,
            retry_state.next_action.sleep,
        ),
    )
    def _invoke():
        return llm.invoke(payload, config=config)

    return _invoke()
