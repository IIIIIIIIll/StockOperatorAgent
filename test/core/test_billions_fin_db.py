"""亿信 fin-db 前置槽位单测（08-08-billions-api-integration，Step 2，离线）。

覆盖（implement.md Step 2 清单 + 任务要求）：
- 开关关（无 key / 能力闸 / 总闸）→ 空串 ""，且不触发客户端
- 开关开 + fake client 注入 → 段文本（标题「亿信金融数据库」/ 内容），
  问数含 ticker（auto 路由，不传 data_sources）
- fake client 抛 BillionsApiError / 一般异常 / 返回空结果 → 不 raise、
  占位段、不写污染内容（AC4）
- build_stock_information 的 `_billions_intel` 注入参数覆盖：注入段拼接
  （在实时情报之后）/ 返回空串不拼接（其余四段不受影响）

house style 无 mock 框架——fake 对象注入（`_client` / `_billions_intel`）+
env save/restore（对齐 test_billions_config._with_env 模式，跨运行确定性）。
"""

import os

from data_source.chinese_mainland.billions.client import BillionsApiError
from core.investment_committee import build_stock_information
from core.llms.tools.billions_fin_db import get_billions_financial_intel

# fin-db 相关 BILLIONS_* env——每次运行前全部清除（防开发者本机残留）
_ENV_KEYS = [
    "BILLIONS_API_KEY",
    "BILLIONS_DISABLED",
    "BILLIONS_FINDB_DISABLED",
]


def _with_env(pairs, fn):
    """临时设置 env（None 值 = 清除），fn 执行后恢复原状（跨运行确定性）。

    先全量清空 _ENV_KEYS（显式置空串）再应用 pairs：空串为显式假值且
    load_dotenv 不覆盖已设键——防开发者 shell/.env 残留 BILLIONS_* 翻转用例。
    """
    saved = {key: os.environ.get(key) for key in _ENV_KEYS}
    try:
        for key in _ENV_KEYS:
            os.environ[key] = ""
        for key, value in pairs.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        return fn()
    finally:
        for key, value in saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


class _FakeClient:
    """记录 fin_db 调用；按预置返回响应或抛异常（house style 注入）。

    断言不写在 fake 里（失败会先被工具降级为占位文本）——fake 只记录，
    断言在测试侧读 ``calls``。
    """

    def __init__(self, data=None, error=None):
        self._data = data
        self._error = error
        self.calls = []

    def fin_db(self, query, data_sources=None):
        self.calls.append({"query": query, "data_sources": data_sources})
        if self._error is not None:
            raise self._error
        return self._data


_OK = {
    "success": True,
    "result": [
        {
            "query": "查询000001的最新财务数据…",
            "content": "| 项目 | 值 |\n|---|---|\n| 净利润 | 123.45亿 |",
            "status": "ok",
            "source": "A股财务行情数据库",
        }
    ],
}


class TestGetBillionsFinancialIntel:

    def test_no_key_returns_empty_string(self):
        assert _with_env(
            {"BILLIONS_API_KEY": None},
            lambda: get_billions_financial_intel("000001"),
        ) == ""

    def test_findb_capability_switch_disables(self):
        assert _with_env(
            {"BILLIONS_API_KEY": "k", "BILLIONS_FINDB_DISABLED": "1"},
            lambda: get_billions_financial_intel("000001"),
        ) == ""

    def test_master_switch_disables(self):
        assert _with_env(
            {"BILLIONS_API_KEY": "k", "BILLIONS_DISABLED": "true"},
            lambda: get_billions_financial_intel("000001"),
        ) == ""

    def test_switch_off_never_calls_client(self):
        # 开关关 → 空串且不触发客户端（注入 fake 计数验证，零网络）
        fake = _FakeClient(_OK)
        _with_env(
            {"BILLIONS_API_KEY": None},
            lambda: get_billions_financial_intel("000001", _client=fake),
        )
        assert fake.calls == []

    def test_success_returns_markdown_section(self):
        fake = _FakeClient(_OK)
        text = _with_env(
            {"BILLIONS_API_KEY": "k"},
            lambda: get_billions_financial_intel("000001", _client=fake),
        )
        # 来源标注（段落标题）+ 响应内容原样
        assert "【亿信金融数据库】" in text
        assert "| 净利润 | 123.45亿 |" in text
        # 固定问数围绕该 ticker（auto 路由：不传 data_sources，client 默认）
        assert "000001" in fake.calls[0]["query"]
        assert "最新财务数据" in fake.calls[0]["query"]
        assert fake.calls[0]["data_sources"] is None

    def test_multiple_results_joined(self):
        payload = {
            "success": True,
            "result": [
                {"content": "表A"},
                {"content": "表B"},
                {"content": ""},  # 空条目跳过（字段缺失容错）
                "dirty",  # 非 dict 条目跳过
            ],
        }
        fake = _FakeClient(payload)
        text = _with_env(
            {"BILLIONS_API_KEY": "k"},
            lambda: get_billions_financial_intel("000001", _client=fake),
        )
        assert "表A" in text and "表B" in text

    def test_billions_api_error_returns_placeholder(self):
        fake = _FakeClient(
            error=BillionsApiError("亿信 API 错误：HTTP 429", code="rate limit", status_code=429)
        )
        text = _with_env(
            {"BILLIONS_API_KEY": "k"},
            lambda: get_billions_financial_intel("000001", _client=fake),
        )
        # 占位段说明数据不可用，不 raise（断言本身已隐含）
        assert "亿信金融数据库" in text
        assert "000001" in text
        assert "跳过" in text
        # 不写污染 stock_information 的语义内容（AC4）
        assert "| 净利润" not in text

    def test_generic_exception_returns_placeholder(self):
        # 非 BillionsApiError 的意外异常同样降级（不 raise 打断 agent 流程）
        fake = _FakeClient(error=ValueError("boom"))
        text = _with_env(
            {"BILLIONS_API_KEY": "k"},
            lambda: get_billions_financial_intel("000001", _client=fake),
        )
        assert "亿信金融数据库" in text
        assert "跳过000001" in text

    def test_empty_result_returns_placeholder(self):
        fake = _FakeClient({"success": True, "result": []})
        text = _with_env(
            {"BILLIONS_API_KEY": "k"},
            lambda: get_billions_financial_intel("000001", _client=fake),
        )
        assert "亿信金融数据库" in text
        assert "无返回结果" in text


class TestBuildStockInformationBillions:
    """`_billions_intel` 注入参数覆盖验证（不触发真 client）。

    其余四段走真实现（与 test_committee_enrichment 同模式：002714 +
    清 TDX_API_KEY——情报段降级占位，不触网）。
    """

    def test_injected_segment_appended(self):
        saved = os.environ.pop("TDX_API_KEY", None)
        try:
            text = build_stock_information(
                "002714",
                _billions_intel=lambda ticker: f"【亿信金融数据库】\n{ticker} 的模拟问数结果",
            )
            # 注入段拼入 stock_information（含来源标注与内容）
            assert "【亿信金融数据库】" in text
            assert "002714 的模拟问数结果" in text
            # 拼接顺序：个股信息 → 技术指标 → 财务指标 → 实时情报 → 亿信
            assert text.find("【亿信金融数据库】") > text.find("未配置 TDX_API_KEY")
        finally:
            if saved is not None:
                os.environ["TDX_API_KEY"] = saved

    def test_empty_injected_segment_not_appended(self):
        # 注入返回空串 = 开关关语义 → 该段不出现，其余四段不受影响
        saved = os.environ.pop("TDX_API_KEY", None)
        try:
            text = build_stock_information("002714", _billions_intel=lambda ticker: "")
            assert "【亿信金融数据库】" not in text
            assert "技术指标" in text
            assert "未配置 TDX_API_KEY" in text
        finally:
            if saved is not None:
                os.environ["TDX_API_KEY"] = saved

    def test_progress_line_gated_on_findb_switch(self):
        # 开关开 → 亿信段进度提示输出（fin_db 慢调用需 UI 反馈）；
        # 开关关 → 不闪无效进度（零行为变化，AC1）
        saved = os.environ.pop("TDX_API_KEY", None)
        try:
            messages = []
            _with_env(
                {"BILLIONS_API_KEY": "k"},
                lambda: build_stock_information(
                    "002714",
                    progress=messages.append,
                    _billions_intel=lambda ticker: "【亿信金融数据库】\nmock",
                ),
            )
            assert any("亿信金融问数" in m for m in messages)

            messages = []
            _with_env(
                {"BILLIONS_API_KEY": None},
                lambda: build_stock_information(
                    "002714",
                    progress=messages.append,
                    _billions_intel=lambda ticker: "【亿信金融数据库】\nmock",
                ),
            )
            assert not any("亿信金融问数" in m for m in messages)
        finally:
            if saved is not None:
                os.environ["TDX_API_KEY"] = saved
