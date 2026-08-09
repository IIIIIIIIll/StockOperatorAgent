"""Playwright UI 测试的 streamlit mock 入口（仅 test/e2e/ 内使用）。

**生产代码零改动**：mock 入口 import core.ui.display 后替换两个模块全局
（build_stock_information / committee）再调 write_ui()——write_ui 按
模块全局名查找（display.py:15/136-138），真实 `InvestmentCommittee()`
顶层构造（display.py:31）虽然会发生，但从不被调用。

运行（conftest session fixture 自动执行；手动冒烟）：
    LLM_API_KEY=dummy LLM_MODEL=deepseek-v4-flash \
    LLM_BASE_URL=https://api.deepseek.com streamlit run test/e2e/mock_app.py \
        --server.headless=true --server.port=8502 --server.address=127.0.0.1

**env 要求**：服务器 env 必须注入 dummy LLM 三键（LLM_API_KEY /
LLM_MODEL / LLM_BASE_URL）——display 模块顶层
`committee = InvestmentCommittee()` 本身无副作用（无 __init__，
make_llm() 只在真实 make_investment_committee 内构造，mock 已替换），
dummy 三键的真实用途是绕过 `_llm_configured()` 门禁（display.py，
缺任一键时 write_ui 直接 st.error 返回，表单/报告都不会渲染）。

mock 替换契约（design.md 已验证）：
- `build_stock_information(ticker, progress=...)` → 读
  seed/fixture_002027.txt 原样返回（progress 回调调用但不输出——无真实
  抓取进度可报，display 仅把它作为消息源）
- `committee` → MockCommittee()（make_investment_committee 返回
  FakeGraph，stream 迭代吐固定 5 报告 key，零 LLM 构造）
"""

from __future__ import annotations

import sys
from pathlib import Path

# streamlit run 以脚本方式加载 mock_app.py——脚本目录（test/e2e/）会被
# 放入 sys.path，但仓库根不会（`import core.ui.display` 需要）——显式
# 补上仓库根 + test/e2e/ 自身（`import mock_committee` 可解析，不依赖
# pytest 收集），保证 mock 入口与生产同一 import 路径。
_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import core.ui.display as display  # noqa: E402
from mock_committee import MockCommittee  # noqa: E402

from loguru import logger  # noqa: E402

# 种子快照（一次性导出产物，见 scripts/export_seed_002027.py）：
# build_stock_information("002027") 的真实输出文本原样保存
_SEED_FILE = Path(__file__).resolve().parent / "seed" / "fixture_002027.txt"
_seed_text = _SEED_FILE.read_text(encoding="utf-8")


def mock_build_stock_information(ticker: str, progress=None):
    """mock 版 enrichment：fixture 原样返回，零 LLM、零网络抓取。

    接受与真实实现相同的 (ticker, progress=None) 签名——display 的调用点
    （display.py:136-138）零改动。progress 回调照常触发（display 用它往
    status 容器刷消息），但只输出 mock 提示文案。
    """
    if progress is not None:
        progress(f"正在获取 {ticker} 的股票信息（mock 种子快照）...")
    return _seed_text


display.build_stock_information = mock_build_stock_information
display.committee = MockCommittee()

# 与生产同一条 UI 代码路径：write_ui() 内部才创建 tab/表单/事件循环
display.write_ui()

# mock 自检（design：FakeGraph 计数器断言）——CALL_COUNT 是本进程内
# MockCommittee.make_investment_committee 被调次数（真实 InvestmentCommittee
# / make_llm 从不被调用）。loguru 默认 stderr → 服务器日志文件
# （conftest 收集），pytest_sessionfinish 审计「零真实 LLM/网络调用」。
# 每次 rerun（页面加载/提交）都会执行到这一行：无提交 → 0，有效提交
# → 递增。
from mock_committee import CALL_COUNT  # noqa: E402

logger.info("E2E_MOCK_CALL_COUNT={}", CALL_COUNT)
