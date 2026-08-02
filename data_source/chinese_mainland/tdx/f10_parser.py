"""F10「主要财务指标」raw 文本 → tidy long（非 vendor 解析器，含季度）。

**背景（08-02-fix-f10-quarterly-data）**：TDX F10 财务分析页面有两张
并列子表——表 1 只列"最新期 + 历年年报"（如 2026-03-31 + 2021-2025
年报），表 2 含季度（如 2026-03-31 + 2025-12-31 + 2025-09-30/06-30/
03-31 + 2024-12-31），数值同口径（累计值），是表 1 的超集。vendor
解析器（scripts/data_pipeline/extractors/tdx_company_info.py）遇到
第二个日期头行即 break，整张季度表被丢弃。VENDOR.md 明令 vendor
零改动——本模块在非 vendor 层重实现：**所有日期头子表全部并入**，
输出 schema 与 vendor 一致（compose_reports 零改动复用）。

格式认知（2026-08-02 实测，000001/600519/601888/002027 四股一致）：
- 单元格分隔符 U+FF5C 全角竖线；日期头行 ≥2 个 'YYYY-MM-DD' cell。
- 行值含 '亿'/'万' 后缀（×1e8/×1e4）；'-'/'--'/'—'/'null'/空 → NaN。
- 表 2 后可能出现下一分节（如【盈利能力指标】）——块在首个
  '\n【' 截断（与 vendor 同款），表 3/4 天然排除（非本任务范围）。
"""

from __future__ import annotations

import re

import pandas as pd

PIPE = '｜'
_DATE_CELL_RE = re.compile(r'\d{4}-\d{2}-\d{2}')

# 输出列序 = vendor FINANCE_INDICATOR_COLUMNS 去掉 ts_code（compose_reports
# 只消费 metric/period/value_num 三列，ts_code 由调用方/上游持有）。
F10_COLUMNS = ['metric', 'period', 'value_raw', 'value_num']


def _to_num(s: str) -> float:
    """文本值 → float：'亿'/'万' 归一；空/'-'/'--'/'—'/'null'/不可解析 → NaN。"""
    s = (s or '').strip()
    if s in ('', '-', '--', '—', 'null', 'NULL'):
        return float('nan')
    mult = 1.0
    if s.endswith('亿'):
        mult, s = 1e8, s[:-1]
    elif s.endswith('万'):
        mult, s = 1e4, s[:-1]
    try:
        return float(s) * mult
    except ValueError:
        return float('nan')


def _split_pipe_cells(line: str) -> list[str]:
    """'｜a｜b｜c｜' 行 → 去包裹竖线后的 cell 列表（首尾各一空 cell 丢弃）。"""
    parts = [c.strip() for c in line.split(PIPE)]
    if parts and parts[0] == '':
        parts.pop(0)
    if parts and parts[-1] == '':
        parts.pop()
    return parts


def parse_finance_indicators_all_tables(text: str) -> pd.DataFrame:
    """F10 财务分析 raw 文本 → 每 (metric, period) 一行，**全部日期头子表并入**。

    与 vendor 解析器的差异（本模块存在的意义）：vendor 遇第二个日期头行
    break（丢弃含季度的表 2）；本函数**更新 periods 并继续**——表 1 + 表 2
    的 (metric, period, value) 三元组全部收集。同 (metric, period) 出现在
    多张表（两表同值）→ 后写覆盖去重。

    无【主要财务指标】节 / 无可解析行 → 空 DataFrame（与 vendor 同约定）。
    """
    records: list[dict] = []
    start = (text or '').find('【主要财务指标】')
    if start < 0:
        return pd.DataFrame(columns=F10_COLUMNS)
    rest = text[start:]
    # 块在下一个分节标记（'\n【'）截断——表 3/4（【盈利能力指标】等）排除
    nxt = rest.find('\n【', 1)
    block = rest if nxt < 0 else rest[:nxt]

    periods: list[str] | None = None
    for line in block.splitlines():
        if PIPE not in line:
            continue
        cells = _split_pipe_cells(line)
        if not cells:
            continue
        # 日期头行（≥2 个日期 cell）：首个设 periods，后续子表**切换 periods**
        # 并继续（vendor 在此 break——即季度表被丢的根因）
        date_cells = [c for c in cells if _DATE_CELL_RE.search(c)]
        if len(date_cells) >= 2:
            periods = date_cells
            continue
        if periods is None or len(cells) < 2:
            continue
        metric = cells[0]
        for period, raw in zip(periods, cells[1:1 + len(periods)]):
            records.append({
                'metric': metric,
                'period': period,
                'value_raw': raw,
                'value_num': _to_num(raw),
            })

    if not records:
        return pd.DataFrame(columns=F10_COLUMNS)
    df = pd.DataFrame(records, columns=F10_COLUMNS)
    # 同 (metric, period) 跨表去重：保留最后出现（表 2 后写；两表同值）
    return df.drop_duplicates(subset=["metric", "period"], keep="last")
