"""导出 002027 种子快照（一次性，需网络/存储；产物入库后不再运行）。

把 `build_stock_information("002027")` 的输出文本**原样**写入
`test/e2e/seed/fixture_002027.txt` —— Playwright UI 测试套件
（test/e2e/，mock 模式）以该文件为种子：mock_app 替换
`display.build_stock_information` 原样返回文件内容，测试运行时
零 LLM 调用、零网络抓取。

背景（08-07-playwright-ui-test-framework）：UI 改动验收从「完整流程
（TDX 抓取 + 5 代理 DeepSeek 调用 + 分钟级）」降到「秒到分钟级、
零 token」。本脚本是唯一允许真实运行的环节——fixture 固化后测试
不再抓取（`git status` 里 fixture 是静态文件）。

用法：
    python3 scripts/export_seed_002027.py

**再导出注意事项**：fixture 是静态快照，测试运行时只读它——但若本机
配了 `TDX_API_KEY`，`get_market_intel` 会返回实时情报文本（非降级占位），
导出的 fixture 内容将不可复现。需要重新导出时请先清掉 `TDX_API_KEY`
（`env -u TDX_API_KEY python3 scripts/export_seed_002027.py`），保证
快照确定性（含「（未配置 TDX_API_KEY，跳过实时市场情报）」段）。
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from loguru import logger  # noqa: E402


def main() -> int:
    # build_stock_information 在函数内 import 工具（无 key 环境零副作用）；
    # get_market_intel 无 TDX_API_KEY 时输出降级占位文本——快照同样含该
    # 段，测试渲染路径与真实降级一致。
    from core.investment_committee import build_stock_information

    ticker = "002027"
    logger.info("Generating seed snapshot for {} ...", ticker)
    text = build_stock_information(ticker, progress=lambda msg: logger.info(msg))
    logger.info("Snapshot length: {} chars", len(text))

    out = Path(__file__).resolve().parents[1] / "test" / "e2e" / "seed" / "fixture_002027.txt"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8")
    logger.info("Written to {}", out)

    # 自检：文件可读回且内容逐字节一致
    assert out.read_text(encoding="utf-8") == text, "write-back mismatch"
    print(f"OK: {out} ({len(text)} chars)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
