"""亿信信息面 Tab（08-08-billions-api-integration，Step 5）。

mock 模式双服务器断言：
- 主服务器（conftest 注入 dummy BILLIONS_API_KEY）→ ANALYST 开关开 →
  「信息面分析」Tab 真实渲染路径被覆盖（mock 报告含亿信来源样式——
  公告/研报/新闻条目）；
- server_no_billions（无 BILLIONS_API_KEY）→ ANALYST 关 → 无该 Tab
  （AC1：未配置 key 现有 UI 零行为变化，7 tab 与今日一致）。

零真实亿信调用由 conftest 审计保证（_REAL_FLOW_MARKERS 含
openapi.billionsintelligence.com / BillionsApiError——真实调用失败必打
warning，mock 路径绝不产生）。

风格：模块级测试函数（e2e 目录有意例外，见 testing spec），等待用
「内容出现」条件而非固定 sleep。
"""

import time


def _submit(page):
    page.get_by_label("股票代码").fill("002027")
    page.get_by_role("button", name="提交").click()


def _wait_final_tab(page):
    """tab 条渐进渲染——等最后一个 tab（最终结论）出现再交互。"""
    page.locator('[role="tab"]').filter(has_text="最终结论").first.wait_for(timeout=30000)


def _open_tab(page, tab_name: str, content_marker: str, timeout: int = 30000):
    """点击 tab 并等面板内容可见；点击可能被 rerun 的 React 重渲染吞掉
    （实测偶发）——失败重试，幂等（同 test_interaction 的 helper）。"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        tab = page.locator('[role="tab"]').filter(has_text=tab_name).first
        try:
            tab.click(timeout=5000)
        except Exception:
            pass  # 元素未就绪/点击被吞 → 下一轮重试
        try:
            page.get_by_text(content_marker).first.wait_for(timeout=5000)
            return
        except Exception:
            pass
    raise AssertionError(f"tab {tab_name!r} content {content_marker!r} never became visible")


def test_information_analysis_tab_renders_mock_content(page):
    """ANALYST 开（dummy key）：信息面 Tab 存在，mock 报告渲染进 Tab。

    mock 内容（mock_committee.MOCK_REPORTS["information_analysis"]）含
    带来源/日期的条目（公告/研报/新闻）——断言「mock 内容原样渲染进
    对应 Tab」（与真实 LLM 输出无关，镜像真实 analyst 报告样式）。
    """
    _submit(page)
    _wait_final_tab(page)
    _open_tab(page, "信息面分析", "信息面分析（mock）")
    assert page.get_by_text("mock 信息面结论").first.is_visible()
    assert page.get_by_text("研报（机构: 某券商）").first.is_visible()


def test_no_key_no_information_tab(page_no_billions):
    """无 BILLIONS_API_KEY（AC1）：7 个 tab（数据 + 6 报告），无信息面 Tab。

    与 server_no_billions 服务器配对——无 key → report_tabs() 与今日
    逐字节一致（信息面分析是唯一条件 Tab）。
    """
    _submit(page_no_billions)
    _wait_final_tab(page_no_billions)
    tabs = page_no_billions.locator('[role="tab"]')
    labels = [t.inner_text() for t in tabs.all()]
    assert len(labels) == 7, f"expected 7 tabs without key, got {labels}"
    assert labels == ["采集数据", "基本面分析", "趋势分析", "技术指标分析",
                      "看涨观点", "看跌观点", "最终结论"]
    assert page_no_billions.locator('[role="tab"]').filter(
        has_text="信息面分析").count() == 0
