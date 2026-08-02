"""离线 + live 测试：TDX 按需单股概览构建（22 列序契约 + 派生计算）。

离线用例直接调用 overview 模块的纯函数 compose_overview 与派生 helper，
用合成 DataFrame 验证 golden values，不访问网络；live 用例在 TDX 可达时
执行、不可达跳过（沿用 test_tdx_source.py 风格，不把网络不可达当失败）。
"""

from dataclasses import fields
from datetime import date

import numpy as np
import pandas as pd
import pytest

from data_source.chinese_mainland.tdx.overview import (
    OVERVIEW_COLUMNS,
    compose_overview,
    latest_period_value,
)
from data_source.chinese_mainland.tdx.tdx_source import TdxSource
from data_structure.chinese_mainland.StockOverview import StockOverview

GOLDEN_LAST_DATE = date(2026, 7, 31)


def _make_snapshot(price=11.63, open_=11.50, high=11.63, low=11.28):
    return pd.DataFrame([{
        "ts_code": "000001.SZ", "price": price, "open": open_,
        "high": high, "low": low, "source_channel": "hq", "trade_date": "20260801",
    }])


def _make_capital(zongguben=1.940592e10, liutongguben=1.94056e10):
    return pd.DataFrame([{
        "market": 0, "code": "000001", "zongguben": zongguben,
        "liutongguben": liutongguben, "industry": 1, "province": 18,
    }])


def _make_f10(eps=0.72, net_worth_per_share=11.5, period="2026-03-31"):
    return pd.DataFrame([
        {"metric": "基本每股收益(元)", "period": period, "value_raw": str(eps), "value_num": eps},
        {"metric": "每股净资产(元)", "period": period, "value_raw": str(net_worth_per_share), "value_num": net_worth_per_share},
    ])


def _make_daily(last_close=11.63, prev_close=11.61, c60_close=8.88, ytd_close=9.50):
    """构造 160 根日K，末根为 2026-07-31（周五）。

    - 末根收盘 = last_close（昨日收盘 prev_close 固定为倒数第二根）
    - "60 交易日前"（倒数第 61 根）收盘 = c60_close（默认其他 bar 均为 10.0，
      用于锁定 off-by-one）
    - 年初（末根年份 2026）首个交易日收盘 = ytd_close（其余 2025 年末 bar 为
      10.0，用于锁定"年内首根"而非窗口首根）
    """
    dates = pd.bdate_range(end="2026-07-31", periods=160)
    n = len(dates)
    closes = pd.Series(10.0, index=range(n))
    closes.iloc[-1] = last_close
    closes.iloc[-2] = prev_close
    closes.iloc[n - 61] = c60_close
    first_of_year = int(np.argmax(dates.year == dates[-1].year))
    closes.iloc[first_of_year] = ytd_close
    return pd.DataFrame({
        "datetime": dates,
        "open": closes, "close": closes,
        "high": closes + 0.2, "low": closes - 0.2,
        "vol": 2024978.0, "amount": 2.31884e9,
    })


def _full_inputs():
    return dict(
        snapshot_df=_make_snapshot(), capital_df=_make_capital(),
        f10_df=_make_f10(), daily_df=_make_daily(), today=GOLDEN_LAST_DATE,
    )


class TestComposeOverview:

    def test_columns_match_stock_overview_fields(self):
        """22 列序契约：列数 = StockOverview 字段数，位置构造零改动复用。"""
        assert len(OVERVIEW_COLUMNS) == len(fields(StockOverview))
        row = compose_overview("000001", "平安银行", **_full_inputs())
        assert list(row.index) == OVERVIEW_COLUMNS

    def test_positional_construction_aligns_with_stock_overview(self):
        # 忠实于消费者路径：build_overview 的 DataFrame → to_dict(orient='records')
        # → 位置构造 StockOverview(*list(row.values()))（与 akshare 路径同构，
        # 区别是 22 列不含序号列，无需 [1:] 切片）
        row = compose_overview("000001", "平安银行", **_full_inputs())
        df = pd.DataFrame([row])
        stock_row = df.to_dict(orient="records")[0]
        ov = StockOverview(*list(stock_row.values()))
        assert ov.ticker == "000001"
        assert ov.name == "平安银行"
        assert ov.latest_price == pytest.approx(11.63)
        assert ov.previous_close == pytest.approx(11.61)
        # 量比/涨速/5分钟涨跌：pytdx 无数据 → NaN，不报错
        assert np.isnan(ov.volume_ratio)
        assert np.isnan(ov.momentum)
        assert np.isnan(ov.change_percent_5min)

    def test_golden_values(self):
        row = compose_overview("000001", "平安银行", **_full_inputs())
        assert row["代码"] == "000001"
        assert row["名称"] == "平安银行"
        assert row["最新价"] == pytest.approx(11.63)
        assert row["昨收"] == pytest.approx(11.61)
        assert row["涨跌幅"] == pytest.approx((11.63 - 11.61) / 11.61 * 100)
        assert row["涨跌额"] == pytest.approx(0.02)
        assert row["振幅"] == pytest.approx((11.63 - 11.28) / 11.61 * 100)
        assert row["最高"] == pytest.approx(11.63)
        assert row["最低"] == pytest.approx(11.28)
        assert row["今开"] == pytest.approx(11.50)
        # 当日 bar 存在 → volume/成交额取日K当日值；换手率 = vol(手)*100/流通股本*100
        assert row["成交量"] == pytest.approx(2024978.0)
        assert row["成交额"] == pytest.approx(2.31884e9)
        assert row["换手率"] == pytest.approx(2024978.0 * 100 / 1.94056e10 * 100)
        # 估值派生：PE=price/eps、PB=price/每股净资产（F10 最新报告期）
        assert row["市盈率-动态"] == pytest.approx(11.63 / 0.72)
        assert row["市净率"] == pytest.approx(11.63 / 11.5)
        # 市值派生
        assert row["总市值"] == pytest.approx(11.63 * 1.940592e10)
        assert row["流通市值"] == pytest.approx(11.63 * 1.94056e10)
        # 60 交易日前收盘（倒数第 61 根 = 8.88）/ 年初首个交易日收盘（= 9.50）
        assert row["60日涨跌幅"] == pytest.approx((11.63 - 8.88) / 8.88 * 100)
        assert row["年初至今涨跌幅"] == pytest.approx((11.63 - 9.50) / 9.50 * 100)
        assert np.isnan(row["量比"])
        assert np.isnan(row["涨速"])
        assert np.isnan(row["5分钟涨跌"])

    def test_snapshot_missing_falls_back_to_daily_close(self):
        inputs = _full_inputs()
        inputs["snapshot_df"] = None
        row = compose_overview("000001", "平安银行", **inputs)
        assert row["最新价"] == pytest.approx(11.63)  # 日K 末根收盘
        assert np.isnan(row["最高"]) and np.isnan(row["最低"]) and np.isnan(row["今开"])
        assert np.isnan(row["振幅"])  # 无 snapshot high/low
        # 涨跌幅仍可由 prev_close 派生
        assert row["涨跌幅"] == pytest.approx((11.63 - 11.61) / 11.61 * 100)

    def test_daily_missing_only_snapshot(self):
        inputs = _full_inputs()
        inputs["daily_df"] = None
        row = compose_overview("000001", "平安银行", **inputs)
        assert row["最新价"] == pytest.approx(11.63)  # snapshot.price
        for col in ["昨收", "涨跌幅", "涨跌额", "成交量", "成交额", "换手率", "60日涨跌幅", "年初至今涨跌幅"]:
            assert np.isnan(row[col]), col
        # 估值/市值仍可由 snapshot price + 股本 + F10 派生
        assert row["市盈率-动态"] == pytest.approx(11.63 / 0.72)
        assert row["总市值"] == pytest.approx(11.63 * 1.940592e10)

    def test_intraday_volume_is_nan_when_last_bar_not_today(self):
        inputs = _full_inputs()
        inputs["today"] = date(2026, 8, 1)  # 周六：日K 末根为 7/31，非"当日"
        row = compose_overview("000001", "平安银行", **inputs)
        assert np.isnan(row["成交量"])
        assert np.isnan(row["成交额"])
        assert np.isnan(row["换手率"])
        # 价格类派生不受影响
        assert row["最新价"] == pytest.approx(11.63)
        assert row["涨跌幅"] == pytest.approx((11.63 - 11.61) / 11.61 * 100)

    def test_pe_pb_nan_when_denominator_nonpositive(self):
        inputs = _full_inputs()
        inputs["f10_df"] = _make_f10(eps=0.0, net_worth_per_share=-1.0)
        row = compose_overview("000001", "平安银行", **inputs)
        assert np.isnan(row["市盈率-动态"])
        assert np.isnan(row["市净率"])

    def test_all_sources_missing_yields_all_nan_row(self):
        row = compose_overview("000001", "000001", today=GOLDEN_LAST_DATE)
        assert row["代码"] == "000001"
        assert row["名称"] == "000001"
        assert np.isnan(row["最新价"])
        assert np.isnan(row["总市值"])
        assert np.isnan(row["涨跌幅"])

    def test_60day_and_ytd_nan_when_insufficient_bars(self):
        inputs = _full_inputs()
        inputs["daily_df"] = _make_daily().tail(60).reset_index(drop=True)  # 仅 60 根
        inputs["today"] = GOLDEN_LAST_DATE
        row = compose_overview("000001", "平安银行", **inputs)
        assert np.isnan(row["60日涨跌幅"])  # 不足 61 根
        assert row["涨跌幅"] == pytest.approx((11.63 - 11.61) / 11.61 * 100)  # prev_close 仍在


class TestLatestPeriodValue:

    def test_picks_max_period(self):
        f10 = pd.concat([
            _make_f10(eps=0.6, period="2025-12-31"),
            _make_f10(eps=0.72, period="2026-03-31"),
        ], ignore_index=True)
        assert latest_period_value(f10, "基本每股收益(元)") == pytest.approx(0.72)

    def test_missing_metric_returns_nan(self):
        assert np.isnan(latest_period_value(_make_f10(), "不存在的指标"))
        assert np.isnan(latest_period_value(None, "基本每股收益(元)"))


class TestLiveBuildOverview:
    """live：000001 概览字段合理性；TDX 不可达（build_overview 返回 None）→ 跳过。"""

    def test_live_build_overview_000001(self):
        df = TdxSource().build_overview("000001")
        if df is None:
            pytest.skip("TDX unreachable in this environment (no price source)")
        row = df.iloc[0]
        assert row["代码"] == "000001"
        assert row["名称"] == "平安银行"
        assert row["最新价"] > 0
        assert row["总市值"] > 0
        for col in ["市盈率-动态", "市净率"]:
            assert np.isnan(row[col]) or row[col] > 0
