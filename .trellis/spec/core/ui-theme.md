---
description: UI 主题 — .streamlit/config.toml 双主题色板、theme.py CSS 注入
paths:
  - core/ui/theme.py
  - .streamlit/config.toml
---
# UI 主题（`core/ui/theme.py`、`.streamlit/config.toml`）

- **2026-08-05（主题:dark mode 与整体打磨,08-05-ui-dark-mode-theme）**：
  - **Streamlit 版本基线 1.61.1**（环境与 requirements.txt 同步,自 1.50.0
    升级）：1.51.0 起支持 `[theme.light]`/`[theme.dark]` 分主题表（亮暗
    两套独立色板）；Settings 主题选择持久化（1.54+ 含 #13306 修复）；1.61
    起内置 uvicorn 服务。改动前先核对安装版与 pin（requirements.txt 可能
    领先/落后环境）。
  - **`.streamlit/config.toml`**：`[theme]`（base="light" + font）+
    `[theme.light]`/`[theme.dark]` 两套色板——品牌红（A 股语境）亮色
    `#D32F2F`（白底对比 4.6:1）/ 暗色 `#EF5350`（暗底可读）；中性色沿用
    Streamlit 官方默认；`baseRadius = "0.5rem"`（**注意**：旧
    `borderRadius` 选项已移除更名 `baseRadius`，light/dark 分表均支持）。
    初始主题跟随系统偏好，用户 Settings 切换。系列色键（redColor 等）
    当前无图表消费不配置。
  - **`core/ui/theme.py`** 纯常量模块（无 Streamlit import，离线可测）：
    `PALETTE`（亮暗色板，与 config.toml 同值——`test/core/ui/
    test_theme.py` 用 tomllib 解析钉死一致性，防两份配置漂移）+
    `CSS`（注入样式，**不含** `<style>` 标签，display 用 `st.html` 包装）。
    色板注入用 `string.Template`（$占位）——**不要换回 %-formatting**：
    CSS 文本里 % 常见（width: 100%），裸 % 会被当转换符（实测踩坑）。
    主题感知选择器用 `@media (prefers-color-scheme: light/dark)` 媒体
    查询——1.61.1 前端把激活主题同步到 iframe 根元素 color-scheme，
    媒体查询精确匹配 Streamlit 主题而非 OS 偏好（改动前在浏览器实测，
    失效回退 `html[data-theme]`）。打磨范围：表格（表头品牌色下边框/
    斑马纹/圆角）、expander（悬停主色）、alert 圆角、紧凑页距、wide 布局。
  - **display.py 接线**：`st.set_page_config`（标题/📈/wide）必须是首个
    st 调用（Streamlit 要求，ast 测试钉死）；`st.html` 注入样式。渲染
    流程/事件循环/tab 契约零改动。
