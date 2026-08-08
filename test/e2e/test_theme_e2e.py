"""主题：colorScheme 仿真切换亮/暗（08-07-playwright-ui-test-framework）。

1.61.1 行为（memory 记录 + 实测）：主题切换不在 ⋮ 菜单（菜单只读/
持久化），用 colorScheme 仿真——Playwright `page.emulate_media` 即
CDP `Emulation.setEmulatedMedia`（实测：raw CDP send 参数形状易错，
用原生 API 等价）。

背景色契约（.streamlit/config.toml [theme.light]/[theme.dark]）：
亮 #FFFFFF / 暗 #0E1117。初始主题跟随系统偏好（headless 默认 light）。
"""

import time


def _background_color(page) -> str:
    return page.locator("body").evaluate("el => getComputedStyle(el).backgroundColor")


def _wait_background(page, expected: str, timeout: int = 15000):
    """轮询 body 背景色至期望值（「内容出现」式等待，非固定 sleep）。"""
    deadline = time.time() + timeout
    last = ""
    while time.time() < deadline:
        last = _background_color(page)
        if last == expected:
            return last
        time.sleep(0.5)
    raise AssertionError(f"body background never reached {expected}; last={last}")


class TestTheme:

    def test_light_default_background(self, page):
        """默认亮色（headless 系统偏好 light）→ #FFFFFF。"""
        _wait_background(page, "rgb(255, 255, 255)")

    def test_dark_emulation_switches_background(self, page):
        """colorScheme=dark 仿真 + reload → 暗底 #0E1117（rgb(14, 17, 23)）。"""
        _wait_background(page, "rgb(255, 255, 255)")  # 先确认亮色基线
        page.emulate_media(color_scheme="dark")
        page.reload()
        _wait_background(page, "rgb(14, 17, 23)")

    def test_back_to_light_after_dark(self, page):
        """仿真切回 light → 恢复 #FFFFFF（仿真可逆）。"""
        page.emulate_media(color_scheme="dark")
        page.reload()
        _wait_background(page, "rgb(14, 17, 23)")
        page.emulate_media(color_scheme="light")
        page.reload()
        _wait_background(page, "rgb(255, 255, 255)")
