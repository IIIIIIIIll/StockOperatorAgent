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

        print(states[0].values["final_decision"].content)