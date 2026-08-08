# 研究：MACD-VH 与刘晨明乖离率（2026-08-08）

## MACD-VH（波动率归一化 MACD）

- **身份**：*Case's Modern MACD-Volatility Normalized Momentum*，作者 Alex Spiroglou（CFTe, MSTA），
  获奖学术研究（NAAIM Founders Award & Charles H. Dow Award 2022；SSRN #4099617）。
  实现见 TradingView（br.tradingview.com/scripts/macd-vh/）。用户已确认按此实现。
- **公式**（默认参数 fast=12, slow=26, ATR=26, signal=9）：
  ```
  MACD-V  = (EMA12 − EMA26) / ATR26 × 100   # 波动率归一化动量；×100 使阈值成立
  Signal  = EMA9(MACD-V)
  MACD-VH = MACD-V − Signal                   # 柱状图
  ```
- **信号语义**：
  - 柱值 ±40 = 短期过度延伸
  - 柱方向×增长四色：青色=正动量扩张（VH>0 且 VH>前值）、浅青=正动量衰减、浅红=负动量衰减、红=负动量扩张
  - 动量生命周期阈值：±50（震荡区界）、±150（超买/超卖风险）、±100（稀有信号）、±200（极端）
- **趋势制度过滤**：200 期 EMA 斜率（上升=多头/下降=空头/走平=中性）——**本任务不做**：
  图前数据仅 60 根日K，200-EMA 预热不足，列为 Out of Scope。

## 刘晨明乖离率（均线偏离度）

- **身份**：刘晨明，**广发证券**策略首席（搜索证实非天风），研报《如何区分主线是调整还是终结？》
  提出"均线偏离度"指标。阈值规律来自第三方文章转述，非研报原文（已标注来源）。
- **公式**（新版减法版，用户采用）：
  ```
  乖离率 = ln(收盘价) − ln(20日EMA)
  ```
  旧版（除法版）对低价标的（如 1 元以下 ETF）正负值颠倒敏感，已弃用。
- **阈值规律**（新版）：>15% 过热不追高；5%~15% 适中可入场；0~5% 接近均线趋势转弱；
  −5%~0% 刚跌穿建议坚守；<−5% 危险信号离场。关键阈值 **5%**。

## 实现要点

- vendor（tdx_quant 快照 b95d8e9）**零改动**（VENDOR.md 严禁静默分叉）。
- 复用 vendor 参数化函数：`calc_ema`（ewm span）、`calc_atr(df, n=26)`（Wilder 平滑）。
- 新模块 `core/llms/tools/extra_indicators.py`（本仓库代码）：
  - `calc_macd_vh(df, fast=12, slow=26, atr_len=26, signal=9)` → MACD_V / SIGNAL / MACD_VH 三列
  - `calc_liu_bias(df, n=20)` → ln(close) − ln(EMA20)
- 单 bar 快照需相邻 bar 比较（柱扩张/衰减方向取 iloc[-2] vs iloc[-1]），全序列在数据层算好再取末根。
- 阈值解读（5% / ±40 / ±50/±150/±200）放 prompt（分析师解读知识），工具只输出数据。

## 来源

- https://br.tradingview.com/scripts/macd-vh/ （TradingView 官方脚本页）
- https://ssrn.com/abstract=4099617 （Spiroglou 论文）
- https://baijiahao.baidu.com/s?for=pc&id=1843382441132646188 （刘晨明乖离率第三方文章）
- https://arkvol.com/gll （A股ETF乖离率分析工具站，含公式/阈值转述）
