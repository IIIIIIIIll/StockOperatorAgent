"""UI 主题样式(08-05-ui-dark-mode-theme)。

PALETTE 是亮/暗两套色板的唯一 Python 源——与 .streamlit/config.toml 的
[theme.light]/[theme.dark] 同值(人工保持一致,test_theme.py 钉死,防两份
配置漂移)。CSS 是注入页面的纯样式字符串常量(**不含** <style> 标签,
display.py 用 st.html 包装注入)。

无 Streamlit import、无 I/O——纯常量模块,离线测试喂断言(house style,
与 data_markdown.py 同约定)。主题感知选择器用 @media (prefers-color-
scheme) 媒体查询:1.61.1 前端把激活主题同步到 iframe 根元素 color-scheme
(已查证),媒体查询精确匹配 Streamlit 主题而非 OS 偏好;浏览器实测兜底
(implement.md 步骤 6)。

CSS 色板注入用 string.Template($占位)——CSS 文本里 % 是常见字符(如
width: 100%),%-formatting 会把注释/内容里的裸 % 当转换符(实测踩坑:
转义注释本身含 % 即炸);$ 在 CSS 中不存在,零转义零歧义。
"""

from string import Template

# 亮/暗色板。品牌色取 A 股语境红色:亮色 #D32F2F(白底对比 4.6:1)、暗色
# #EF5350(暗底可读);中性色沿用 Streamlit 官方默认(验证过的可读性)。
PALETTE = {
    "light": {
        "primaryColor": "#D32F2F",
        "backgroundColor": "#FFFFFF",
        "secondaryBackgroundColor": "#F6F7F8",
        "textColor": "#31333F",
        "baseRadius": "0.5rem",
    },
    "dark": {
        "primaryColor": "#EF5350",
        "backgroundColor": "#0E1117",
        "secondaryBackgroundColor": "#262730",
        "textColor": "#FAFAFA",
        "baseRadius": "0.5rem",
    },
}

_LIGHT = PALETTE["light"]
_DARK = PALETTE["dark"]

# 两模式共用:紧凑页面、标题微调、组件圆角、表格结构。表格用
# border-collapse: separate + border-spacing: 0 支持圆角(默认 collapse
# 下单元格圆角不生效);行内分隔/表头强调/斑马纹按模式在媒体查询块里定。
_CSS_BASE = Template("""
.block-container { padding-top: 2rem; padding-bottom: 3rem; }

h1 { letter-spacing: 0.5px; }

[data-testid="stExpander"] { border-radius: $radius; }
[data-testid="stExpander"] summary { font-weight: 500; }

[data-testid="stAlert"] { border-radius: $radius; }

[data-testid="stMarkdownContainer"] table {
  border-collapse: separate;
  border-spacing: 0;
  width: 100%;
}
[data-testid="stMarkdownContainer"] th,
[data-testid="stMarkdownContainer"] td {
  padding: 0.4rem 0.75rem;
  text-align: left;
}
[data-testid="stMarkdownContainer"] th:first-child {
  border-top-left-radius: $radius;
}
[data-testid="stMarkdownContainer"] th:last-child {
  border-top-right-radius: $radius;
}
[data-testid="stMarkdownContainer"] tr:last-child td:first-child {
  border-bottom-left-radius: $radius;
}
[data-testid="stMarkdownContainer"] tr:last-child td:last-child {
  border-bottom-right-radius: $radius;
}
""").substitute(radius=_LIGHT["baseRadius"])

# 亮色块:表头品牌色下边框、行内分隔、斑马纹、expander 悬停主色。
_CSS_LIGHT = Template("""
@media (prefers-color-scheme: light) {
  [data-testid="stMarkdownContainer"] th {
    background: $secondary;
    border-bottom: 2px solid $primary;
  }
  [data-testid="stMarkdownContainer"] td {
    border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  }
  [data-testid="stMarkdownContainer"] tr:nth-child(even) td {
    background: rgba(0, 0, 0, 0.03);
  }
  [data-testid="stExpander"] summary:hover {
    color: $primary;
  }
}
""").substitute(secondary=_LIGHT["secondaryBackgroundColor"],
                primary=_LIGHT["primaryColor"])

# 暗色块:同构结构,暗底中性色系(白色透明度 vs 黑色透明度)。
_CSS_DARK = Template("""
@media (prefers-color-scheme: dark) {
  [data-testid="stMarkdownContainer"] th {
    background: $secondary;
    border-bottom: 2px solid $primary;
  }
  [data-testid="stMarkdownContainer"] td {
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
  [data-testid="stMarkdownContainer"] tr:nth-child(even) td {
    background: rgba(255, 255, 255, 0.04);
  }
  [data-testid="stExpander"] summary:hover {
    color: $primary;
  }
}
""").substitute(secondary=_DARK["secondaryBackgroundColor"],
                primary=_DARK["primaryColor"])

# 注入页面的完整样式(display.py: st.html(f"<style>{theme.CSS}</style>"))。
CSS = _CSS_BASE + _CSS_LIGHT + _CSS_DARK

