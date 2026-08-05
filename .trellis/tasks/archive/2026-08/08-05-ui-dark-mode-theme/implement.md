# 执行计划:UI 主题优化(dark mode + 整体打磨)

## 实施前置(gates)

- [ ] 全局搜既有主题/CSS 常量(Pre-Modification Rule):`grep -rn "set_page_config\|prefers-color-scheme\|config.toml\|primaryColor" core/ .` —— 确认无重复实现。
- [ ] 确认无 `streamlit run main.py` 在跑(回归互斥)。

## 实施步骤(顺序执行)

0. **升级 Streamlit(用户拍板升最新,2026-08-05)**
   - 核对 1.61.1 wheel METADATA 依赖区间 vs requirements.txt 现有 pin(altair/pydeck/pandas/numpy/tornado/protobuf);冲突 → 最小化 bump 并记录。
   - `pip install streamlit==1.61.1`;requirements.txt `streamlit==1.54.0` → `streamlit==1.61.1`。
   - 验证:`python3 -c "import streamlit; print(streamlit.__version__)"` == 1.61.1。
   - 升级后先跑一遍 `python3 -m pytest test/core/ui/ -q`(升级本身不破坏现有 UI 测试)。
1. **`.streamlit/config.toml`**
   - 新建 `[theme]`(base/font)+ `[theme.light]` + `[theme.dark]` 两套独立色板(1.54.0 分主题表,1.51.0 引入)。
   - 色板取值与 `core/ui/theme.py` 的 `PALETTE` 同源(人工保持一致,测试钉死)。
2. **`core/ui/theme.py`**(新模块,纯常量)
   - `PALETTE: dict[str, str]`;`CSS: str`(无 `<style>` 标签)。
   - 选择器:表格(th/td/斑马纹)、expander(details)、alert、标题;暗色修正放 `@media (prefers-color-scheme: dark)` 块。
   - 模块 docstring 注明任务来源与契约(house style 注释密度)。
3. **`core/ui/display.py` 接线**(两行)
   - `st.set_page_config(page_title="超绝AI股票分析系统", page_icon="📈", layout="wide")`(首个 st 调用)。
   - `st.markdown(f"<style>{theme.CSS}</style>", unsafe_allow_html=True)`。
4. **`test/core/ui/test_theme.py`**
   - 类 `TestThemeCss`:CSS 含暗色媒体查询/关键选择器;无 `<style>` 标签残留。
   - 类 `TestThemePaletteConfigConsistency`:`tomllib` 读 `.streamlit/config.toml`,`[theme]` 键值与 `PALETTE` 逐项一致;PALETTE 值合法 hex。
5. **离线验证**:`python3 -m pytest test/core/ui/ -q`(全绿,秒级)。
6. **浏览器实测**(验收):`streamlit run main.py`
   - 初始主题跟随系统偏好;Settings 切亮/暗 → 全元素可读;rerun 后主题持久(1.54.0 含 #13306 修复;若仍重置 → 记问题,评估是否退回 1.50.0 方案)。
   - devtools 确认 `prefers-color-scheme` 跟随主题(不生效 → 补 `html[data-theme="dark"]`)。
   - 表格/expander/alert 样式两主题都正常;wide 布局生效。
7. **全量回归**:确认无 streamlit 进程后 `python3 -m pytest -q`(2-4 分钟;门槛 0 新增失败;若共享 DB 脏状态 → 连续两遍验证)。
8. **spec 更新**:`core/index.md` Streamlit UI 段增补:Streamlit 版本基线(1.54.0,环境与 requirements 对齐)、主题配置位置与语义(`[theme.light]`/`[theme.dark]` 分主题表、初始跟随系统、Settings 切换持久)、样式层模块契约(theme.py 纯常量、无 Streamlit import、PALETTE-config 一致性测试)。
9. **提交**:一次 commit,message 遵循 house style(如 `feat(ui): dark mode 主题与整体视觉打磨,streamlit 升 1.54.0`)。

## 验证命令清单

| 命令 | 期望 |
|---|---|
| `python3 -c "import streamlit; print(streamlit.__version__)"` | 1.61.1 |
| `grep -rn "set_page_config\|prefers-color-scheme\|primaryColor" core/` | 仅 theme.py/display.py/测试(实施后) |
| `python3 -m pytest test/core/ui/ -q` | 全绿(离线秒级) |
| `streamlit run main.py` | 浏览器验收(见步骤 6) |
| `python3 -m pytest -q` | 0 新增失败(先停 streamlit) |

## 回滚点

- 每步独立可回滚;最终回滚 = 删 `.streamlit/`、`core/ui/theme.py`、`test_theme.py`,display.py 还原两行。无数据/迁移风险。
- 提交前若浏览器实测发现主题适配选择器失效 → 停在第 6 步,补选择器后重测,不带着未验证的样式提交。
