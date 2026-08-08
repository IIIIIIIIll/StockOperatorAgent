"""无效输入：非 6 位数字 / 北交所代码（08-07-playwright-ui-test-framework）。

错误提示在**提交后**的 rerun 中渲染（write_ui 校验分支），等待「错误
文案出现」而非固定 sleep。无效输入路径不触达 mock 图——不构造图、
不调用 build_stock_information（服务器日志审计中 CALL_COUNT 不变）。
"""

import pytest


class TestInvalidInput:

    @pytest.mark.parametrize("code", ["123", "12345", "abcdef", "00202"])
    def test_non_six_digit_code_shows_error(self, page, code):
        """非 6 位数字（含长度不足/含字母）→ 中文错误提示。"""
        page.locator("input").first.fill(code)
        page.get_by_role("button", name="提交").click()
        msg = page.get_by_text("请输入有效的六位数字股票代码").first
        msg.wait_for(timeout=30000)
        assert msg.is_visible()

    @pytest.mark.parametrize("code", ["430001", "830001"])
    def test_bj_ticker_shows_unsupported_error(self, page, code):
        """北交所代码（4/8 前缀）→ 「北交所（BJ）股票暂不支持分析」。"""
        page.locator("input").first.fill(code)
        page.get_by_role("button", name="提交").click()
        msg = page.get_by_text("北交所（BJ）股票暂不支持分析").first
        msg.wait_for(timeout=30000)
        assert msg.is_visible()
