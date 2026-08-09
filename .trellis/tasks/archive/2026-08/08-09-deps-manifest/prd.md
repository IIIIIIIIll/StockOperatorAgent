# 依赖清单修复（requirements.txt）

## Goal

修复 requirements.txt 与实际环境的漂移（用户拍板：**降 pin 到已验证环境**），并补上漏 pin 的 `python-dotenv`。目标：fresh `pip install -r requirements.txt` 得到的组合 == 本环境已验证（全部测试通过过）的组合。

## Requirements

- **补 `python-dotenv`**：`main.py:1` 与 `core/investment_committee.py:1` 直接 `from dotenv import load_dotenv`，当前完全缺失（只靠传递依赖存在）——正是 agents spec 警告过的漏 pin 直接导入类事故。
- **显著漂移降 pin**（安装版以 `pip show` 实查为准；git 历史核实：ZODB 6.2 / altair 6.0.0 为**模板遗留 pin**——`ffc94c6`（2026-02-20 建仓）带入，历次真实升级（akshare dee863f / langchain 族 b4e4d57 / streamlit 537ce25）均未触碰这两行，环境也从未安装过它们——降 pin 是消除零验证孤儿 pin，不是回退升级）：
  - `ZODB`：pin 6.2 → 安装版 6.0.1（spec `data_storage/index.md` 全部"6.0.1 实测"注记；`ZODBStorage.py:90` 注释声称 6.2 一并修正）
  - `altair`：pin 6.0.0 → 安装版 5.5.0（`core/ui/charts.py` 只在 5.5.0 验证过，6.0 是 major bump 未跑过；且环境里 altair 是 streamlit 的依赖带进来的 5.5.0）
  - 其余领先 pin（pandas/persistent/BTrees/zc.lockfile 等）：逐项 `pip show` 核对后对齐到安装版。
- **对齐策略约束**：不做全量 `pip freeze` 重写（会引入环境垃圾包，如 conda 的 bokeh/hvplot/seaborn 等不在项目里）；只把 requirements.txt **已有条目**的 pin 对齐到安装版，新增仅 `python-dotenv`；已一致项（streamlit 1.61.1、langchain 族、langgraph、openai、akshare、ddgs、pytdx 等）**不动**。
- **spec 同步**：`agents/index.md` 依赖版本注记段与 `data_source/index.md` 的版本注记改为实际对齐值。

## Acceptance Criteria

- [ ] `grep -n "python-dotenv" requirements.txt` 命中且版本 == `pip show python-dotenv` 安装版。
- [ ] 直接导入的非 stdlib 包 100% 在 requirements.txt 中（核对方式：扫描 `^(from|import)` 提包名 → 过滤 stdlib → 对比 requirements；`python-dotenv` 与其余全部命中）。
- [ ] 对齐后每个改动 pin 的版本 == 安装版（`pip show` 逐项抽查 ZODB/altair/pandas/persistent）。
- [ ] 冒烟验证（可选执行，环境允许时）：fresh venv `pip install -r requirements.txt` 成功；`python -c "import main"` 或 `streamlit run main.py` 启动到 UI 门禁（`_has_deepseek_key` 提示）不崩。
- [ ] spec 版本注记与实际一致（无 6.2 / 6.0.0 残留）。

## Notes

- 本任务只动 requirements.txt + spec 注记 + `ZODBStorage.py:90` 注释，**不改代码行为、不升环境**——环境保持现状，故不要求全量重跑回归（依赖组合未变）。
- 依赖升级（真正升级到 pin 的版本）是另一个任务，不在本轮。
