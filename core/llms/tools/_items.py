"""result[].content[] 条目收集（08-09-agent-base-class）——3 处收敛。

亿信 search/twitter 工具与信息面分析师的预抓分节共用同一 walk（响应
契约 research/billions-api.md：``result[].content[]`` 为条目列表；status
失败已被 client 归一化为 BillionsApiError，result 恒为成功条目）。契约
容错逻辑单点维护（code-reuse guide：契约单点维护，防漂移）——新增消费方
直接导入，不再复制。
"""

from __future__ import annotations


def collect_content_items(data: dict) -> list[dict]:
    """响应 result[].content[] 条目收集（非 dict 脏条目跳过，字段缺失容错）。

    :param data: 亿信响应 dict（search/twitter 形态；result 允许缺失）
    :return: content 中的 dict 条目列表（非 dict 结构条目跳过）
    """
    items = []
    for entry in data.get("result") or []:
        if not isinstance(entry, dict):
            continue
        content = entry.get("content")
        if not isinstance(content, list):
            continue
        for item in content:
            if isinstance(item, dict):
                items.append(item)
    return items
