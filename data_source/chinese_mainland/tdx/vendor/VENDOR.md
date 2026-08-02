# VENDOR 说明：tdx_quant

- **上游**: https://github.com/henrylin99/tdx_quant
- **Commit**: `b95d8e915aa2fa4b703e64c38ca48eb51a6fa96e`（main, 2026-08-02 快照）
- **引入方式**: vendor 快照（上游无打包文件，pip 不可装；保持本仓库 clone-and-run 自包含）
- **范围**: `scripts/data_pipeline/` + `scripts/tdx_mcp/` 全子树（55 个 .py 文件）
  - 不含 `frontend/`、`tests/`、根级 README / PLAN_INTERFACES.md / pytest.ini
- **导入机制**: 本目录为 vendor 根，`tdx_source.py` 模块级一次性
  `sys.path.insert(0, vendor_root)`；上游绝对导入 `scripts.data_pipeline.*` /
  `scripts.tdx_mcp.*` 原样可用，**未改动任何上游代码**。
- **依赖**: `pytdx==1.72`（requirements.txt 新增，唯一新依赖）；pandas/pyarrow/
  numpy/httpx/tqdm/tabulate 均已存在于 requirements.txt
- **更新流程**: 重新拷贝上游 `scripts/` 两子树覆盖本目录 → 更新本文件 commit →
  运行 `python3 -m pytest -q test/data_source/test_tdx_source.py` 冒烟 → 人工审阅
  git diff 中上游代码变化（严禁本文件内出现与上游的静默分叉）

## 与上游差异

（无——拷贝时零改动）
