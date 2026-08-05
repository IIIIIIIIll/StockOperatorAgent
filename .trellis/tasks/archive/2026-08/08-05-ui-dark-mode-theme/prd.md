# UI 主题优化:dark mode 与整体打磨

## Goal

为 Streamlit 应用(core/ui/display.py)增加 dark mode 支持,并做整体视觉打磨:主题配置、页面设置、表格/折叠条目等展示样式优化。纯展示层改造,不触碰任何业务逻辑与 LLM 上下文。

## Background

- 当前 UI 无任何主题配置(`.streamlit/config.toml` 不存在),使用 Streamlit 1.50.0(实际安装版本)默认主题。
- **Streamlit 升级(2026-08-05 用户提出,拍板升最新)**:环境 1.50.0 → **1.61.1**(最新稳定版;requirements.txt 原锁 1.54.0 一并 bump)。理由:`[theme.light]`/`[theme.dark]` 分主题表 1.51.0 引入,亮暗两套独立色板;1.61.1 必含分主题表与主题持久化修复。详见 design.md 第 0 节。
- 用户诉求(2026-08-05 确认):dark mode + 整体打磨。

## Requirements

1. **Dark mode**:应用支持暗色主题(与亮色同等打磨)。
   - **亮暗两套独立色板**(`[theme.light]` + `[theme.dark]`),初始跟随系统偏好,用户可在 Settings 菜单切换并持久。
   - 暗色/亮色两种主题下所有 UI 元素均可读:标题、表单、info/error 提示、六 Tab、markdown 表格、expander 折叠条目。
2. **整体视觉打磨**(两种主题下都生效):
   - 页面标题与图标(`st.set_page_config`,布局 wide 便于数据表格)。
   - 数据表格样式:表头、斑马纹、内边距、圆角。
   - 折叠条目(expander)样式:悬停/边框/标签。
   - 提示框(info/error)圆角与间距;整体间距一致性。
3. **保持克制**:不引入第三方依赖;不在页面内做自绘主题切换按钮(Settings 官方机制已覆盖,自绘需 session_state hack,非官方支持);不做内容级改动(如涨跌幅红绿染色——需解析文本,违反 display 薄渲染层约束,记为后续增强)。

## Constraints

- **display.py 保持薄渲染层**:不新增数据解析/格式化逻辑;新增样式为独立纯函数模块(离线可测,house style)。
- **LLM 上下文零改动**:`data_markdown.py` 与 `build_stock_information` 输出零改动(源头文本同时是 LLM 上下文)。
- **不 mock Streamlit**(house style,testing spec);测试只覆盖纯函数/常量/配置一致性。
- **全量回归环境互斥**:`streamlit run main.py` 运行期间不能跑全量 pytest(ZODB flock 不可重入)。
- **升级范围最小化**:只升 streamlit 1.50.0 → 1.61.1(requirements.txt bump `streamlit==1.61.1`);其他依赖不动(若有 1.61.1 强制依赖冲突,再最小化调整)。升级后全量回归 + 浏览器实测兜底。

## Acceptance Criteria

- [ ] **升级验证**:环境 streamlit 1.50.0 → 1.61.1,`import streamlit; streamlit.__version__` == 1.61.1;requirements.txt bump 为 `streamlit==1.61.1`;升级后全量回归通过。
- [ ] `streamlit run main.py` 启动:初始主题跟随系统偏好;Settings 可切换亮/暗并持久(rerun 后不重置);两种主题下标题/表单/提示/六 Tab/表格/expander 全部可读。
- [ ] `.streamlit/config.toml` 含 `[theme.light]` + `[theme.dark]` 两套独立色板。
- [ ] `st.set_page_config` 生效:页面标题「超绝AI股票分析系统」、图标、wide 布局。
- [ ] 数据表格有表头/斑马纹/圆角打磨,expander 有悬停反馈,info/error 圆角化——两种主题下均正常。
- [ ] `.streamlit/config.toml` 提交入库;主题色板与 `core/ui/theme.py` 常量一致(有测试钉死)。
- [ ] 新增 `test/core/ui/test_theme.py`:纯常量/字符串断言,无 Streamlit import,离线可跑。
- [ ] 全量回归:0 新增失败(先停 streamlit 进程)。
- [ ] `data_markdown.py`、`build_stock_information`、agent/图结构零改动;requirements.txt 零改动。
- [ ] spec 更新:core/index.md UI 段增补主题配置与样式层契约。

## Notes

- 实施前先全局搜主题/CSS 相关既有常量(guides 的 Pre-Modification Rule)。
- 验收时浏览器实测暗/亮切换;若 `prefers-color-scheme` 在 1.50.0 下不跟随 Streamlit 主题,回退/补充 `html[data-theme]` 属性选择器。
