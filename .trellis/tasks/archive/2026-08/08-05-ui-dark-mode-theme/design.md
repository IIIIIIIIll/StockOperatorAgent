# 设计:UI 主题优化(dark mode + 整体打磨)

## 0. Streamlit 升级(2026-08-05 用户提出)

**从 1.50.0 升级到最新版 1.61.1**(2026-08-05 用户拍板;requirements.txt 原锁 1.54.0 一并 bump)。

理由(已查证):
- **`[theme.light]` / `[theme.dark]` 分主题表是 1.51.0 引入**(2025-11-01,issue #5134 长期诉求落地)——亮暗两套独立色板,正是本次"两种主题都打磨到位"所需;1.50.0 只有单一 `[theme]` 表(自定义色对两模式共用,亮色质量受限)。
- **1.54.0 wheel 已确认含 `CustomThemeCategories.LIGHT/DARK/LIGHT_SIDEBAR/DARK_SIDEBAR`**(已下载轮子 grep 验证);1.61.1 为更新版,必含。
- **主题持久化回归**(1.51.0/1.52.1,issue #13280:Settings 选择的主题 rerun/刷新后重置)修复 PR #13306 于 2025-12-12 合入 develop——1.61.1 必含。
- 应用所用 API(st.title/tabs/expander/form/markdown/set_page_config)全部为多年稳定接口;升级后全量回归 + 浏览器实测兜底。
- **实施前必须核对 1.61.1 wheel METADATA 依赖区间**与 requirements.txt 现有 pin(altair/pydeck/pandas/numpy/tornado/protobuf),冲突则同步 bump 或评估(实施步骤 0 已含)。

## 1. 主题机制:`.streamlit/config.toml`(官方机制,零代码)

新建 `.streamlit/config.toml`,亮暗**两套独立色板**(1.54.0 分主题表):

```toml
[theme]
base = "light"                        # 初始主题:自定义主题存在时跟随系统偏好(已查证语义)
font = "sans-serif"

[theme.light]
primaryColor = "<品牌色>"
backgroundColor = "<亮色背景>"
secondaryBackgroundColor = "<亮色次级背景>"
textColor = "<亮色正文>"

[theme.dark]
primaryColor = "<品牌色>"
backgroundColor = "<暗色背景>"
secondaryBackgroundColor = "<暗色次级背景>"
textColor = "<暗色正文>"
```

**关键语义(1.54.0 已查证)**:
- 同时提供 `[theme.light]` + `[theme.dark]` → Settings 里出现 "Custom Theme Light"/"Custom Theme Dark" 两项,初始按**系统偏好**选择(1.51.0 发布说明语义);用户手动切换后持久(1.54.0 含 #13306 修复)。
- 主区域色键 `[theme]` < `[theme.light/dark]` 优先(PR #12760 语义);sidebar 因本应用无侧栏,不配置。
- `redColor`/`greenColor` 等系列色键存在但当前无图表消费,暂不配置(避免配置了没人用)。

**决策:亮暗都完整设计,初始跟随系统**(升级方案的自然结果);不强制暗色默认。用户若坚持默认暗色,可后续加 `[theme.dark]` 为唯一主题或设 base 语义调整——记为 spec 备注,本次不特殊化。

## 2. 样式层:`core/ui/theme.py`(新模块,纯常量,无 Streamlit import)

### 结构

- `PALETTE: dict[str, str]` —— 主题色板常量(与 config.toml 同源值)。
- `CSS: str` —— 注入的 `<style>` 内容(**不含** `<style>` 标签本身,display 负责包 `st.markdown(f"<style>{CSS}</style>", unsafe_allow_html=True)`)。
- 可选纯函数(若样式需参数化,如按主题差异拼装)——**默认无参**;保持常量优先,测试最简单。

### 主题适配选择器

- 主方案:`@media (prefers-color-scheme: dark) { ... }` —— 已查证 1.50.0 前端 JS 引用 `prefers-color-scheme`,iframe 根元素 color-scheme 跟随**激活主题**(非 OS 偏好),故该媒体查询精确匹配 Streamlit 暗色。
- 回退:实施时浏览器 devtools 实测;若不生效,补充 `html[data-theme="dark"]` 属性选择器(两套选择器并存无害,只覆盖需要的属性)。

### 打磨范围(保持克制,薄渲染层)

| 元素 | 打磨 | 说明 |
|---|---|---|
| 标题 | 字号/字重/品牌色点缀 | `st.title` 后无容器,用 `[data-testid="stAppViewContainer"] h1` 或 `.stMarkdown h1` |
| markdown 表格 | 表头背景、斑马纹、内边距、圆角、边框 | 采集数据 Tab 主战场;选择器 `[data-testid="stMarkdownContainer"] table` 及 `th`/`td`/`tr:nth-child(even)` |
| expander | 悬停边框/标签字重、圆角 | 观点 Tab 折叠条目;`details` 选择器 |
| info/error 提示 | 圆角、内边距 | `[data-testid="stAlert"]`(info 与 error 都覆盖) |
| 按钮 | 主按钮品牌色 | Streamlit 已用 primaryColor 自动上色,仅确认不额外写 |
| 间距 | 表单/容器上边距微调 | 少量 |

**暗色专用修正**(在 `prefers-color-scheme: dark` 块内):若 Streamlit 暗色默认样式对 markdown 表格/alert 有对比度问题,覆写背景/边框——**实测后按需**,不为写而写。

## 3. 页面设置:write_ui 顶部

`st.set_page_config(page_title="超绝AI股票分析系统", page_icon="📈", layout="wide")`——必须是**首个** st 调用(Streamlit 要求),插在 `st.title` 之前。wide 布局让六 Tab 的宽表更舒展。

## 4. 接线(display.py 改动最小化)

```python
st.set_page_config(...)          # 新增:首个 st 调用
st.markdown(f"<style>{theme.CSS}</style>", unsafe_allow_html=True)  # 新增
st.title("超绝AI股票分析系统")    # 既有
```
仅两行新增,渲染流程/事件循环/tab 契约零改动。

## 5. 测试:`test/core/ui/test_theme.py`(离线,house style)

- 纯常量断言:CSS 含暗色媒体查询块、表格/expander/alert 选择器;PALETTE 值合法 hex。
- **配置一致性测试**:`tomllib` 解析 `.streamlit/config.toml`,断言 `[theme]` 的 base/颜色键值与 `theme.PALETTE` 一致——防两份配置漂移(guides Pre-Modification Rule 精神)。
- 无 streamlit import;`pytest test/core/ui/` 秒级离线可跑。

## 6. 不做(边界)

- 应用内主题切换按钮(非官方,需 session_state hack)。
- 涨跌幅红绿染色(需解析文本 → 违反薄渲染层;后续增强)。
- `data_markdown.py` / `build_stock_information` / agent / 图结构:零改动。
- 新增依赖:零。
- `.streamlit/config.toml` 之外无全局配置改动(server 段不动,避免行为变化)。

## 7. 回滚

- 代码改动全部为新增文件 + display.py 两行;回滚 = 删 `.streamlit/`、`core/ui/theme.py`、`test_theme.py`,还原 display.py 两行。无迁移、无数据风险。
- 版本升级回滚 = `pip install streamlit==1.50.0`(requirements.txt 本就锁 1.54.0,不动)。
- 提交前若浏览器实测发现主题适配选择器失效 → 停在第 6 步,补选择器后重测,不带着未验证的样式提交。
