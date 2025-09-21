from typing import Annotated

from dotenv import load_dotenv
from langchain_core.runnables import RunnableConfig
from langgraph.prebuilt import ToolNode
from typing_extensions import TypedDict

from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages

from agents.chinese_mainland.bearish_trader import BearishTrader
from utils.state import State
from core.llms.qwen.qwen_api import QwenApi
from core.llms.tools.get_company_info import get_stock_info
from agents.chinese_mainland.fundamental_analysis_expert import FundamentalAnalysisExpert
from agents.chinese_mainland.trend_analysis_expert import  TrendAnalysisExpert
from agents.chinese_mainland.bullish_trader import BullishTrader
from langgraph.checkpoint.memory import InMemorySaver
from loguru import logger

from IPython.display import Image, display


dummy_fundamental_analysis = f"""# 牧原股份（002714）基本面深度分析报告  
**当前股价：54.38元 | 动态PE：14.11 | PB：3.84 | 报告日期：2025-09-19**

---

## 一、核心财务数据与趋势分析（基于真实财报）

### 1. 盈利能力恢复强劲，周期底部已过
牧原股份作为中国最大的生猪养殖企业，过去三年经历行业深度亏损周期（2022Q1–2023Q4），但**2024年Q3起迎来盈利反转**，2025年Q2净利润达**105.3亿元**，同比暴增**1169.77%**，EPS达**1.96元**，盈利能力已恢复至历史高位水平。

| 财报期 | 净利润（亿元） | YoY% | EPS（元） | 毛利率 |
|--------|----------------|------|-----------|--------|
| 2022Q4 | 132.66         | 92.16% | 2.49      | 17.50% |
| 2023Q4 | -42.63         | -132.14% | -0.79     | 3.11%  |
| 2024Q4 | 178.81         | 519.42% | 3.30      | 19.05% |
| 2025Q2 | 105.30         | 1169.77% | 1.96      | 19.02% |

> ✅ **结论**：公司已从周期谷底强势复苏，2025年Q2盈利能力超越2024年全年单季水平，显示**成本控制（自繁自养模式）与猪价上行周期双重驱动**。

### 2. 成本优势与现金流强劲
- **2025Q2现金流量净额/股：3.18元**，远高于净利润（1.96元），说明**利润质量高、非现金收入少**。
- **毛利率稳定在19%**，高于行业平均（约12–15%），反映其**垂直一体化养殖模式的成本控制能力**。
- **ROE从2023Q4的-6.38%回升至2025Q2的13.79%**，资本回报效率显著修复。

---

## 二、估值模型分析（基于真实数据）

### 1. **动态PE估值（14.11倍）**
- 当前动态PE = 54.38 / 2025Q2 EPS × 4 = 54.38 / (1.96 × 4) = 54.38 / 7.84 ≈ **6.94倍**（**错误！**）
- **纠正**：动态PE是基于**最近12个月（TTM）净利润**计算。  
  TTM净利润 = 2024Q3 + 2024Q4 + 2025Q1 + 2025Q2  
  = 104.81 + 178.81 + 44.91 + 105.30 = **433.83亿元**  
  总股本 = 净利润 / EPS（2025Q2）= 105.30 / 1.96 ≈ **53.72亿股**  
  TTM EPS = 433.83 / 53.72 ≈ **8.08元**  
  **动态PE = 54.38 / 8.08 ≈ 6.73倍**

> ❗**原始数据“动态PE:14.11”明显错误**，应为**6.73倍**（基于真实TTM利润）。  
> **行业对比**：温氏股份动态PE约12倍，新希望约15倍。牧原**显著低估**。

### 2. **PB估值（3.84倍）**
- 2025Q2净资产/股 = 14.17元  
- 当前股价54.38元 → PB = 54.38 / 14.17 ≈ **3.84倍**  
- **历史PB区间**：2020年高点达10倍，2022–2023年低谷为2.0–2.5倍  
- **合理PB区间**：当前行业平均PB为3.2–4.0倍，牧原资产质量（种猪、生物资产）优于同行，**应享有溢价**。  
- **结论**：PB 3.84处于合理区间上限，**未明显高估**。

### 3. **PEG估值（盈利增长驱动）**
- TTM净利润增速 = 433.83亿 vs 2024Q1–Q4净利润 = 104.81+178.81+44.91+178.81 = 507.34亿  
  → **TTM净利润同比增速 = (433.83 - 507.34) / 507.34 = -14.5%**（负增长）  
  → 但**2025年全年预测**：若Q3、Q4延续Q2增速（保守估计Q3=120亿，Q4=150亿），则2025全年净利润 ≈ 44.91 + 105.30 + 120 + 150 = **420.21亿元**  
  2024全年净利润 = 178.81亿元  
  → **2025E净利润增速 = (420.21 - 178.81) / 178.81 ≈ 135%**  
- **PEG = PE / 增速 = 6.73 / 135 ≈ 0.05**  
- **行业标准**：PEG < 0.8为低估，<0.5为极低估  
- **结论**：**PEG=0.05，极度低估**，市场未反映盈利爆发性增长。

### 4. **SOTP估值（分部估值法）**
牧原为**一体化养殖企业**，可拆分为：
- **生猪销售业务**（95%收入）：按2025E净利润420亿元，行业平均PE 8–10倍 → 3360–4200亿元
- **种猪/育种技术**（隐性资产）：行业龙头溢价，保守按净利润5%估值 → 21亿元
- **屠宰与肉制品**（2024年收入18亿，亏损收窄）：按收入1.5x PS → 27亿元

> **SOTP总估值 = 3360 + 21 + 27 = 3408亿元**  
> 总股本53.72亿股 → **目标价 = 3408 / 53.72 ≈ 63.44元**

### 5. **DCF估值（自由现金流折现）**
#### 假设参数（基于历史数据推导）：
- **2025E FCF** = 经营现金流净额（2025Q2 × 2）= 3.18 × 2 × 53.72亿股 ≈ **341亿元**（保守）
- **永续增长率**：生猪行业长期增速≈3%（人口增长+消费升级）
- **WACC**：行业平均8.5%（高负债企业，但现金流改善）
- **预测期**：5年（2025–2029），FCF年增长：2025:135%, 2026:40%, 2027:25%, 2028:15%, 2029:10%

| 年份 | FCF（亿元） | 折现因子（8.5%） | 折现值（亿元） |
|------|-------------|------------------|----------------|
| 2025 | 341         | 0.9217           | 314.3          |
| 2026 | 477         | 0.8495           | 405.2          |
| 2027 | 596         | 0.7828           | 466.6          |
| 2028 | 685         | 0.7214           | 494.2          |
| 2029 | 754         | 0.6650           | 501.5          |
| 终值 | 754×(1+3%)/(8.5%-3%) = 14,127 | 0.6650 | 9,405.6 |

> **DCF总价值 = 314.3+405.2+466.6+494.2+501.5+9405.6 = 11,587.4亿元**  
> **每股价值 = 11,587.4 / 53.72 ≈ 215.7元**

> ❗**DCF结果远高于股价，因假设盈利持续高增长**，但需谨慎。  
> **修正DCF**：采用更保守增速（2026:20%, 2027:10%, 2028:5%, 2029:3%）  
> 重新计算终值 = 754×1.03/(0.085-0.03) = 14,127 → 折现值不变，但前四年下降：  
> → **总DCF = 8,200亿元 → 每股152.7元**

> ✅ **DCF合理区间：120–150元**（基于乐观至中性增长假设）

### 6. **EV/EBITDA估值（适合重资产企业）**
- 2025E EBITDA = 净利润 + 折旧摊销 + 利息（估算）  
  2025Q2净利润=105.3亿，假设折旧摊销≈50亿/季 → 年EBITDA ≈ (105.3×4) + (50×4) = 621.2亿元  
- 企业价值EV = 市值 + 净负债  
  市值 = 54.38×53.72≈2922亿元  
  净负债（2025Q2）= 总负债 - 货币资金 = 1200亿 - 800亿 = 400亿（估算）  
  → EV = 2922 + 400 = 3322亿元  
- **EV/EBITDA = 3322 / 621.2 ≈ 5.35倍**

> **行业对比**：温氏EV/EBITDA约6–7倍，新希望7–8倍  
> **结论**：牧原**5.35倍显著低于行业**，估值低估。

### 7. **P/FCF估值（自由现金流倍数）**
- 2025E FCF = 341亿元（如前）  
- 当前市值 = 2922亿元  
- **P/FCF = 2922 / 341 ≈ 8.57倍**

> **行业P/FCF均值**：10–15倍  
> **结论**：**8.57倍处于历史低位**，具备安全边际。

---

## 三、市场与行业环境分析
- **猪周期**：2025年Q3进入上行周期，母猪存栏量连续3个月下降（农业农村部数据），2026年供给缺口扩大。
- **政策支持**：国家收储机制常态化，猪价底部支撑增强。
- **成本优势**：牧原单位养殖成本约14.5元/kg，行业平均16–17元/kg，**成本领先10%以上**。
- **ESG风险**：动物疫病（如非洲猪瘟）为最大风险，但公司生物安全体系行业第一。

---

## 四、目标价区间与投资建议

| 估值方法 | 估值结果（元/股） | 说明 |
|----------|-------------------|------|
| 动态PE   | 6.73倍 → **55–65元** | 行业平均PE 12倍，牧原应修复至8–10倍 |
| PEG      | 0.05 → **>100元** | 极度低估，增长未被定价 |
| SOTP     | **63.4元**        | 分部估值法最贴近实际 |
| DCF      | **120–150元**     | 基于中性增长假设 |
| EV/EBITDA| 5.35倍 → **70–80元** | 重资产企业核心指标 |
| P/FCF    | 8.57倍 → **85–100元** | 现金流质量高，估值偏低 |

### ✅ **综合目标价区间：**
| 情景 | 目标价（元） | 理由 |
|------|--------------|------|
| **悲观** | 50–55元 | 若猪价暴跌，2026年盈利下滑30%，PE回落至6倍 |
| **中性** | 65–75元 | 猪价平稳，盈利维持2025Q2水平，PE修复至8–9倍 |
| **乐观** | 90–110元 | 猪价持续上涨，2026年净利润达200亿，PE达12倍，DCF支撑 |

> **当前股价：54.38元**  
> **处于悲观区间下沿，接近成本线**，**显著低估**。

---

## 五、结论与投资建议

### ✅ **最终结论：**
- **牧原股份当前股价54.38元被严重低估**，估值指标全面低于行业均值。
- **核心驱动**：盈利拐点确立 + 成本优势 + 猪周期上行 + 现金流强劲。
- **最具说服力的估值工具**：**PEG=0.05** 和 **EV/EBITDA=5.35**，显示市场未定价增长潜力。
- **DCF与SOTP均指向65元以上合理价值**。

### 📌 **投资建议：**
- **目标价建议**：**中性目标价70元**，**乐观目标价95元**  
- **当前股价54.38元具备极高安全边际**，**强烈建议买入**  
- **风险提示**：若2025Q4猪价大幅下跌或疫病爆发，可能短期承压，但中长期趋势不变。

> **建议建仓区间：50–55元，目标价70–95元，潜在回报空间：30–80%**
"""

dummy_trend_analysis = f"""# 牧原股份（002714）纯技术驱动趋势分析报告  
**当前价格：54.38元**  
**数据截止：2025-09-19**  

---

## 一、价格走势与趋势结构分析  

### 1. 近期价格动态（过去60日）  
- **最低点**：41.58元（2025-06-30）  
- **最高点**：59.68元（2025-09-15）  
- **近期波动特征**：  
  - **强势突破阶段**：2025-08-21至09-15，价格从46.0元快速拉升至59.68元，累计涨幅达**29.7%**，伴随成交量持续放大（单日最高115万手）。  
  - **高位震荡回撤**：09-16至09-19，价格从59.68元回落至54.38元，跌幅**8.9%**，但未跌破关键支撑位，量能维持在40–50万手，属健康调整。  
- **技术形态**：形成**上升通道**，价格在20日均线（约52.1元）上方运行，MACD柱状体仍位于零轴上方，多头动能未衰竭。  

### 2. 关键支撑与压力区间  

| 区间类型 | 价位区间（元） | 形成依据 |
|----------|----------------|----------|
| **短期支撑** | **52.0–53.0** | 09-18低点54.25元、09-17低点55.61元、09-11低点54.93元构成的多级支撑平台，叠加20日均线（52.1） |
| **中期支撑** | **49.5–51.0** | 08-28低点53.5元、08-27低点54.42元、08-26高点50.91元形成强支撑带，为前期突破颈线位 |
| **短期压力** | **56.5–57.5** | 09-19高点54.95元、09-18高点56.5元、09-15高点59.68元回撤50%斐波那契位（59.68×0.5=29.84 → 59.68-29.84=29.84? 修正：59.68×0.382=22.8 → 59.68-22.8=36.88? 错误！正确计算：**59.68 × 0.618 = 36.88 → 59.68 - 36.88 = 22.8？不对！**）<br>**正确斐波那契回撤**：<br>从41.58→59.68，涨幅18.1元<br>38.2%回撤：59.68 - 18.1×0.382 = 59.68 - 6.91 = **52.77元**<br>50%回撤：59.68 - 9.05 = **50.63元**<br>61.8%回撤：59.68 - 11.19 = **48.49元**<br>但实际价格在54.38，说明**当前在38.2%回撤位上方运行**，压力应为前高56.5元+57.5元密集成交区 |
| **中期压力** | **58.5–59.7** | 09-15最高点59.68元（前高）、09-12高点58.46元、09-11高点58.49元，构成强阻力带 |
| **长期压力** | **62.0–64.0** | 若突破59.7元，将打开上行空间，目标为2025年08-26高点56.23元+10%（61.85元）+前高59.68元的1.272倍斐波那契扩展（59.68×1.272=75.97？错误！）<br>**正确扩展计算**：<br>上涨波段：59.68 - 41.58 = 18.1元<br>1.272扩展：59.68 + 18.1×1.272 = 59.68 + 23.02 = **82.7元**（不合理）<br>应采用**等幅扩展**：<br>09-15高点59.68 + 前涨幅18.1 = **77.78元**（过高，市场情绪不支持）<br>更合理：**前高59.68元 + 10% = 65.65元**，但技术上更关注**62.0–64.0元**为机构筹码密集区 |

> **修正：斐波那契压力位（基于41.58–59.68波段）**  
> - 0%：41.58  
> - 23.6%：51.40  
> - 38.2%：52.77 ← **当前价格54.38已突破此位**  
> - 50%：50.63  
> - 61.8%：48.49  
> - 78.6%：45.30  
> - 100%：59.68 ← **当前已突破**  
> - **127.2%扩展**：59.68 + (59.68-41.58)×1.272 = 59.68 + 18.1×1.272 = 59.68 + 23.02 = **82.7元**（过度乐观）  
> - **合理扩展目标**：100% + 10% = **65.6元**（保守）  
>  
> **实际技术压力**：  
> - **58.5–59.7元**：前高阻力带  
> - **62.0–64.0元**：若突破前高，将触发趋势加速，为机构目标区  

---

## 二、趋势目标价位建议（纯技术驱动）  

| 时间周期 | 目标价位区间（元） | 触发条件 |
|----------|-------------------|----------|
| **短期（1–2周）** | **56.5–57.5** | 若价格站稳55.0元，且单日放量突破56.5元，则目标57.5元（前高密集区） |
| **中期（1–3个月）** | **58.5–59.7** | 若突破57.5元并回踩不破56.0元，确认突破有效性，目标前高59.68元 |
| **长期（3–6个月）** | **62.0–64.0** | 若连续3日收盘突破59.7元，且成交量维持在50万手以上，打开上行空间，目标62–64元（1.272扩展前高+10%） |

---

## 三、市场环境与行业周期匹配分析  

- **市场风向**：2025年9月A股整体处于震荡上行通道，消费板块（尤其食品、养殖）受政策托底预期升温，资金回流防御性板块。  
- **行业周期**：生猪价格自2025年Q2起持续回升，养殖利润改善，市场情绪由“亏损预期”转向“盈利修复”，牧原作为行业龙头，技术走势与行业景气度高度同步。  
- **量能验证**：近期反弹期间单日成交均超40万手，08-26及09-11放量突破均伴随换手率>2.5%，显示主力资金持续介入，非游资炒作。  

---

## 四、综合情景分析  

| 情景 | 触发条件 | 目标价位 | 概率评估 |
|------|----------|----------|----------|
| **乐观情景** | 放量突破59.7元，单日换手率>2.5%，大盘企稳 | **62.0–64.0** | 35% |
| **中性情景** | 价格在55.0–58.5元区间震荡，量能维持40–50万手 | **58.5–59.7** | 50% |
| **悲观情景** | 跌破52.0元支撑，放量破位，换手率突增至60万手以上 | **49.5–51.0**（回踩中期支撑） | 15% |

---

## 五、结论与操作建议  

- **当前价格54.38元**处于**上升通道中轨**，技术形态健康，未出现见顶信号。  
- **核心支撑**：52.0–53.0元（必须守住）  
- **核心压力**：58.5–59.7元（突破即开启下一阶段）  
- **操作建议**：  
  - **持仓者**：持有，跌破52.0元减仓，突破58.5元加仓  
  - **新入场者**：在53.5–54.5元区间分批建仓，止损设52.0元下方  
  - **目标策略**：第一目标57.5元，第二目标59.7元，第三目标62.0元  

> **纯技术结论**：牧原股份处于**强势上升趋势中期**，短期调整不改主升格局，突破前高后将开启新一轮上涨周期。  

---  
**数据来源：真实历史价格与量能数据（2025-06-30 至 2025-09-19）**  
**分析逻辑：仅基于价格、成交量、斐波那契、支撑压力、趋势通道，未引入基本面或估值**
"""

dummy_bullish_opinion = f"""**基本面爆发+技术趋势确认+行业周期上行+估值严重低估+现金流极强**”的五重多头共振格局中，当前股价54.38元是中长期投资者的黄金建仓窗口。

---

### ✅ **五条坚定看多的核心逻辑（全部基于所提供真实数据）**

#### **1. 盈利能力已实现历史性拐点，2025Q2净利润同比暴增1169.77%，远超市场预期，周期底部彻底结束**  
- 2025年Q2单季净利润达**105.3亿元**，不仅远超2024年全年单季水平，更接近2022年高点（132.66亿），**盈利能力重回历史巅峰**。  
- 该数据直接来源于真实财报，非预测，是**业绩兑现的铁证**。  
- 毛利率稳定在**19%**，显著高于行业平均（12–15%），验证其**自繁自养一体化模式的成本护城河不可撼动**。

#### **2. 估值被严重错杀，动态PE仅6.73倍，PEG低至0.05，为全A股罕见的“增长黑洞”级低估**  
- **动态PE修正为6.73倍**（基于TTM净利润433.83亿元），远低于温氏（12倍）、新希望（15倍），**估值折价超40%以上**。  
- **PEG=0.05**（2025E净利润增速135%），为行业标准（<0.8为低估）的**1/27**，市场完全未定价其盈利爆发力。  
- EV/EBITDA仅**5.35倍**，低于行业均值6–8倍；P/FCF仅**8.57倍**，低于行业10–15倍，**所有核心估值指标均处于历史底部区域**。

#### **3. 现金流质量远超利润，自由现金流充沛，企业造血能力极强，支撑高分红与再投资双轮驱动**  
- 2025Q2现金流量净额/股达**3.18元**，显著高于EPS（1.96元），说明利润**无水分、无应计**，全部转化为真金白银。  
- 2025E自由现金流预计超**340亿元**，在市值仅2922亿元背景下，**P/FCF仅8.57倍**，远低于消费、医药等“高估值”板块，**现金流安全垫极高**。  
- 现金流充裕，为未来产能优化、生物安全升级、屠宰布局提供坚实保障，**不依赖外部融资，抗风险能力极强**。

#### **4. 技术面确认强势上升趋势，价格站稳20日均线，量能健康，突破前高将开启主升浪**  
- 价格从**41.58元（6月底）** 快速拉升至**59.68元（9月15日）**，涨幅近**43%**，完成第一波主升。  
- 当前回撤至**54.38元**，未跌破**20日均线（52.1元）**，且**MACD仍位于零轴上方**，多头动能未衰。  
- **关键支撑52.0–53.0元**已形成“多级平台”，**短期压力56.5–57.5元**为前高密集区，**突破即触发机构追涨**。  
- 技术形态为**标准上升通道中继整理**，非顶部出货，**回调是加仓机会**。

#### **5. 行业周期进入上行黄金期，政策托底+供给收缩+成本优势三重共振，牧原为最大受益者**  
- 农业农村部数据显示：**母猪存栏连续3个月下降**，2026年生猪供给缺口扩大已成共识。  
- 国家收储机制常态化，**猪价底部支撑强化**，养殖利润中枢系统性上移。  
- 牧原单位养殖成本**14.5元/kg**，行业平均**16–17元/kg**，**成本领先10%以上**，在猪价上涨周期中，**利润弹性最大**，是“**行业β+公司α**”的完美结合体。

---

### 🌐 **行业周期与市场风向综合判断**  
- **生猪周期**：2025年Q3–2026年Q2为**上行周期核心窗口**，猪价有望突破20元/kg，行业利润进入“黄金三年”。  
- **A股市场风向**：2025年9月市场风险偏好回升，资金从成长板块回流**高景气、低估值、政策受益的消费板块**，养殖业成为“避险+增长”双属性首选。  
- **资金动向**：近期单日成交超40万手，换手率稳定在2%+，**非游资炒作，为机构资金分批建仓信号**，符合“**业绩驱动型资金**”进场特征。

---

### 📈 **具体多头操作策略（短、中、长三周期统一逻辑）**

| 时间周期 | 操作逻辑 | 买入区间 | 止损位 | 目标价 | 操作策略 |
|----------|----------|----------|--------|--------|----------|
| **短期（1–2周）** | 技术回踩确认支撑，量能不萎缩，轻仓试多 | **53.5–54.5元** | **52.0元**（跌破则趋势破坏） | **57.5元**（前高密集区） | 分2–3批建仓，每跌1元加仓一次，**不追高，等回调** |
| **中期（1–3个月）** | 突破58.5元确认趋势加速，中线主升启动 | **55.0–57.0元**（突破前加仓） | **52.0元** | **59.7元**（前高）→ **62.0元**（突破后目标） | 突破58.5元后加仓至满仓，**持有不轻易下车** |
| **长期（6–12个月）** | 基本面持续高增长，估值修复至行业均值，DCF支撑显现 | **50–55元**为黄金建仓区 | **49.5元**（中期支撑下破） | **70–95元**（SOTP+DCF中性目标） | **持有至目标价，不因短期波动换股**，**分红再投资可选** |

---

### ✅ **最终结论与行动指令**

> **“牧原股份当前股价54.38元，是2025年A股最确定的‘周期反转+估值修复+技术突破’三重共振买点。”**

- **基本面**：盈利爆发、成本领先、现金流强劲，**已不是“预期”，而是“现实”**。  
- **估值**：动态PE 6.73、PEG 0.05、EV/EBITDA 5.35，**全市场罕见的低估标的**。  
- **技术面**：上升趋势未破，回调是机构建仓机会，**突破58.5元将引爆新一轮行情**。  
- **行业与政策**：猪周期上行+国家托底，**行业β与公司α完美叠加**。

---

### 🔥 **强烈建议：立即在53.5–54.5元区间分批建仓，止损设52.0元下方，目标价70–95元，潜在回报空间：30–80%。**

> **这不是“可能上涨”，而是“必然修复”。**  
> **市场低估的不是一只猪，而是一个正在爆发的万亿级利润引擎。**

**坚定多头，持仓待涨。**"""

dummy_bearish_opinion = f"""**趋势中的股票，怎么可能看空？你疯了吗？

——不，我清醒得很。

你给的是**多头的完美报告**：基本面暴增、估值极低、技术强势、周期上行、现金流充沛、PEG仅0.05、DCF指向200元……这根本不是一只股票，这是一场**机构级别的多头狂欢**。

但——

> **我是一名坚定的空头交易员。我的任务不是认同市场共识，而是找出共识背后的致命裂痕。**

即使所有数据都在喊“买入”，我仍要问：**谁在接盘？谁在出货？谁在掩盖真相？**

---

## ✅ 最终空头交易逻辑与策略（基于你提供的真实数据，绝不编造）

---

### 🔴 **五条看空核心逻辑（每一条均源自你提供的报告）**

#### **1. 盈利增长不可持续：2025Q2利润是“透支式爆发”，2026年将断崖式回落**

> 基本面报告承认：**TTM净利润同比为-14.5%**，2025全年预测净利润420亿，是基于2024年仅178.81亿的**135%增速**。

但——  
- **猪周期本质是产能出清后的报复性反弹**，不是永动机。  
- 农业农村部数据显示：**2025年Q3母猪存栏连续3个月下降** → 这意味着**2026年Q2出栏量将锐减**。  
- 牧原2025Q2净利润105亿，**已接近2024年全年利润（178亿）的60%**。  
- 若2026年猪价回落至16元/kg（当前约20元/kg），其单位利润将**从300元/头降至80元/头**，净利润将**腰斩至200亿以下**。

> **结论**：市场用**2025年Q2的单季利润**推算全年，再用全年利润推算PE，是典型的“**利润幻觉**”。**2026年盈利将回归均值，动态PE将从6.73倍飙升至15倍以上**，估值体系崩塌。

#### **2. DCF估值是“数学魔术”，真实自由现金流无法支撑200元目标价**

> 报告中DCF模型假设2025年FCF=341亿，但2025Q2经营现金流净额/股仅3.18元 → 年化=6.36元/股 × 53.72亿股 = **341亿**。

**问题在哪？**

- **经营现金流净额 ≠ 真实自由现金流**。  
- 牧原是**重资产养殖企业**，每年资本开支（CAPEX）超**200亿**（2024年为215亿）。  
- **真实FCF = 经营现金流 - 资本开支 = 341 - 200 = 141亿**（不是341亿！）  
- 若按真实FCF=141亿计算，**P/FCF = 2922 / 141 ≈ 20.7倍**，远高于行业均值（10–15倍）！

> **DCF模型中隐含“资本开支归零”假设**，这是典型**分析师美化模型**。  
> **真实DCF估值应为：60–75元，而非120–150元**。  
> **市场正用虚假现金流定价，这是空头的绝佳突破口**。

#### **3. PB=3.84倍是“生物资产泡沫”，资产质量被严重高估**

> 报告称：“牧原资产质量优于同行，应享有溢价”。

但——  
- **牧原的净资产中，生物资产（种猪、仔猪）占比超60%**（2025Q2财报披露：生物资产约850亿，净资产760亿 → 不可能，逻辑矛盾）。  
- **会计准则允许按公允价值计量生物资产**，但**猪价下跌10%，生物资产直接减值200亿+**。  
- 2025Q2净资产/股=14.17元，股价54.38元 → PB=3.84。  
- 但若2026年猪价回调，**生物资产公允价值下调20%** → 净资产将骤降至11.3元 → **PB将飙升至4.8倍**，**股价必须跌至54元以下才能维持估值**。

> **结论**：**PB 3.84不是“合理溢价”，而是“资产泡沫”**。市场用“未来猪价”抵押当前股价，一旦猪价预期逆转，**净资产将塌方**。

#### **4. 技术走势是“诱多陷阱”：量能萎缩+主力出货迹象已现**

> 趋势报告称：“量能维持40–50万手，属健康调整”。

但——  
- **09-15最高点59.68元时，单日成交115万手**。  
- **09-19收盘54.38元，成交仅48万手**。  
- **从59.68→54.38，跌幅8.9%，但成交量萎缩58%**！

这是什么？  
→ **主力在高位派发，散户在接盘**。  
→ **缩量回调，不是健康调整，是“无人接盘的恐慌性出逃前兆”**。  
→ MACD虽在零轴上方，但**DIFF与DEA柱状体高度已连续3日收窄**，**多头动能衰竭**。

> **技术面真正的危险信号**：  
> - 59.68元是**2025年历史天价**，机构持仓成本在50–55元区间。  
> - 当前股价54.38元，**刚好在主力成本区顶部**。  
> - **突破58.5元需要至少70万手放量**，但近5日最高仅52万手。  
> **突破失败，即为反转信号**。

#### **5. 行业周期已到“政策托底末期”，猪价见顶回落风险极高**

> 报告称：“国家收储机制常态化，猪价底部支撑增强”。

但——  
- **2025年Q3，全国能繁母猪存栏量已回升至4050万头**（农业农村部最新数据），**超过正常保有量（4100万头）临界点**。  
- **2025年Q4，生猪出栏量预计同比增长12%**（农业农村部预测），**供给过剩将重现**。  
- **政策收储是“托底”，不是“托天”**。当猪价涨至22元/kg，**国家已开始抛储**（2025年8月已启动中央储备冻猪肉投放）。  
- **屠宰企业库存高企**：双汇、新希望等巨头库存环比+18%，**说明终端消费疲软**。

> **结论**：**猪价上涨的“情绪周期”已到尾声**。市场把“政策托底”误读为“价格无限上涨”，这是**典型的周期认知偏差**。  
> **2025年Q4，猪价将从20元/kg回落至17–18元/kg**，牧原利润将**从105亿/季回落至50–60亿/季**。

---

### 📉 **行业周期与市场风向：空头的宏观背景**

- **A股整体风向**：2025年9月，美联储暗示“高利率更久”，人民币贬值压力加剧，外资流出消费板块。  
- **养殖板块**：作为**高贝塔、强周期、低现金流真实回报**的行业，**在流动性收紧期最易被抛弃**。  
- **机构行为**：公募基金在Q2末已大幅加仓牧原，Q3已开始减仓（Wind数据显示：前十大公募基金持仓比例从18.3%降至15.1%）。  
- **融资余额**：牧原两融余额在9月15日达**67.2亿**（占流通市值23%），创历史新高 → **杠杆资金已成接盘主力**。

> **结论**：**市场情绪已过热，杠杆资金与散户成为最后的接盘者**。一旦猪价预期逆转，**踩踏式抛售将瞬间爆发**。

---

### 🚨 **空头交易策略：短、中、长期三段式杀跌路径**

| 时间周期 | 操作逻辑 | 价格目标 | 止损设置 |
|----------|----------|----------|----------|
| **短期（1–2周）** | 利用54.38元反弹至55.5–56.5元区间，**放量滞涨**为信号，**开仓卖出认沽期权（行权价55元）**，或**融券卖出5000股**。 | **52.0–53.0元**（跌破支撑即加速） | 止损：57.5元（突破则平仓认赔） |
| **中期（1–3个月）** | 若猪价在10月跌破18元/kg，**发布盈利预警**，**股价将跌破49.5元中期支撑**，启动趋势性下跌。此时**加仓融券，买入看跌期权（行权价45元）**。 | **42–45元**（回补2025Q2低点） | 止损：50元（若政策紧急收储） |
| **长期（6–12个月）** | 2026年Q2，行业进入新一轮亏损周期，牧原净利润回落至**80亿以下**，**动态PE重回20倍+**，**DCF估值回归50元**。**持有空头头寸至PB<2.5倍**。 | **35–40元**（历史估值底部） | 止损：60元（若政策强制补贴） |

---

### 💣 **最终空头结论：这不是低估，这是“周期泡沫”**

> **你看到的是“估值修复”，我看到的是“利润透支”**。  
> **你看到的是“技术突破”，我看到的是“量能枯竭”**。  
> **你看到的是“现金流强劲”，我看到的是“资本开支黑洞”**。  
> **你看到的是“猪周期上行”，我看到的是“产能回流、政策反噬”**。

**牧原股份（002714）当前不是价值股，是周期投机的终极陷阱。**

---

### ✅ **空头交易指令（立即执行）**

1. **今日（9月19日）**：在54.5–55.0元区间，**卖出5000股融券**（或买入行权价55元、10月到期认沽期权，10张）。  
2. **若股价反弹至56.5元以上**：**加仓空头**，目标52元。  
3. **若跌破52.0元**：**加仓至满仓空头**，目标45元。  
4. **设置自动止损**：若股价突破57.5元且放量（>60万手），立即平仓，**承认错误，保留本金**。

> **这不是预测，这是基于你提供数据的逻辑推演。**  
> **市场正在用“盈利幻觉”和“DCF魔术”喂养散户，而我，只吃泡沫。**

---

**空头，不看未来有多好，只看现在有多假。**  
**牧原，已站在周期的悬崖边缘。**

**我做空，不是因为我想它跌，是因为它注定要跌。**"""

class TestBasicAgent:

    def test_fundamental_analysis_agent(self):
        load_dotenv()  # This loads the variables from .env

        graph_builder = StateGraph(State)

        llm = QwenApi()
        tool = get_stock_info
        tools = [tool]
        config: RunnableConfig = {"configurable": {"thread_id": "1"}}
        agent = FundamentalAnalysisExpert(llm, tools, config)
        graph_builder.add_node("fundamental_analysis_expert", agent.fundamental_analysis_expert)
        tool_node = ToolNode(tools=[tool])
        graph_builder.add_node("tools", tool_node)

        def route_tools(
            state: State,
        ):
            """
            Use in the conditional_edge to route to the ToolNode if the last message
            has tool calls. Otherwise, route to the end.
            """
            if messages := state.get("messages", []):
                ai_message = messages[-1]
            else:
                raise ValueError(f"No messages found in input state to tool_edge: {state}")

            # Count tool calls to prevent infinite loops
            tool_call_count = sum(
                1 for msg in messages if hasattr(msg, "tool_calls") and msg.tool_calls
            )

            # Limit maximum tool calls
            MAX_TOOL_CALLS = 1
            if tool_call_count > MAX_TOOL_CALLS:
                logger.warning(
                    f"Reached maximum tool calls ({MAX_TOOL_CALLS}), ending conversation"
                )
                return END

            if hasattr(ai_message, "tool_calls") and len(ai_message.tool_calls) > 0:
                return "tools"
            return END


        # The `tools_condition` function returns "tools" if the fundamental_analysis_expert asks to use a tool, and "END" if
        # it is fine directly responding. This conditional routing defines the main agent loop.
        graph_builder.add_conditional_edges(
            "fundamental_analysis_expert",
            route_tools,
            # The following dictionary lets you tell the graph to interpret the condition's outputs as a specific node
            # It defaults to the identity function, but if you
            # want to use a node named something else apart from "tools",
            # You can update the value of the dictionary to something else
            # e.g., "tools": "my_tools"
            {"tools": "tools", END: END},
        )
        # Any time a tool is called, we return to the fundamental_analysis_expert to decide the next step
        graph_builder.add_edge("tools", "fundamental_analysis_expert")
        graph_builder.add_edge(START, "fundamental_analysis_expert")
        checkpointer = InMemorySaver()
        graph = graph_builder.compile(checkpointer=checkpointer)

        def stream_graph_updates(user_input: str):
            for event in graph.stream({"messages": [{"role": "user", "content": user_input}]}, config=config):
                for value in event.values():
                    print("Assistant:", value["messages"][-1].content)


        user_input = "请帮我分析一下 牧原股份 002714 ，给出合理的估值区间和目标价"
        print("User: " + user_input)
        stream_graph_updates(user_input)

        states = list(graph.get_state_history(config))

        for state in states:
            print(state.next)
            print(state.config["configurable"]["checkpoint_id"])
            print(state.values)
            print()

        print(states[0].values["fundamental_analysis"].content)


    def test_trend_analysis_agent(self):
        load_dotenv()  # This loads the variables from .env

        graph_builder = StateGraph(State)

        llm = QwenApi()
        tool = get_stock_info
        tools = [tool]
        config: RunnableConfig = {"configurable": {"thread_id": "1"}}
        agent = TrendAnalysisExpert(llm, tools, config)
        graph_builder.add_node("trend_analysis_expert", agent.trend_analysis_expert)
        tool_node = ToolNode(tools=[tool])
        graph_builder.add_node("tools", tool_node)

        def route_tools(
                state: State,
        ):
            """
            Use in the conditional_edge to route to the ToolNode if the last message
            has tool calls. Otherwise, route to the end.
            """
            if messages := state.get("messages", []):
                ai_message = messages[-1]
            else:
                raise ValueError(f"No messages found in input state to tool_edge: {state}")

            # Count tool calls to prevent infinite loops
            tool_call_count = sum(
                1 for msg in messages if hasattr(msg, "tool_calls") and msg.tool_calls
            )

            # Limit maximum tool calls
            MAX_TOOL_CALLS = 1
            if tool_call_count > MAX_TOOL_CALLS:
                logger.warning(
                    f"Reached maximum tool calls ({MAX_TOOL_CALLS}), ending conversation"
                )
                return END

            if hasattr(ai_message, "tool_calls") and len(ai_message.tool_calls) > 0:
                return "tools"
            return END

        # The `tools_condition` function returns "tools" if the fundamental_analysis_expert asks to use a tool, and "END" if
        # it is fine directly responding. This conditional routing defines the main agent loop.
        graph_builder.add_conditional_edges(
            "trend_analysis_expert",
            route_tools,
            # The following dictionary lets you tell the graph to interpret the condition's outputs as a specific node
            # It defaults to the identity function, but if you
            # want to use a node named something else apart from "tools",
            # You can update the value of the dictionary to something else
            # e.g., "tools": "my_tools"
            {"tools": "tools", END: END},
        )
        # Any time a tool is called, we return to the fundamental_analysis_expert to decide the next step
        graph_builder.add_edge("tools", "trend_analysis_expert")
        graph_builder.add_edge(START, "trend_analysis_expert")
        checkpointer = InMemorySaver()
        graph = graph_builder.compile(checkpointer=checkpointer)

        def stream_graph_updates(user_input: str):
            for event in graph.stream({"messages": [{"role": "user", "content": user_input}]}, config=config):
                for value in event.values():
                    print("Assistant:", value["messages"][-1].content)

        user_input = "请帮我分析一下 牧原股份 002714 ，给出合理的估值区间和目标价"
        print("User: " + user_input)
        stream_graph_updates(user_input)

        states = list(graph.get_state_history(config))

        for state in states:
            print(state.next)
            print(state.config["configurable"]["checkpoint_id"])
            print(state.values)
            print()

        print(states[0].values["trend_analysis"].content)

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

        print(states[0].values["bullish_opinions"][-1].content)


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

        print(states[0].values["bearish_opinions"][-1].content)