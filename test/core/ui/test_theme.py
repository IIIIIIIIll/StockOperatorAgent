"""08-05-ui-dark-mode-theme:主题样式纯常量测试。

theme.py 是纯常量模块(无 Streamlit import,house style)——离线断言
PALETTE 值、CSS 结构(双媒体查询块、关键选择器、亮暗块各自引用对应
色板);config.toml 一致性用标准库 tomllib 解析(无 TOML 依赖),钉死
两份配置不漂移(guides Pre-Modification Rule 精神)。display 接线用
ast 检查 write_ui 源码(与 test_display.py 的 data-tab 首项测试同约定)。
"""

import ast
import inspect
import tomllib
from pathlib import Path

from core.ui import display
from core.ui import theme

REPO_ROOT = Path(__file__).resolve().parents[3]
CONFIG_PATH = REPO_ROOT / ".streamlit" / "config.toml"

MODES = ("light", "dark")
COLOR_KEYS = ("primaryColor", "backgroundColor",
              "secondaryBackgroundColor", "textColor")


class TestThemePalette():

    def test_has_light_and_dark_modes(self):
        assert set(theme.PALETTE) == set(MODES)

    def test_color_values_are_hex(self):
        for mode in MODES:
            for key in COLOR_KEYS:
                value = theme.PALETTE[mode][key]
                assert len(value) == 7 and value[0] == "#", f"{mode}.{key}"
                int(value[1:], 16)

    def test_light_and_dark_share_base_radius(self):
        assert (theme.PALETTE["light"]["baseRadius"]
                == theme.PALETTE["dark"]["baseRadius"])

    def test_brand_red(self):
        """品牌红(A 股语境):亮色白底对比足,暗色亮于暗底。"""
        assert theme.PALETTE["light"]["primaryColor"] == "#D32F2F"
        assert theme.PALETTE["dark"]["primaryColor"] == "#EF5350"


class TestThemeCss():

    def test_no_style_tag_inside(self):
        """CSS 不含 <style> 标签——display 负责包装(st.html 契约)。"""
        assert "<style" not in theme.CSS

    def test_contains_both_theme_media_queries(self):
        assert "@media (prefers-color-scheme: light)" in theme.CSS
        assert "@media (prefers-color-scheme: dark)" in theme.CSS

    def test_contains_key_component_selectors(self):
        for selector in (
            '[data-testid="stMarkdownContainer"] table',
            '[data-testid="stExpander"]',
            '[data-testid="stAlert"]',
        ):
            assert selector in theme.CSS

    def test_light_block_uses_light_palette_only(self):
        """亮色块引用亮色板、暗色块引用暗色板(防交叉引用/硬编码)。"""
        light_block = theme.CSS.split(
            "@media (prefers-color-scheme: light)")[1].split(
            "@media (prefers-color-scheme: dark)")[0]
        dark_block = theme.CSS.split(
            "@media (prefers-color-scheme: dark)")[1]
        for key in ("primaryColor", "secondaryBackgroundColor"):
            assert theme.PALETTE["light"][key] in light_block
            assert theme.PALETTE["dark"][key] in dark_block
            assert theme.PALETTE["light"][key] not in dark_block
            assert theme.PALETTE["dark"][key] not in light_block


class TestThemeConfigConsistency():

    def test_config_toml_exists(self):
        assert CONFIG_PATH.exists()

    def test_config_palette_matches_theme_module(self):
        """config.toml 亮暗分表与 PALETTE 逐项一致(防漂移)。"""
        with open(CONFIG_PATH, "rb") as f:
            config = tomllib.load(f)
        for mode in MODES:
            section = config["theme"][mode]
            assert set(section) == set(theme.PALETTE[mode]), mode
            for key, value in theme.PALETTE[mode].items():
                assert section[key] == value, f"{mode}.{key}"


class TestDisplayThemeWiring():
    """display.write_ui 接线(ast 检查源码,house style 同 test_display.py
    的 data-tab 首项测试)。"""

    @staticmethod
    def _write_ui_tree():
        return ast.parse(inspect.getsource(display.write_ui))

    def test_set_page_config_is_first_call(self):
        """set_page_config 必须是 write_ui 首个语句(Streamlit 要求)。"""
        tree = self._write_ui_tree()
        func = next(n for n in ast.walk(tree)
                    if isinstance(n, ast.FunctionDef) and n.name == "write_ui")
        first = func.body[0]
        assert isinstance(first, ast.Expr)
        call = first.value
        assert isinstance(call, ast.Call)
        assert isinstance(call.func, ast.Attribute)
        assert call.func.attr == "set_page_config"

    def test_theme_css_injected_via_st_html(self):
        tree = self._write_ui_tree()
        html_calls = [n for n in ast.walk(tree)
                      if isinstance(n, ast.Call)
                      and isinstance(n.func, ast.Attribute)
                      and n.func.attr == "html"]
        assert len(html_calls) == 1
        assert "theme.CSS" in inspect.getsource(display.write_ui)
