"""设置面板（08-08-billions-switches-ui，Step 4）。

e2e 交互用例（模块级函数风格，同目录既有约定）：
- 用例 A：侧边栏「设置」展开 → 4 分区可见、5 个 password 框存在且
  不回显明文（dummy key 下值为空、placeholder 只表明已配置与否）；
- 用例 B：会话开关生效——「亿信信息面分析师」toggle 关 → 提交 → 7 Tab
  无「信息面分析」；切回开 → 提交 → 8 Tab（复用 test_billions_tab 断言
  模式；rerun 后 toggle 状态保持 session_state）；
- 用例 C：保存路径隔离——改模型 + 填新密钥 → 保存 → st.success 出现；
  tmp .env（ENV_FILE_PATH，conftest e2e_env_file fixture）含新值；
  **真实 .env（REPO_ROOT/.env）零修改**（内容逐字节不变）。

零真实链路保证：面板交互只写 tmp .env / 运行时覆盖层，不触发任何网络
——conftest 的 pytest_sessionfinish 零调用审计覆盖（E2E_MOCK_CALL_COUNT
≥1 来自提交型用例的 mock 图构造）。

1.61.1 DOM 实测（改动前浏览器验证）：
- st.toggle 渲染为 `[data-testid="stCheckbox"]`（非 stToggle），内含
  role="switch" 的隐藏 checkbox input（aria-label = 标签文本）——点击
  stCheckbox 容器切换，input.is_checked() 断言状态；rerun 期间点击可能
  被 React 重渲染吞掉 → 状态轮询重试（与 _open_tab 同模式）；
- st.selectbox 是 react-aria ComboBox（**非原生 select，selectOption
  不可用**）：点击 `[data-testid="stSelectbox"]` 容器 → `[role="option"]`
  弹层 → 点击选项（全量回归负载下弹层偶发未开 → _select_model 重试）；
- number_input 是原生 input[type="number"]（aria-label = 标签文本），
  fill 可用；
- 折叠 expander 内容在 DOM 中但不可见——交互前先点击展开（幂等 helper）；
- conftest 显式清除面板相关 env（_PANEL_ENV_KEYS）——既有测试的 env
  泄漏（TDX_API_KEY=dummy 等）不得翻转面板 placeholder/初始值。
"""

import os
import time
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]
_REAL_ENV = _REPO_ROOT / ".env"

# 侧边栏会话区 toggle 的 stCheckbox 容器选择器（label 文本过滤）
_TOGGLE = '[data-testid="stCheckbox"]'


def _expand_settings(page):
    """展开侧边栏「设置」expander（幂等：已展开则直接返回）。"""
    if page.get_by_text("模型与密钥（持久化）").first.is_visible():
        return
    page.locator('[data-testid="stSidebar"] [data-testid="stExpander"]').first.click()
    page.get_by_text("模型与密钥（持久化）").first.wait_for(state="visible", timeout=10000)


def _submit_002027(page):
    page.get_by_label("股票代码").fill("002027")
    page.get_by_role("button", name="提交").click()


def _wait_tabs_ready(page):
    """tab 条渐进渲染——等最后一个 tab（最终结论）出现再交互。"""
    page.locator('[role="tab"]').filter(has_text="最终结论").first.wait_for(timeout=30000)


def _wait_full_settle(page):
    """等整次提交 rerun 完全结束：图流最后的 final_decision 渲染进 DOM。

    实测（probe）：tab 条出现 ≠ rerun 结束——mock 报告按节点渐进渲染，
    rerun 期间点击侧边栏 toggle 的 value 消息会被吞/滞后（切回开时曾
    实测提交后仍 7 Tab）。final_decision 是 FakeGraph 最后 superstep，
    其文本（`> mock 最终结论`）出现在 DOM = 图流 done + 报告渲染完成，
    此后与侧边栏交互才可靠。注意面板默认隐藏——用 state="attached"
    （DOM 存在即可，不要求可见）。
    """
    page.get_by_text("mock 最终结论").first.wait_for(state="attached", timeout=30000)


def _tab_labels(page):
    return [t.inner_text() for t in page.locator('[role="tab"]').all()]


def _select_model(page, option_text: str, timeout: int = 20) -> None:
    """在「DeepSeek 模型」selectbox 选择选项（react-aria ComboBox）。

    点 stSelectbox 容器开弹层 → 点 [role="option"]；弹层偶发未开/点击被
    吞（全量回归负载下实测超时）→ 重试，以 combobox 输入值变为成功判据
    （幂等：已选中则直接返回）。
    """
    box = page.locator('[data-testid="stSidebar"] [data-testid="stSelectbox"]')
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            if page.get_by_label("DeepSeek 模型").input_value() == option_text:
                return
        except Exception:
            pass
        try:
            box.click(timeout=5000)
            page.locator('[role="option"]').filter(has_text=option_text).first.click(timeout=5000)
        except Exception:
            pass  # 弹层未开/点击被吞 → 下一轮重试
    raise AssertionError(f"selectbox option {option_text!r} never selected")


def _set_toggle(page, label: str, want: bool, timeout: int = 20) -> None:
    """把会话区 toggle 设为 want。

    点击 stCheckbox 容器（label 文本过滤）→ 轮询 input.is_checked()
    状态翻转；rerun 期间点击可能被 React 重渲染吞掉（实测）——未翻转
    则重试（与 _open_tab 同模式，幂等）。
    """
    cb = page.locator(_TOGGLE).filter(has_text=label).first
    inp = cb.locator("input")
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            if inp.is_checked() is want:
                return
        except Exception:
            pass  # rerun 中元素重建/暂缺 → 下一轮
        try:
            cb.click(timeout=5000)
        except Exception:
            pass  # 元素未就绪/点击被吞 → 下一轮
        poll = time.time() + 5
        while time.time() < poll:
            try:
                if inp.is_checked() is want:
                    return
            except Exception:
                pass
            time.sleep(0.2)
    raise AssertionError(f"toggle {label!r} never reached state {want}")


def test_settings_panel_sections_and_password_hidden(page):
    """用例 A：设置面板 4 分区 + 5 个 password 框不回显明文。

    dummy key 注入（conftest）→ 4 个主密钥框 placeholder 为「已配置
    （留空表示不修改）」；所有 password 框值为空（面板不留值——不明文
    回显，AC3）；widget 计数：selectbox 1 / toggle 8 / number_input 3。
    """
    _expand_settings(page)
    # 4 分区标题
    for section in ("模型与密钥（持久化）", "LangSmith（持久化）",
                    "能力开关（会话级）", "亿信调用上限（会话级）"):
        assert page.get_by_text(section).first.is_visible(), f"section {section} not visible"
    # 5 个 password 框：存在、type=password、值为空（不回显明文）
    pws = page.locator('[data-testid="stSidebar"] input[type="password"]')
    assert pws.count() == 5, f"expected 5 password inputs, got {pws.count()}"
    for pw in pws.all():
        assert pw.get_attribute("type") == "password"
        assert pw.input_value() == "", "password 框不应回显明文"
    # placeholder 反映 env 配置态（AC3 两态）：已配置 → 「已配置（留空
    # 表示不修改）」，未配置 → 「未配置（输入后保存）」。conftest 注入
    # dummy DEEPSEEK_API_KEY + BILLIONS_API_KEY（无 DASHSCOPE/TDX）。
    assert page.get_by_label("DeepSeek API Key").get_attribute("placeholder") == "已配置（留空表示不修改）"
    assert page.get_by_label("亿信 API Key（可选）").get_attribute("placeholder") == "已配置（留空表示不修改）"
    assert page.get_by_label("DashScope API Key（Qwen 可选）").get_attribute("placeholder") == "未配置（输入后保存）"
    assert page.get_by_label("通达信 TDX API Key（可选）").get_attribute("placeholder") == "未配置（输入后保存）"
    assert page.get_by_label("LangSmith API Key").get_attribute("placeholder") == "留空表示不修改"
    # widget 计数（结构断言）：selectbox 1（模型）+ toggle 9（LangSmith
    # 追踪 + 会话区 8）+ number_input 3（亿信上限）
    assert page.locator('[data-testid="stSidebar"] [data-testid="stSelectbox"]').count() == 1
    assert page.locator('[data-testid="stSidebar"] [data-testid="stCheckbox"]').count() == 9
    assert page.locator('[data-testid="stSidebar"] input[type="number"]').count() == 3


def test_session_toggle_analyst_off_on_tab_count(page):
    """用例 B：ANALYST 会话开关切换 → 下次提交生效（7 Tab ↔ 8 Tab）。

    关 → 提交 → 7 Tab 无「信息面分析」（与无 key 布局一致）；切回开 →
    提交 → 8 Tab 含「信息面分析」（第 4 位）。toggle 状态存 session_state，
    rerun 后保持——提交前不重置。
    """
    _expand_settings(page)
    # 关 ANALYST（初始开：conftest 注入 dummy key）
    _set_toggle(page, "信息面分析师（ANALYST）", want=False)
    _submit_002027(page)
    _wait_tabs_ready(page)
    # 等图流完全结束再断言/交互（见 _wait_full_settle——rerun 中点击
    # toggle 会被吞，曾实测切回开失败）
    _wait_full_settle(page)
    labels = _tab_labels(page)
    assert labels == ["采集数据", "基本面分析", "趋势分析", "技术指标分析",
                      "看涨观点", "看跌观点", "最终结论"], f"expected 7 tabs, got {labels}"
    assert page.locator('[role="tab"]').filter(has_text="信息面分析").count() == 0
    # 切回开（rerun 后 toggle 保持 session_state；expander 状态保持）
    _expand_settings(page)
    _set_toggle(page, "信息面分析师（ANALYST）", want=True)
    _submit_002027(page)
    _wait_tabs_ready(page)
    _wait_full_settle(page)
    labels = _tab_labels(page)
    assert labels == ["采集数据", "基本面分析", "趋势分析", "技术指标分析",
                      "信息面分析", "看涨观点", "看跌观点", "最终结论"], f"expected 8 tabs, got {labels}"


def test_save_writes_tmp_env_not_real(page, e2e_env_file):
    """用例 C：保存路径隔离——tmp .env 写入新值、真实 .env 零修改。

    改 DEEPSEEK_MODEL → deepseek-v4-pro + 填 DeepSeek API Key dummy 新值
    → 保存 → st.success；断言 ENV_FILE_PATH 指向的 tmp .env 含新值
    （服务器侧 update_env_file 经 env_file_path() 落该路径）；断言真实
    .env（REPO_ROOT/.env）内容逐字节不变（e2e 不碰开发者配置）。
    """
    real_before = _REAL_ENV.read_text(encoding="utf-8") if _REAL_ENV.exists() else None
    _expand_settings(page)
    # selectbox：容器点击打开弹层 → 点 option（react-aria ComboBox；
    # 全量回归负载下弹层偶发未开——_select_model 重试 + 值校验）
    _select_model(page, "deepseek-v4-pro")
    # password 框填新值（dummy 值，不回显——只测写入路径）
    page.get_by_label("DeepSeek API Key").fill("dummy-new-key")
    page.get_by_role("button", name="保存").click()
    page.get_by_text("配置已保存到 .env 并立即生效").first.wait_for(timeout=10000)
    # tmp .env 内容断言
    content = e2e_env_file.read_text(encoding="utf-8")
    assert "DEEPSEEK_MODEL=deepseek-v4-pro" in content
    assert "DEEPSEEK_API_KEY=dummy-new-key" in content
    # 真实 .env 零修改
    real_after = _REAL_ENV.read_text(encoding="utf-8") if _REAL_ENV.exists() else None
    assert real_after == real_before, "真实 .env 被修改——保存未隔离到 tmp 路径"
