"""亿信工具工厂公共骨架（08-09-agent-base-class）——capped_call 单点承载。

亿信三工具（billions_search/billions_twitter/billions_fetch）工厂内部的
调用体骨架完全同构：上限判定（已达上限占位文本**逐字节保留**）→ 计数 →
try/except → logger.warning + 失败占位文本（不 raise，error-handling
spec 降级风格——模型拿到占位 ToolMessage 继续生成，图不中断）。工厂仍
各自保留差异化：开关判定、client 懒加载、@tool 装饰函数（签名/docstring
= LLM 工具 schema，钉死不变）——capped_call 只包执行体。

占位文本由调用方传格式串（cap_text/fail_fmt，{max_calls}/{exc} 插值）：
三工具的占位措辞各不相同（检索/推特检索/全文抓取；再检索/再抓取），
单 label 参数无法逐字节还原——格式串直传保证逐字保留（cap 语义与
tool_loop 兜底依赖这些文本的调用方行为）。
"""

from __future__ import annotations

from loguru import logger


def capped_call(counter: list, max_calls: int, cap_text: str, fail_fmt: str,
                warn_msg: str, fn, *args, **kw) -> str:
    """亿信工具调用体骨架：上限判定 → 计数 → try/except 降级占位（不 raise）。

    :param counter: 单元素可变计数器（工厂闭包持有，跨调用累计——单次
        run 内超限后不再发真实请求）
    :param max_calls: 单次 run 调用硬上限
    :param cap_text: 已达上限占位格式串（{max_calls} 插值，逐字保留）
    :param fail_fmt: 失败占位格式串（{exc} 插值，逐字保留）
    :param warn_msg: logger.warning 前缀（loguru 占位符风格，参数为 exc）
    :param fn: 真实调用（返回工具文本；任何异常 → 降级占位文本）
    :return: 工具返回文本（成功结果 / 上限占位 / 失败占位）
    """
    if counter[0] >= max_calls:
        return cap_text.format(max_calls=max_calls)
    counter[0] += 1
    try:
        return fn(*args, **kw)
    except Exception as exc:
        logger.warning(warn_msg, exc)
        return fail_fmt.format(exc=exc)
