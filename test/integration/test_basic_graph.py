from typing import Annotated

from dotenv import load_dotenv
from langchain_core.runnables import RunnableConfig
from langgraph.prebuilt import ToolNode
from typing_extensions import TypedDict

from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages

from agents.chinese_mainland.bearish_trader import BearishTrader
from agents.chinese_mainland.investment_manager import InvestmentManager
from utils.state import State
from core.llms.qwen.qwen_api import QwenApi
from core.llms.tools.get_company_info import get_stock_info
from agents.chinese_mainland.fundamental_analysis_expert import FundamentalAnalysisExpert
from agents.chinese_mainland.trend_analysis_expert import  TrendAnalysisExpert
from agents.chinese_mainland.bullish_trader import BullishTrader
from langgraph.checkpoint.memory import InMemorySaver
from loguru import logger

from IPython.display import Image, display

dummy_data = f"""
-----------
Stock: 牧原股份 (002714)
Latest price: 54.38
Dynamic PE: 14.11
Pb: 3.84
Momentum: 1.0%
Last 60 days prices:
  Date: 2025-07-03, Open:42.81, Close: 43.38, High: 43.58, Low: 42.4, Change Percent: 1.9%, Volume: 410012lots, Turnover Rate: 1.08%
  Date: 2025-07-04, Open:43.18, Close: 43.73, High: 43.85, Low: 42.97, Change Percent: 0.81%, Volume: 331842lots, Turnover Rate: 0.87%
  Date: 2025-07-07, Open:43.6, Close: 43.44, High: 43.85, Low: 43.26, Change Percent: -0.66%, Volume: 202080lots, Turnover Rate: 0.53%
  Date: 2025-07-08, Open:43.45, Close: 43.67, High: 43.84, Low: 42.99, Change Percent: 0.53%, Volume: 319986lots, Turnover Rate: 0.84%
  Date: 2025-07-09, Open:43.65, Close: 45.1, High: 45.6, Low: 43.63, Change Percent: 3.27%, Volume: 687988lots, Turnover Rate: 1.81%
  Date: 2025-07-10, Open:46.0, Close: 45.31, High: 46.02, Low: 44.7, Change Percent: 0.47%, Volume: 604000lots, Turnover Rate: 1.59%
  Date: 2025-07-11, Open:45.86, Close: 45.69, High: 46.86, Low: 45.48, Change Percent: 0.84%, Volume: 496021lots, Turnover Rate: 1.3%
  Date: 2025-07-14, Open:45.7, Close: 45.51, High: 45.95, Low: 45.25, Change Percent: -0.39%, Volume: 340337lots, Turnover Rate: 0.89%
  Date: 2025-07-15, Open:45.63, Close: 44.89, High: 45.76, Low: 44.7, Change Percent: -1.36%, Volume: 378131lots, Turnover Rate: 0.99%
  Date: 2025-07-16, Open:44.78, Close: 45.14, High: 45.18, Low: 44.48, Change Percent: 0.56%, Volume: 274436lots, Turnover Rate: 0.72%
  Date: 2025-07-17, Open:45.14, Close: 45.28, High: 46.22, Low: 45.14, Change Percent: 0.31%, Volume: 241657lots, Turnover Rate: 0.63%
  Date: 2025-07-18, Open:45.33, Close: 46.04, High: 46.51, Low: 45.23, Change Percent: 1.68%, Volume: 335233lots, Turnover Rate: 0.88%
  Date: 2025-07-21, Open:46.17, Close: 47.33, High: 47.5, Low: 46.13, Change Percent: 2.8%, Volume: 526338lots, Turnover Rate: 1.38%
  Date: 2025-07-22, Open:47.28, Close: 48.42, High: 48.49, Low: 47.02, Change Percent: 2.3%, Volume: 499762lots, Turnover Rate: 1.31%
  Date: 2025-07-23, Open:49.58, Close: 49.09, High: 50.08, Low: 48.71, Change Percent: 1.38%, Volume: 808088lots, Turnover Rate: 2.12%
  Date: 2025-07-24, Open:48.5, Close: 48.27, High: 48.57, Low: 47.92, Change Percent: -1.67%, Volume: 449092lots, Turnover Rate: 1.18%
  Date: 2025-07-25, Open:48.33, Close: 48.58, High: 49.2, Low: 48.29, Change Percent: 0.64%, Volume: 403598lots, Turnover Rate: 1.06%
  Date: 2025-07-28, Open:48.4, Close: 48.34, High: 49.0, Low: 48.05, Change Percent: -0.49%, Volume: 352143lots, Turnover Rate: 0.92%
  Date: 2025-07-29, Open:48.1, Close: 47.28, High: 48.32, Low: 47.1, Change Percent: -2.19%, Volume: 436220lots, Turnover Rate: 1.14%
  Date: 2025-07-30, Open:47.28, Close: 47.27, High: 48.3, Low: 46.89, Change Percent: -0.02%, Volume: 417541lots, Turnover Rate: 1.1%
  Date: 2025-07-31, Open:46.78, Close: 46.36, High: 46.99, Low: 46.1, Change Percent: -1.93%, Volume: 395410lots, Turnover Rate: 1.04%
  Date: 2025-08-01, Open:46.41, Close: 45.81, High: 46.59, Low: 45.7, Change Percent: -1.19%, Volume: 298470lots, Turnover Rate: 0.78%
  Date: 2025-08-04, Open:45.8, Close: 45.91, High: 46.17, Low: 45.64, Change Percent: 0.22%, Volume: 226824lots, Turnover Rate: 0.6%
  Date: 2025-08-05, Open:46.19, Close: 46.26, High: 46.45, Low: 45.88, Change Percent: 0.76%, Volume: 265787lots, Turnover Rate: 0.7%
  Date: 2025-08-06, Open:46.24, Close: 46.77, High: 47.1, Low: 46.1, Change Percent: 1.1%, Volume: 311995lots, Turnover Rate: 0.82%
  Date: 2025-08-07, Open:46.78, Close: 46.67, High: 47.37, Low: 46.33, Change Percent: -0.21%, Volume: 213225lots, Turnover Rate: 0.56%
  Date: 2025-08-08, Open:46.89, Close: 46.95, High: 47.39, Low: 46.6, Change Percent: 0.6%, Volume: 258517lots, Turnover Rate: 0.68%
  Date: 2025-08-11, Open:47.22, Close: 46.75, High: 47.22, Low: 46.3, Change Percent: -0.43%, Volume: 265524lots, Turnover Rate: 0.7%
  Date: 2025-08-12, Open:46.75, Close: 47.02, High: 47.25, Low: 46.7, Change Percent: 0.58%, Volume: 234410lots, Turnover Rate: 0.62%
  Date: 2025-08-13, Open:47.07, Close: 46.89, High: 47.38, Low: 46.2, Change Percent: -0.28%, Volume: 323760lots, Turnover Rate: 0.85%
  Date: 2025-08-14, Open:46.71, Close: 46.47, High: 47.26, Low: 46.42, Change Percent: -0.9%, Volume: 264906lots, Turnover Rate: 0.7%
  Date: 2025-08-15, Open:46.27, Close: 46.07, High: 46.53, Low: 45.76, Change Percent: -0.86%, Volume: 399077lots, Turnover Rate: 1.05%
  Date: 2025-08-18, Open:46.07, Close: 46.33, High: 46.33, Low: 45.71, Change Percent: 0.56%, Volume: 386580lots, Turnover Rate: 1.01%
  Date: 2025-08-19, Open:46.38, Close: 46.71, High: 47.38, Low: 46.36, Change Percent: 0.82%, Volume: 383484lots, Turnover Rate: 1.01%
  Date: 2025-08-20, Open:46.9, Close: 47.5, High: 47.66, Low: 46.24, Change Percent: 1.69%, Volume: 409712lots, Turnover Rate: 1.08%
  Date: 2025-08-21, Open:49.63, Close: 50.21, High: 51.76, Low: 48.36, Change Percent: 5.71%, Volume: 1151209lots, Turnover Rate: 3.02%
  Date: 2025-08-22, Open:50.48, Close: 50.35, High: 50.74, Low: 49.58, Change Percent: 0.28%, Volume: 569572lots, Turnover Rate: 1.49%
  Date: 2025-08-25, Open:50.37, Close: 51.38, High: 51.45, Low: 50.1, Change Percent: 2.05%, Volume: 602646lots, Turnover Rate: 1.58%
  Date: 2025-08-26, Open:51.29, Close: 55.06, High: 56.23, Low: 50.91, Change Percent: 7.16%, Volume: 1143279lots, Turnover Rate: 3.0%
  Date: 2025-08-27, Open:54.7, Close: 54.5, High: 55.99, Low: 54.42, Change Percent: -1.02%, Volume: 657697lots, Turnover Rate: 1.73%
  Date: 2025-08-28, Open:54.3, Close: 54.5, High: 54.8, Low: 53.5, Change Percent: 0.0%, Volume: 570731lots, Turnover Rate: 1.5%
  Date: 2025-08-29, Open:54.5, Close: 54.96, High: 55.5, Low: 54.3, Change Percent: 0.84%, Volume: 408050lots, Turnover Rate: 1.07%
  Date: 2025-09-01, Open:55.23, Close: 54.8, High: 55.48, Low: 53.98, Change Percent: -0.29%, Volume: 405047lots, Turnover Rate: 1.06%
  Date: 2025-09-02, Open:54.55, Close: 54.75, High: 56.45, Low: 54.5, Change Percent: -0.09%, Volume: 565159lots, Turnover Rate: 1.48%
  Date: 2025-09-03, Open:54.75, Close: 53.84, High: 55.85, Low: 53.6, Change Percent: -1.66%, Volume: 358671lots, Turnover Rate: 0.94%
  Date: 2025-09-04, Open:53.85, Close: 52.83, High: 54.14, Low: 52.05, Change Percent: -1.88%, Volume: 482179lots, Turnover Rate: 1.27%
  Date: 2025-09-05, Open:52.89, Close: 53.7, High: 53.7, Low: 52.02, Change Percent: 1.65%, Volume: 323013lots, Turnover Rate: 0.85%
  Date: 2025-09-08, Open:54.5, Close: 55.65, High: 56.3, Low: 54.5, Change Percent: 3.63%, Volume: 573410lots, Turnover Rate: 1.5%
  Date: 2025-09-09, Open:55.64, Close: 54.58, High: 55.87, Low: 54.13, Change Percent: -1.92%, Volume: 450244lots, Turnover Rate: 1.18%
  Date: 2025-09-10, Open:54.2, Close: 54.4, High: 54.96, Low: 53.12, Change Percent: -0.33%, Volume: 342542lots, Turnover Rate: 0.9%
  Date: 2025-09-11, Open:54.95, Close: 57.45, High: 58.49, Low: 54.93, Change Percent: 5.61%, Volume: 932018lots, Turnover Rate: 2.45%
  Date: 2025-09-12, Open:57.4, Close: 57.54, High: 58.46, Low: 57.1, Change Percent: 0.16%, Volume: 562952lots, Turnover Rate: 1.48%
  Date: 2025-09-15, Open:57.5, Close: 58.77, High: 59.68, Low: 57.13, Change Percent: 2.14%, Volume: 698123lots, Turnover Rate: 1.83%
  Date: 2025-09-16, Open:58.8, Close: 57.35, High: 58.86, Low: 56.32, Change Percent: -2.42%, Volume: 630677lots, Turnover Rate: 1.66%
  Date: 2025-09-17, Open:57.36, Close: 56.19, High: 57.58, Low: 55.61, Change Percent: -2.02%, Volume: 547029lots, Turnover Rate: 1.44%
  Date: 2025-09-18, Open:56.2, Close: 54.75, High: 56.5, Low: 54.25, Change Percent: -2.56%, Volume: 500844lots, Turnover Rate: 1.31%
  Date: 2025-09-19, Open:54.3, Close: 54.38, High: 54.95, Low: 53.73, Change Percent: -0.68%, Volume: 440787lots, Turnover Rate: 1.16%
  Date: 2025-09-18, Open:56.2, Close: 54.75, High: 56.5, Low: 54.25, Change Percent: -2.56%, Volume: 500844lots, Turnover Rate: 1.31%
  Date: 2025-09-19, Open:54.3, Close: 54.38, High: 54.95, Low: 53.73, Change Percent: -0.68%, Volume: 440787lots, Turnover Rate: 1.16%
  Date: 2025-09-22, Open:53.84, Close: 53.56, High: 53.84, Low: 52.55, Change Percent: -1.51%, Volume: 418086lots, Turnover Rate: 1.1%
Last 20 financial abstracts:
  Report Date: 20200930, EPS: 4.07, Net Profit: 20987828337.83, Net Profit YoY percent 1413.28, Net Profit QoQ percent 53.3796, Net worth per share 11.040346500385, Return on Equity percent 63.47, Cash flow per share 5.096755510448, Sales gross margin percent 64.6667440798
  Report Date: 20201231, EPS: 5.33, Net Profit: 27451421940.73, Net Profit YoY percent 348.97, Net Profit QoQ percent -36.655, Net worth per share 12.754183733992, Return on Equity percent 74.43, Cash flow per share 6.167521703132, Sales gross margin percent 60.6794746805
  Report Date: 20210331, EPS: 1.35, Net Profit: 6963072000.64, Net Profit YoY percent 68.54, Net Profit QoQ percent 7.7276, Net worth per share 14.921923433537, Return on Equity percent 12.72, Cash flow per share 1.265073263476, Sales gross margin percent 45.8801099887
  Report Date: 20210630, EPS: 1.82, Net Profit: 9525980558.07, Net Profit YoY percent -11.67, Net Profit QoQ percent -63.1928, Net worth per share 10.141797645594, Return on Equity percent 17.23, Cash flow per share 2.507669019635, Sales gross margin percent 32.8289672002
  Report Date: 20210930, EPS: 1.66, Net Profit: 8704266223.85, Net Profit YoY percent -58.53, Net Profit QoQ percent -132.0618, Net worth per share 10.018067574851, Return on Equity percent 16.24, Cash flow per share 2.525941342481, Sales gross margin percent 24.121675307
  Report Date: 20211231, EPS: 1.28, Net Profit: 6903777691.92, Net Profit YoY percent -74.85, Net Profit QoQ percent -119.1137, Net worth per share 9.667564912031, Return on Equity percent 12.91, Cash flow per share 3.096525355075, Sales gross margin percent 16.7448308474
  Report Date: 20220331, EPS: -0.99, Net Profit: -5180230377.25, Net Profit YoY percent -174.4, Net Profit QoQ percent -187.7125, Net worth per share 8.835534165646, Return on Equity percent -9.85, Cash flow per share -0.010938021264, Sales gross margin percent -23.0337891362
  Report Date: 20220630, EPS: -1.28, Net Profit: -6683595896.21, Net Profit YoY percent -170.16, Net Profit QoQ percent 70.9788, Net worth per share 8.36439959838, Return on Equity percent -12.81, Cash flow per share 0.035778820895, Sales gross margin percent -9.4857678442
  Report Date: 20220930, EPS: 0.29, Net Profit: 1512298977.39, Net Profit YoY percent -82.63, Net Profit QoQ percent 645.1698, Net worth per share 9.960460196946, Return on Equity percent 2.7, Cash flow per share 1.852521150103, Sales gross margin percent 8.4597142834
  Report Date: 20221231, EPS: 2.49, Net Profit: 13266156512.39, Net Profit YoY percent 92.16, Net Profit QoQ percent 43.4115, Net worth per share 12.931733043407, Return on Equity percent 21.01, Cash flow per share 4.204926380425, Sales gross margin percent 17.4956464077
  Report Date: 20230331, EPS: -0.22, Net Profit: -1198054174.39, Net Profit YoY percent 76.87, Net Profit QoQ percent -110.1929, Net worth per share 12.66770843387, Return on Equity percent -1.67, Cash flow per share -0.70456115194, Sales gross margin percent 1.8829680174
  Report Date: 20230630, EPS: -0.52, Net Profit: -2779217657.24, Net Profit YoY percent 58.4173295274, Net Profit QoQ percent -31.9776, Net worth per share 11.553945190106, Return on Equity percent -3.89, Cash flow per share -0.191029323074, Sales gross margin percent 1.4191398455
  Report Date: 20230930, EPS: -0.34, Net Profit: -1842329322.27, Net Profit YoY percent -221.82, Net Profit QoQ percent 159.2531, Net worth per share 11.747218719136, Return on Equity percent -2.68, Cash flow per share 1.223714169517, Sales gross margin percent 4.6264352079
  Report Date: 20231231, EPS: -0.79, Net Profit: -4263280820.31, Net Profit YoY percent -132.14, Net Profit QoQ percent -358.4034, Net worth per share 11.309586099854, Return on Equity percent -6.38, Cash flow per share 1.810097398608, Sales gross margin percent 3.1083520676
  Report Date: 20240331, EPS: -0.44, Net Profit: -2378911751.33, Net Profit YoY percent -98.56, Net Profit QoQ percent 1.7365, Net worth per share 11.007533204248, Return on Equity percent -3.86, Cash flow per share 0.927073044907, Sales gross margin percent -2.5004982841
  Report Date: 20240630, EPS: 0.15, Net Profit: 829288208.44, Net Profit YoY percent 129.84, Net Profit QoQ percent 234.86, Net worth per share 11.539238002695, Return on Equity percent 1.3, Cash flow per share 2.831259303645, Sales gross margin percent 7.7415066802
  Report Date: 20240930, EPS: 1.94, Net Profit: 10481068452.78, Net Profit YoY percent 668.9, Net Profit QoQ percent 200.8472, Net worth per share 13.034392662324, Return on Equity percent 15.36, Cash flow per share 5.338698724911, Sales gross margin percent 17.266585911
  Report Date: 20241231, EPS: 3.3, Net Profit: 17881260485.27, Net Profit YoY percent 519.42, Net Profit QoQ percent -23.3282, Net worth per share 12.999750499816, Return on Equity percent 25.1, Cash flow per share 6.872535655372, Sales gross margin percent 19.0510748045
  Report Date: 20250331, EPS: 0.83, Net Profit: 4491095122.49, Net Profit YoY percent 288.79, Net Profit QoQ percent -39.3111, Net worth per share 13.789548395304, Return on Equity percent 6.06, Cash flow per share 1.374031515489, Sales gross margin percent 18.1718801147
  Report Date: 20250630, EPS: 1.96, Net Profit: 10530051098.42, Net Profit YoY percent 1169.77, Net Profit QoQ percent 34.4651, Net worth per share 14.173230571319, Return on Equity percent 13.79, Cash flow per share 3.176193599047, Sales gross margin percent 19.0183089106
-----------
"""

dummy_fundamental_analysis = f"""请帮我分析一下 牧原股份 $002714
Assistant: 牧原股份（002714）基本面深度分析报告  
截至2025年9月22日，股价：54.38元  

---

### **一、公司基本面概览与行业周期定位**

牧原股份是中国最大、全球领先的生猪养殖企业，业务高度集中于生猪养殖、屠宰及销售，属于**农业周期性行业**，其盈利与**猪价周期**强相关。  

**当前行业周期阶段（2025年Q3）：**  
- 2023年Q4至2024年Q4为行业深度亏损期（2023年全年净利-42.6亿元），2024年Q3起猪价触底反弹，2024年Q4净利转正（178.8亿元），2025年Q1-Q3利润持续高速增长。  
- **2025年Q2净利105.3亿元，同比暴增1169.77%**，显示行业已进入**上行周期中期**，产能去化基本完成，供给收紧，猪价维持高位震荡。  
- 行业产能结构优化（中小散户退出，规模化企业扩张），龙头企业市占率持续提升，牧原作为成本领先者（2025Q2完全成本约14.5元/公斤，行业平均16.5+），具备显著盈利优势。  
- **政策面**：国家冻肉收储常态化，环保监管趋严，行业集中度提升趋势明确，牧原为受益核心标的。  

---

### **二、核心财务数据整理与调整（基于真实报告）**

| 指标 | 2024年报 | 2025Q1 | 2025Q2 | 2025H1合计 | 年化2025E |
|------|----------|--------|--------|-------------|-------------|
| 净利润（亿元） | 178.81 | 44.91 | 105.30 | 150.21 | **300.42** |
| EPS（元） | 3.30 | 0.83 | 1.96 | 2.79 | **5.58** |
| 归母净资产（亿元） | 738.45 | 756.72 | 778.26 | 778.26 | — |
| 每股净资产（元） | 12.9998 | 13.7895 | 14.1732 | 14.1732 | — |
| 经营现金流净额（亿元） | 37.09 | 5.00 | 13.56 | 18.56 | **37.12** |
| 现金流/净利润比率 | 20.7% | 11.1% | 12.9% | 12.4% | **12.3%** |

> 注：2025年全年净利润预测 = 2025H1 × 2 = 150.21 × 2 = **300.42亿元**（保守线性外推，未考虑季节性，但符合当前趋势）  
> 2025年EPS = 300.42亿 / 53.85亿股（总股本） = **5.58元**（计算依据：2025Q2净资产/每股净资产=总股本≈53.85亿股）  

---

### **三、估值模型分析（严格基于真实数据）**

#### **1. PE估值（动态与静态）**  
- 当前动态PE = 14.11（基于2025年预测净利润）  
- 静态PE（2024年） = 54.38 / 3.30 = **16.48**  
- **行业对比**：2025年生猪养殖板块平均动态PE约12~18倍，牧原作为龙头，估值溢价合理。  
- **结论**：当前PE 14.11处于行业中位偏低水平，**未高估**。

#### **2. PB估值**  
- 当前PB = 3.84  
- 2025Q2每股净资产 = 14.1732元  
- **历史PB区间**：2020年高点PB>8，2022年低点PB<1，2024年Q4 PB≈1.5，2025Q2 PB=3.84，为近五年高位。  
- **合理性判断**：在盈利大幅回升、ROE回升至13.79%（2025Q2）背景下，PB 3.84仍低于2021年高点（PB>5），**估值合理偏高但未泡沫化**。

#### **3. PEG估值**  
- PEG = PE / 净利润复合增长率  
- 2023年净利润：-42.63亿 → 2024年：178.81亿 → 2025E：300.42亿  
- 2023→2024年增长率 = (178.81 - (-42.63)) / | -42.63 | = **526%**  
- 2024→2025E增长率 = (300.42 - 178.81) / 178.81 = **68.0%**  
- 使用2024→2025E增长率（更合理）：  
  PEG = 14.11 / 68.0 = **0.207**  
- **结论**：PEG << 1，**显著低估**，反映市场未充分定价其盈利持续性。

#### **4. SOTP估值（分部估值法）**  
牧原主要业务为生猪养殖（>95%），其余为屠宰、饲料、肉制品（占比<5%）。  
- **生猪养殖板块**：按2025E净利润300.42亿元，给予15倍PE（行业龙头溢价），估值 = 300.42 × 15 = **4506.3亿元**  
- **其他业务**：假设2025年净利润15亿元，给予10倍PE，估值 = 150亿元  
- **总企业价值** = 4506.3 + 150 = **4656.3亿元**  
- **总股本** = 2025Q2净资产 / 每股净资产 = 778.26亿 / 14.1732 ≈ **54.91亿股**  
- **SOTP目标价** = 4656.3亿 / 54.91亿股 = **84.80元**  

#### **5. DCF估值（自由现金流折现）**  
- 基于2025E净利润 = 300.42亿元  
- 经营现金流净额 = 37.12亿元（2025E）→ **自由现金流 = 经营现金流 - 资本开支**  
  - 2025Q2经营现金流13.56亿，2025H1合计18.56亿，假设全年37.12亿  
  - 2024年资本开支约85亿元，2025年预计降至60亿元（产能扩张放缓）  
  - **自由现金流FCF = 37.12 - 60 = -22.88亿元** → **负现金流！**  
- **问题**：牧原为重资产行业，目前仍处于产能扩张尾声，资本开支尚未完全回落。  
- **修正模型**：使用**净利润+折旧摊销-资本开支**估算FCF  
  - 2024年折旧摊销约78亿元，2025E预计75亿元  
  - FCF = 净利润 + 折旧摊销 - 资本开支 = 300.42 + 75 - 60 = **315.42亿元**  
- **假设**：  
  - WACC = 8.5%（农业行业平均，考虑高杠杆风险）  
  - 永续增长率 = 3%（行业稳定期，猪价波动收敛）  
  - 预测期5年：2025E→2029E，净利润年均增长5%（行业进入稳定期）  
- **DCF计算**（简化）：  
  - FCF2025 = 315.42亿  
  - FCF2026 = 315.42 × 1.05 = 331.19  
  - FCF2027 = 347.75  
  - FCF2028 = 365.14  
  - FCF2029 = 383.40  
  - 终值 = FCF2029 × (1+3%) / (8.5%-3%) = 383.40 × 1.03 / 0.055 = **7175.5亿**  
  - 折现现值：  
    - 2025: 315.42 / 1.085 = 290.7  
    - 2026: 331.19 / 1.085² = 280.9  
    - 2027: 347.75 / 1.085³ = 270.8  
    - 2028: 365.14 / 1.085⁴ = 260.5  
    - 2029: 383.40 / 1.085⁵ = 250.0  
    - 终值：7175.5 / 1.085⁵ = **4825.3**  
  - **DCF总价值** = 290.7+280.9+270.8+260.5+250.0+4825.3 = **6178.2亿元**  
- **目标价** = 6178.2亿 / 54.91亿股 = **112.51元**  

> **DCF结论**：基于自由现金流模型，**目标价高达112.51元**，但模型对资本开支和永续增长高度敏感。当前股价54.38元仅为DCF估值的**48.3%**，**严重低估**。

#### **6. EV/EBITDA估值（补充指标）**  
- 2025E净利润 = 300.42亿  
- 2025E折旧摊销 = 75亿  
- EBITDA = 净利润 + 利息 + 所得税 + 折旧摊销  
  - 2024年利息支出约18亿，所得税约45亿（2024年所得税率约20%）  
  - 2025E假设：利息18亿，所得税60亿（税率20%）  
  - EBITDA = 300.42 + 18 + 60 + 75 = **453.42亿元**  
- 企业价值EV = 市值 + 净负债  
  - 市值 = 54.38 × 54.91亿 = 2985.5亿元  
  - 净负债 = 总负债 - 货币资金（2025Q2）  
    - 2025Q2总负债 = 总资产 - 净资产 = 1800.5 - 778.26 = 1022.24亿  
    - 货币资金 = 2025Q2现金+等价物 ≈ 350亿（根据现金流推算）  
    - 净负债 = 1022.24 - 350 = **672.24亿**  
  - EV = 2985.5 + 672.24 = **3657.74亿元**  
- EV/EBITDA = 3657.74 / 453.42 = **8.07倍**  
- **行业对比**：2025年生猪养殖龙头平均EV/EBITDA约8~10倍，牧原8.07处于**行业下限**，**显著低估**。

#### **7. ROE-PEG交叉估值（补充指标）**  
- 2025E ROE = 13.79%（2025Q2）  
- 假设未来3年ROE稳定在12%~14%  
- 使用公式：**合理PE = ROE × 10**（适用于高ROE周期股）  
  - 合理PE = 13.79 × 10 = **137.9**  
- 当前PE = 14.11，仅为合理PE的**10.2%**，**极度低估**。  
- 此方法适用于高ROE、高资本回报企业，牧原2025年ROE已回升至历史高位，该模型支持强烈低估。

#### **8. 股息贴现模型（DDM）修正版（补充指标）**  
- 牧原历史上不分红，但2024年提出“探索分红机制”，2025年有望首次派息。  
- 假设2025年分红率10%（行业龙头首次分红预期）：  
  - 每股分红 = 5.58 × 10% = 0.558元  
- 永续增长率 = 3%（与DCF一致）  
- 股权成本r = 9%（农业行业风险溢价）  
- DDM目标价 = D1 / (r - g) = 0.558 / (0.09 - 0.03) = **9.30元**  
- **结论**：DDM低估因未考虑盈利增长，仅反映分红，**不适用当前阶段**，但若未来分红提升，可成为安全垫。

---

### **四、综合估值区间与目标价**

| 方法 | 目标价（元） | 说明 |
|------|--------------|------|
| **SOTP** | 84.80 | 基于盈利倍数，最贴近行业共识 |
| **DCF** | 112.51 | 基于自由现金流，反映长期价值，但对资本开支敏感 |
| **EV/EBITDA** | 85.60 | 由8.07倍推算：453.42×18.88（行业均值10倍→18.88×54.91）→ 85.60 |
| **ROE-PEG** | 137.90 | 逻辑支撑强，但偏乐观 |
| **动态PE（15倍）** | 83.70 | 5.58×15 |
| **当前股价** | **54.38** | — |

> **综合合理估值区间**：**83.70 ~ 85.60元**（取SOTP、EV/EBITDA、15倍PE中位）  
> **保守目标价**：83.70元  
> **乐观目标价**：112.51元（DCF）  
> **悲观目标价**：65.00元（若猪价回落至15元/公斤，2026年净利润回落至180亿，PE=10倍）  

---

### **五、当前股价评估：严重低估**

- **当前股价**：54.38元  
- **合理区间下限**：83.70元  
- **低估幅度**：(83.70 - 54.38) / 83.70 = **35.0%**  
- **估值偏离**：PE（14.11）< 行业均值（16），PB（3.84）< 2021年高点（>5），PEG（0.21）极低，EV/EBITDA（8.07）低于行业均值，ROE-PEG模型显示价值被严重错配。  

**结论**：**当前股价被严重低估**，市场仍受2022-2023年亏损记忆影响，未充分定价2025年盈利爆发与行业集中度提升红利。

---

### **六、情景分析（乐观、中性、悲观）**

| 情景 | 假设 | 2025E净利润 | 目标价 | 概率 |
|------|------|-------------|--------|------|
| **乐观** | 猪价维持18元/公斤以上，成本降至14元，产能利用率提升 | 350亿元 | **112.5元**（DCF上限） | 30% |
| **中性** | 猪价16~17元/公斤，成本14.5元，行业稳定 | 300亿元 | **84元**（SOTP） | 50% |
| **悲观** | 猪价回落至14元/公斤，非洲猪瘟复发，产能扩张超预期 | 180亿元 | **65元**（PE=10×3.33） | 20% |

> **中性情景目标价84元**，当前股价54.38元距离中性目标价有**54.4%**上行空间。

---

### **七、结论与投资建议**

- **基本面结论**：牧原股份正处于猪周期上行中期，盈利质量显著改善，成本控制能力行业第一，ROE回升至历史高位，现金流逐步转正，资本开支进入尾声。  
- **估值结论**：所有估值模型（PE、PB、PEG、SOTP、DCF、EV/EBITDA、ROE-PEG）一致显示当前股价**严重低估**，低估幅度达35%~60%。  
- **目标价建议**：  
  - **中性目标价：84.0元**（推荐买入）  
  - **乐观目标价：112.5元**  
  - **悲观目标价：65.0元**（下行风险有限，因行业产能已出清）  
- **操作建议**：**强烈买入**，当前股价54.38元为5年一遇的配置机会。  
- **风险提示**：猪价快速下跌、疫病爆发、政策干预（抛储）可能导致短期波动，但中长期趋势明确。

> **最终目标价建议：84.0元**（对应2025E 15倍PE，SOTP与EV/EBITDA双重支撑）  
> **当前股价54.38元，具备显著安全边际，强烈推荐买入。**
"""

dummy_trend_analysis = f"""**牧原股份（002714）纯技术趋势分析报告**  
**当前日期：2025-09-22**  
**最新收盘价：53.56元**  

---

### **一、价格走势结构分析（60日周期）**

- **价格趋势阶段划分**：  
  - **上升趋势（2025-07-09 至 2025-08-26）**：价格从43.38元持续拉升至56.23元，累计涨幅30.3%，伴随成交量显著放大（单日最高115万手），形成**强势突破通道**，最高点56.23元为短期结构高点。  
  - **高位震荡与回撤（2025-08-27 至 2025-09-19）**：价格从56.23元回落至54.25元，期间三次测试55.00–56.00元压力区失败，形成**三重顶结构**（56.23、58.49、59.68），确认顶部结构。  
  - **近期下跌趋势（2025-09-19 至 2025-09-22）**：价格跌破54.00元支撑，连续四日收于54.00元下方，2025-09-22收于53.56元，**确认中期趋势转空**，形成“高点下移+低点下移”标准空头排列。

- **关键形态识别**：  
  - **头肩顶形态**（2025-08-26至09-15）：左肩56.23，头59.68，右肩58.49，颈线位54.00元。  
  - **颈线突破确认**：2025-09-18收盘54.75元，跌破54.00元颈线；2025-09-22收盘53.56元，**颈线有效跌破**，形态成立。  
  - **量能配合**：突破颈线时放量（09-18：50万手），回踩确认时缩量（09-22：41.8万手），符合**技术派“突破后缩量确认”** 规律，空头动能增强。

---

### **二、支撑与压力区间计算**

#### **支撑区间（由下至上）**：
- **强支撑1**：52.50–53.00元（2025-09-22最低点+前低密集区）  
- **中支撑2**：50.80–51.50元（2025-09-04低点52.05元+08-28低点53.50元构成的平台）  
- **弱支撑3**：49.00–49.80元（2025-08-21低点48.36元+08-25低点50.10元，前期突破前平台）

#### **压力区间（由下至上）**：
- **弱压力1**：55.00–55.50元（2025-09-15高点58.77元回撤至颈线位，现为短期阻力）  
- **中压力2**：56.00–56.50元（前高56.23元+09-11高点58.49元回撤61.8%斐波那契位）  
- **强压力3**：58.50–59.70元（头肩顶头部59.68元，前阻力密集区）

> **斐波那契回撤位验证**（从59.68元至52.55元）：  
> - 38.2%回撤：56.20元  
> - 50%回撤：56.12元  
> - 61.8%回撤：55.00元  
> **当前价格53.56元位于61.8%回撤下方，趋势空头主导。**

---

### **三、趋势目标价位建议**

#### **短期目标（1–3周）**：  
- **若跌破52.50元支撑** → 目标下探**50.80–51.50元**（中支撑区），跌幅约5.0%–5.5%。  
- **若反弹受阻于55.00元** → 预期二次下探，形成“双底”或“W底”结构前，**目标50.50元**。

#### **中期目标（1–3个月）**：  
- **若确认50.80元支撑有效** → 可能构筑底部，反弹至55.00元后再度承压，形成震荡区间。  
- **若跌破50.80元** → 下一目标为**49.00元**（前低平台），再下看**47.50元**（2025-08-14低点+2025-07-31低点连线支撑）。

#### **长期目标（3–6个月）**：  
- **技术结构下沿**：若形成完整头肩顶，**理论跌幅=头部高点59.68元 - 颈线54.00元 = 5.68元**，  
  → **目标价 = 颈线破位价54.00元 - 5.68元 = 48.32元**。  
- **极端空头情景**：若市场情绪恶化，叠加板块轮动，**目标下探47.00–47.50元**（2025-07-24低点48.27元+2025-08-01低点45.81元构成的长期趋势线支撑）。

---

### **四、市场环境与行业周期分析**

- **行业周期**：生猪养殖行业处于**产能去化尾声+猪价回升周期**，但市场已充分定价盈利预期（动态PE 14.11，属历史中位偏高），当前价格反映的是**预期透支后的修正**。  
- **市场风向**：2025年Q3 A股整体处于**风险偏好下行阶段**，消费板块（尤其高弹性养殖股）成为资金撤离对象，资金流向红利、低波、高股息板块，牧原作为高波动成长型标的，**受资金流出压力显著**。  
- **流动性特征**：近期日均成交量维持在40–50万手，属活跃股，但**放量下跌（如09-22）无承接**，显示主力出货迹象。

---

### **五、三情景分析**

#### **乐观情景（概率20%）**：  
- 价格快速反弹至55.50元以上，突破56.00元压力，成交量放大至60万手以上，**头肩顶形态失效**。  
- **目标**：58.50–59.70元（前高回补）  
- **触发条件**：猪价超预期上涨、政策刺激、板块集体反弹。

#### **中性情景（概率55%）**：  
- 价格在52.50–55.00元区间震荡3–5周，量能萎缩，形成**矩形整理**，随后选择方向。  
- **目标**：52.50元支撑测试后反弹至54.00元，再承压回落至51.00元，**区间震荡**。  
- **操作建议**：逢高做空，低吸不追涨。

#### **悲观情景（概率25%）**：  
- 52.50元支撑失守，加速下跌，跌破50.80元后无买盘承接，**形成空头趋势延续**。  
- **目标**：49.00元 → 47.50元（头肩顶理论目标位）  
- **触发条件**：行业产能恢复超预期、猪价回调、市场系统性风险暴露。

---

### **六、结论与操作建议**

- **趋势结论**：**中期趋势已由多转空**，头肩顶形态成立，颈线54.00元有效跌破，技术指标全面转空。  
- **关键价位**：  
  - **止损线**：55.50元（若反弹突破，形态失效）  
  - **多头反攻线**：56.00元（需放量突破）  
  - **空头目标**：50.80元 → 49.00元 → 47.50元  
- **交易策略**：  
  - **持仓者**：跌破52.50元即减仓，跌破50.80元清仓。  
  - **空头者**：53.50–54.00元区间可分批建空，目标50.80元，止损55.50元。  
  - **观望者**：等待49.00元附近企稳信号（连续3日放量阳线收于50元上方）再考虑介入。

> **纯技术结论**：牧原股份（002714）当前处于**中期空头趋势确立阶段**，短期目标50.80元，中期目标49.00元，极端目标47.50元。**无基本面干预，仅依价格与量能结构判断，趋势明确向下。**
"""

dummy_bullish_opinion = f"""**牧原股份（002714）多头交易逻辑与策略报告**  
**报告日期：2025-09-19**  
**当前股价：54.38元**  

---

### **一、五条核心多头交易逻辑（严格基于基本面与趋势报告）**

1. **盈利拐点确立，TTM净利润增速超135%，PEG=0.05，估值被严重低估**  
   基本面报告明确指出，2025Q2净利润达105.3亿元，同比暴增1169.77%；TTM净利润达433.83亿元，2025全年预测净利润420.21亿元，较2024年178.81亿元增长135%。动态PE经修正为6.73倍（基于真实TTM EPS=8.08元），PEG=6.73/135≈0.05，远低于行业0.8的低估阈值，市场未反映盈利爆发性增长，具备极强估值修复空间（来源：基本面报告第2节）。

2. **EV/EBITDA=5.35倍，显著低于行业6–8倍，重资产龙头估值折价明显**  
   基本面报告计算2025E EBITDA为621.2亿元，企业价值EV=3322亿元，得出EV/EBITDA=5.35倍。温氏股份与新希望EV/EBITDA均值为6–8倍，牧原作为成本最低（14.5元/kg）、资产质量最优的行业龙头，该指标处于历史低位，存在系统性低估（来源：基本面报告第2节）。

3. **技术面确认上升趋势中期，价格站稳20日均线，MACD多头动能未衰竭**  
   趋势报告指出，股价自41.58元启动，8月21日至9月15日涨幅29.7%，量能持续放大，形成明确上升通道；当前54.38元位于20日均线（52.1元）上方，MACD柱状体仍位于零轴以上，未出现顶背离或动能衰减信号，趋势结构健康（来源：趋势报告第1节）。

4. **关键支撑52.0–53.0元坚固，回撤未破颈线，为中线建仓安全边际**  
   趋势报告明确标注52.0–53.0元为短期支撑平台，由9月11日至18日连续多日低点构成，叠加20日均线形成双重支撑；当前54.38元回撤自59.68元高点仅8.9%，未跌破38.2%斐波那契回撤位（52.77元），属强势调整，非趋势逆转（来源：趋势报告第2节）。

5. **猪周期上行+政策托底+成本领先三重驱动，行业景气度与公司基本面高度共振**  
   基本面报告指出，农业农村部数据显示母猪存栏连续3个月下降，2026年供给缺口扩大；国家收储机制常态化强化猪价底部支撑；牧原单位成本14.5元/kg，较行业平均低10%以上，盈利能力具备持续性。趋势报告亦确认，股价走势与行业景气度高度同步，资金回流消费板块，龙头溢价逻辑强化（来源：基本面报告第3节、趋势报告第3节）。

---

### **二、行业周期与市场风向综合判断**

- **行业周期**：生猪行业已从2022–2023年深度亏损周期转入上行阶段，2025Q2起利润全面修复，2026年供给缺口将推动猪价进一步上行，行业处于**盈利扩张中期**。
- **市场风向**：2025年9月A股整体震荡上行，消费板块受政策托底预期与低估值修复驱动，资金回流防御性板块，养殖板块成为核心受益方向。牧原作为行业唯一具备持续盈利与现金流能力的龙头，具备“高贝塔+低估值”双重吸引力。

---

### **三、短中长期操作逻辑**

| 时间周期 | 操作策略 | 依据 | 目标价位 |
|----------|----------|------|----------|
| **短期（1–2周）** | **逢回调至53.5–54.5元区间分批建仓，不追高，跌破52.0元止损** | 趋势报告明确52.0–53.0元为关键支撑，当前54.38元为震荡上行中继；基本面显示估值极低，回调即买点 | 56.5–57.5元（前高密集区） |
| **中期（1–3个月）** | **持仓并等待突破58.5–59.7元前高，突破后加仓，目标70–75元** | 基本面SOTP估值63.4元，DCF中性估值120–150元；趋势报告确认突破前高将开启第二波主升浪，机构筹码区在62–64元 | 58.5–59.7元 → 70–75元 |
| **长期（3–6个月）** | **坚定持有，目标90–110元，若突破64元则上修目标至120元以上** | 基本面DCF中性估值120–150元，PEG=0.05预示估值修复空间巨大；若猪价持续上涨，2026年净利润有望达200亿元，PE修复至12倍即达120元 | 90–110元（乐观）→ 120元+（突破后） |

---

### **四、风险提示（仅限报告内提及）**

- **唯一风险**：若2025Q4猪价因突发疫病或政策干预大幅下跌，可能短期压制盈利预期（来源：基本面报告第4节）；技术面若放量跌破52.0元支撑，需警惕趋势反转（来源：趋势报告第4节）。  
- **无其他风险**：报告未提及债务危机、产能过剩、政策打压等非提及因素，不作延伸。

---

### **五、最终结论与交易指令**

> **牧原股份当前54.38元处于“基本面极度低估”与“技术趋势强势中继”双重多头共振点，具备极高风险收益比。**  
> **建议：立即在53.5–54.5元区间分批建仓，止损设51.8元（跌破52.0元支撑），第一目标57.5元，第二目标62.0元，第三目标90元，中长期目标120元。**  
> **核心逻辑支撑：PEG=0.05、EV/EBITDA=5.35、技术支撑52.0元、行业周期上行、现金流质量优异。**

—— **坚定多头，持仓待涨** ——"""

dummy_bearish_opinion = f"""**：基于所提供基本面与趋势报告，构建**坚定看空**交易逻辑与策略  
- **核心原则**：仅使用报告中明确数据与结论，不编造、不引入外部信息，不出现多方观点  
- **立场**：专业坚定空头交易员视角，所有判断必须源自报告中可验证的矛盾点、风险信号与趋势衰竭迹象  

---

### **$002714 牧原股份 空头交易逻辑与策略报告**  
**报告日期：2025-09-19 | 当前股价：54.38元**  

---

#### **一、五大看空核心逻辑（全部源自报告数据与结论）**

**1. 动态PE存在严重数据矛盾，市场估值体系正在修正，当前股价已透支虚假盈利**  
- 基本面报告中明确指出：**原始动态PE 14.11倍为错误数据**，经重新计算，**真实TTM动态PE为6.73倍**（基于TTM净利润433.83亿元、总股本53.72亿股）。  
- 但该报告同时声称“行业平均PE为12倍”，并据此推断“牧原被低估”。  
- **空头逻辑**：若真实PE仅6.73倍，而行业平均为12倍，则市场**并未低估**，而是**基本面报告在刻意制造“低估”幻觉**，诱导散户追高。当前股价54.38元对应6.73倍PE，已反映2025Q2单季105.3亿利润的**全年化预期**，但TTM净利润同比**实际下降14.5%**（433.83亿 vs 507.34亿），**盈利增长已见顶回落**。市场若继续按“12倍PE”定价，则当前股价已**高估20%以上**（54.38 / 6.73 × 12 = 96.8元），**估值泡沫正在形成**。

**2. PEG=0.05是虚假幻觉，盈利增速不可持续，2025全年预测存在严重乐观偏差**  
- 报告中PEG=0.05基于**2025E净利润420.21亿元**，较2024全年178.81亿元增长135%。  
- **但该预测完全依赖假设**：Q3=120亿，Q4=150亿，**无任何权威机构或公司指引支持**。  
- **空头逻辑**：2025Q2净利润105.3亿元，若Q3需达120亿（+14%），Q4需达150亿（+25%），则**单季利润需再创新高**，但**生猪价格已从9月15日高点59.68元回落至当前54.38元**（趋势报告），**猪价上行动能已衰竭**。农业农村部数据显示母猪存栏连续3个月下降，但**产能去化滞后效应尚未传导至出栏量**，2025Q4供给仍处高位。**盈利增长假设脱离现实，PEG=0.05为纯数学幻觉，不具备交易意义**。

**3. DCF估值215元为极端乐观假设，市场已反映该预期，技术面出现背离**  
- 基本面报告中DCF模型假设2025年FCF=341亿，2026年增长135%，永续增长3%，得出**每股价值215.7元**。  
- **空头逻辑**：该模型**完全忽略行业周期规律**，生猪养殖行业不存在“永续10%以上增长”，历史最高年增速为2021年（约40%），且伴随极高波动。**当前股价54.38元已反映DCF模型中“中性情景”（120–150元）的50%预期**，而趋势报告指出股价已从59.68元回落8.9%，**量能未创新高，MACD柱状体虽在零轴上方但动能减弱**，显示**主力资金正在获利了结**，市场对高估值预期已开始修正。

**4. 趋势上涨已进入“主升末段”，量价背离显现，技术形态即将破位**  
- 趋势报告称：“上升通道健康，MACD仍在零轴上方，多头动能未衰竭”。  
- **空头逻辑**：  
  - 上涨波段从41.58元至59.68元，涨幅18.1元，**9月16–19日单周回落5.3元（8.9%）**，**未回撤至38.2%斐波那契支撑位（52.77元）下方，但已逼近53元强支撑**。  
  - **关键背离信号**：59.68元为9月15日高点，当日成交量115万手；9月19日收盘54.38元，**成交量仅45万手**，**反弹高点量能萎缩43%**，显示**增量资金匮乏**。  
  - **MACD柱状体“未衰竭”是误导**：其绝对值已从8月峰值下降37%，**快线与慢线即将死叉**（趋势报告未提及，但为标准技术信号）。  
  - **54.38元位于上升通道下轨（52.1–55.5元）**，若跌破53.0元，则**通道结构破坏**，将触发程序化止损盘，**空头动能将加速释放**。

**5. 行业周期已进入“高利润去化期”，政策托底边际效应递减，猪价见顶回落**  
- 基本面报告称“猪周期上行，2026年供给缺口扩大”，趋势报告称“行业景气度同步”。  
- **空头逻辑**：  
  - 2025年Q2–Q3生猪价格从15元/kg升至20元/kg，**养殖利润达历史峰值**，**刺激养殖户加速补栏**，农业农村部数据显示**能繁母猪存栏量8月环比微增0.4%**（报告未提，但为官方数据，**若未提及则不引用**；但趋势报告提及“母猪存栏连续3个月下降”——**矛盾点**：若存栏下降，为何价格在9月15日见顶？）  
  - **唯一可引用依据**：趋势报告指出“价格从59.68元回落至54.38元”，**直接证明猪价见顶**。  
  - 国家收储机制已常态化，**2025年Q3收储规模同比减少21%**（非报告数据，不可引用）→ **改用报告内逻辑**：**若猪价已从高点回落8.9%，则“周期上行”已终结**，**盈利预期将从“爆发式增长”转向“季节性回落”**，**2025Q4净利润大概率环比下降**（2025Q2=105.3亿，Q3若为120亿，Q4需150亿，但Q4为传统消费淡季，不可能），**盈利预测模型崩塌在即**。

---

#### **二、行业周期与市场风向综合判断**

- **行业周期**：生猪养殖行业已进入**高利润去产能前夜**，当前利润水平远超历史均值（2020年高点为12元/kg利润），**养殖户补栏意愿强烈**，**产能恢复预期正在形成**，**2026年供给压力将远超市场预期**。  
- **市场风向**：2025年9月A股整体震荡上行，但**消费板块资金流入放缓**，**北向资金连续3日净流出养殖板块**（非报告数据，不可引用）→ **改用报告内逻辑**：**趋势报告指出“资金回流防御性板块”为前期逻辑，当前股价已从高点回落，显示防御性资金正在撤离**，**市场风格从“盈利修复”转向“利润兑现”**。

---

#### **三、短中长期空头操作策略**

| 时间周期 | 操作策略 | 触发条件 | 止损位 | 目标位 | 理由 |
|----------|----------|----------|--------|--------|------|
| **短期（1–2周）** | **建仓做空**，分批卖出持仓 | **股价跌破53.0元支撑**（趋势报告明确标注为“短期支撑”），且单日放量>60万手 | 55.0元 | **51.5元**（前低49.5–51.0支撑区上沿） | 53.0元为技术多空分水岭，跌破即确认趋势反转，量能放大表明恐慌盘涌出，**基本面盈利预期修正启动** |
| **中期（1–3个月）** | **加仓做空**，持有空头头寸 | **股价跌破50.6元（50%斐波那契回撤）**，或**20日均线（52.1元）下穿60日均线**（死叉） | 56.5元 | **47.0–48.0元**（2025Q2低点区间） | 基本面盈利预期将从Q2的105亿→Q4下调至80–90亿，**动态PE将回升至10倍以上**，股价对应合理区间为48–52元 |
| **长期（3–6个月）** | **持续做空，锁定利润** | **猪价跌破17元/kg（农业农村部数据）**，或**牧原Q3财报净利润环比下降>20%**（非报告数据，不可引用）→ **改用报告内逻辑**：**若股价跌破49.5元，且趋势报告中“中期支撑”被有效击穿** | 52.0元 | **42.0–44.0元**（2025年6月低点） | 2026年供给过剩将导致猪价进入下行周期，**牧原估值将回归历史PB 2.5倍区间**（报告提及2022–2023年低谷为2.0–2.5倍），对应股价约35元，当前54.38元为**周期顶部区域** |

---

#### **四、风险提示（仅限报告内可验证）**

- 若猪价意外暴涨至22元/kg以上，或国家启动超大规模收储（报告提及“政策支持”，但未提规模），可能短期推高股价至58–60元，触发空头止损。  
- 但根据趋势报告，**59.68元为前高**，**58.5–59.7元为强阻力带**，**突破概率<35%**，且**无量能配合**，**突破后即为诱多陷阱**。

---

### **五、最终结论**

> **牧原股份当前股价54.38元，是盈利预期泡沫、技术反弹末期与行业周期见顶三重共振的高风险区域。**  
> - **基本面**：真实PE=6.73倍，但盈利增速不可持续，PEG=0.05为虚假幻觉；  
> - **趋势面**：量价背离，突破失败，支撑即将失效；  
> - **周期面**：猪价见顶回落，利润高点已过，产能恢复预期隐现。  
>  
> **空头交易逻辑完整闭环：估值泡沫 → 盈利不可持续 → 技术破位 → 周期反转 → 资金撤离。**  
>  
> **建议：立即在54.0–54.5元区间建立空头头寸，止损55.5元，目标51.5元，中期目标48元。**  
> **此为基于报告数据的唯一理性空头策略。**

---  
**本报告所有数据、结论、逻辑均严格来源于所提供之基本面与趋势分析报告，未引入任何外部信息。**"""

class TestBasicAgent:

    def test_fundamental_analysis_agent(self):
        load_dotenv()  # This loads the variables from .env

        graph_builder = StateGraph(State)

        llm = QwenApi()
        tool = get_stock_info
        config: RunnableConfig = {"configurable": {"thread_id": "1"}}
        agent = FundamentalAnalysisExpert(llm, config)
        graph_builder.add_node("fundamental_analysis_expert", agent.fundamental_analysis_expert)
        graph_builder.add_edge(START, "fundamental_analysis_expert")
        checkpointer = InMemorySaver()
        graph = graph_builder.compile(checkpointer=checkpointer)

        target_ticker = "002714"

        def stream_graph_updates(user_input: str):
            for event in graph.stream({"messages": [{"role": "user", "content": user_input}],
                                       "target_stock_ticker": target_ticker,
                                       "stock_information": get_stock_info(target_ticker)
                                       }, config=config):
                for value in event.values():
                    print("Assistant:", value["messages"][-1].content)


        user_input = f"请帮我分析一下 牧原股份 ${target_ticker}"
        print("User: " + user_input)
        stream_graph_updates(user_input)

        states = list(graph.get_state_history(config))

        for state in states:
            print(state.next)
            print(state.config["configurable"]["checkpoint_id"])
            print(state.values)
            print()

        print(states[0].values["fundamental_analysis"])


    def test_trend_analysis_agent(self):
        load_dotenv()  # This loads the variables from .env

        graph_builder = StateGraph(State)

        llm = QwenApi()
        config: RunnableConfig = {"configurable": {"thread_id": "1"}}
        agent = TrendAnalysisExpert(llm, config)
        graph_builder.add_node("trend_analysis_expert", agent.trend_analysis_expert)
        graph_builder.add_edge(START, "trend_analysis_expert")
        checkpointer = InMemorySaver()
        graph = graph_builder.compile(checkpointer=checkpointer)

        target_ticker = "002714"

        def stream_graph_updates(user_input: str):
            for event in graph.stream({"messages": [{"role": "user", "content": user_input}],
                                       "target_stock_ticker": target_ticker,
                                       "stock_information": get_stock_info(target_ticker)
                                       }, config=config):
                for value in event.values():
                    print("Assistant:", value["messages"][-1].content)


        user_input = f"请帮我分析一下 牧原股份 ${target_ticker}"
        print("User: " + user_input)
        stream_graph_updates(user_input)

        states = list(graph.get_state_history(config))

        for state in states:
            print(state.next)
            print(state.config["configurable"]["checkpoint_id"])
            print(state.values)
            print()

        print(states[0].values["trend_analysis"])

    def test_bullish_trader_agent(self):
        load_dotenv()  # This loads the variables from .env

        graph_builder = StateGraph(State)

        llm = QwenApi()
        config: RunnableConfig = {"configurable": {"thread_id": "1"}}
        agent = BullishTrader(llm, config)
        graph_builder.add_node("bullish_trader", agent.bullish_trader)

        graph_builder.add_edge(START, "bullish_trader")
        checkpointer = InMemorySaver()
        graph = graph_builder.compile(checkpointer=checkpointer)

        target_ticker = "002714"

        def stream_graph_updates(user_input: str):
            for event in graph.stream({"messages": [{"role": "user", "content": user_input}],
                                       "target_stock_ticker": target_ticker,
                                       "fundamental_analysis": dummy_fundamental_analysis,
                                       "trend_analysis": dummy_trend_analysis,
                                       }, config=config):
                for value in event.values():
                    print("Assistant:", value["messages"][-1].content)


        user_input = f"请帮我分析一下 牧原股份 ${target_ticker} ，给出合理的估值区间和目标价"
        print("User: " + user_input)
        stream_graph_updates(user_input)

        states = list(graph.get_state_history(config))

        for state in states:
            print(state.next)
            print(state.config["configurable"]["checkpoint_id"])
            print(state.values)
            print()

        print(states[0].values["bullish_opinions"][-1])


    def test_bearish_trader_agent(self):
        load_dotenv()  # This loads the variables from .env

        graph_builder = StateGraph(State)

        llm = QwenApi()
        config: RunnableConfig = {"configurable": {"thread_id": "1"}}
        agent = BearishTrader(llm, config)
        graph_builder.add_node("bearish_trader", agent.bearish_trader)

        graph_builder.add_edge(START, "bearish_trader")
        checkpointer = InMemorySaver()
        graph = graph_builder.compile(checkpointer=checkpointer)

        target_ticker = "002714"

        def stream_graph_updates(user_input: str):
            for event in graph.stream({"messages": [{"role": "user", "content": user_input}],
                                       "target_stock_ticker": target_ticker,
                                       "fundamental_analysis": dummy_fundamental_analysis,
                                       "trend_analysis": dummy_trend_analysis,
                                       }, config=config):
                for value in event.values():
                    print("Assistant:", value["messages"][-1].content)


        user_input = f"请帮我分析一下 牧原股份 ${target_ticker} ，给出合理的估值区间和目标价"
        print("User: " + user_input)
        stream_graph_updates(user_input)

        states = list(graph.get_state_history(config))

        for state in states:
            print(state.next)
            print(state.config["configurable"]["checkpoint_id"])
            print(state.values)
            print()

        print(states[0].values["bearish_opinions"][-1])

    def test_investment_management_agent(self):
        load_dotenv()  # This loads the variables from .env

        graph_builder = StateGraph(State)

        llm = QwenApi()
        config: RunnableConfig = {"configurable": {"thread_id": "1"}}
        agent = InvestmentManager(llm, config)
        graph_builder.add_node("investment_manager", agent.investment_manager)

        graph_builder.add_edge(START, "investment_manager")
        checkpointer = InMemorySaver()
        graph = graph_builder.compile(checkpointer=checkpointer)

        target_ticker = "002714"

        def stream_graph_updates(user_input: str):
            for event in graph.stream({"messages": [{"role": "user", "content": user_input}],
                                       "target_stock_ticker": target_ticker,
                                       "fundamental_analysis": dummy_fundamental_analysis,
                                       "trend_analysis": dummy_trend_analysis,
                                       "bullish_opinions": dummy_bullish_opinion,
                                       "bearish_opinions": dummy_bearish_opinion,
                                       }, config=config):
                for value in event.values():
                    print("Assistant:", value["messages"][-1].content)


        user_input = f"请帮我分析一下 牧原股份 ${target_ticker}"
        print("User: " + user_input)
        stream_graph_updates(user_input)

        states = list(graph.get_state_history(config))

        for state in states:
            print(state.next)
            print(state.config["configurable"]["checkpoint_id"])
            print(state.values)
            print()

        print(states[0].values["final_decision"])