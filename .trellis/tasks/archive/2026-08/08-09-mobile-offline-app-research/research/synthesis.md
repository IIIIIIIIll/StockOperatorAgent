# 综合结论（交叉验证 Q2/Q3/Q4）

**查询**：手机本地 App（无单独后端、云端 LLM、无端侧模型）可行性综合判断
**日期**：2026-08-09

## 核心结论

**只有两条真实可行的路线，中间路线（Chaquopy 系）被 Q2 实证推翻：**

| 路线 | 平台 | 工作量 | 复用率 | 形态 |
|---|---|---|---|---|
| **Termux 全栈**（现有 Python 栈原样跑） | 仅 Android | **1–3 天** | ~100% | F-Droid 装 Termux + bootstrap 脚本 + 包装 App（RUN_COMMAND intent + WebView） |
| **Flutter 全重写**（业务逻辑 Dart 化） | **双平台** | **6–12+ 周** | ~0%（仅提示词/模板平移） | 干净 APK/IPA，可上架 |

## 交叉验证：Chaquopy 系（Q4 的 A2/A3/C）为什么不可行

- Q4 建议 A3（Chaquopy + 原生 UI）"业务栈复用 ~100%"，但 Q2 逐依赖实证：
  **pydantic-core（Rust，pydantic 2 硬依赖）在 Chaquopy 无 recipe，社区多次尝试失败**
  （chaquopy#995/#1063/#1326、pydantic-core#1607，pyo3 符号缺失），而
  langgraph 1.x / langchain-core 1.x **硬性要求 pydantic>=2** →
  **投资委员会层（langgraph/langchain/openai 整条链）在 Chaquopy 上不可运行**。
- 连带：openai SDK 也依赖 pydantic；streamlit 依赖 pyarrow（无 recipe）→ A2 全灭。
- Chaquopy 只剩"数据层子集"（pytdx + ZODB + pandas + 原生 UI）——但委员会逻辑
  必须重写，那就不再是"复用"，而是接近 Flutter 重写的工作量。
- **修正后的现实**：Chaquopy 路线能省下的只有数据层，省不下最有价值的委员会层。

## 各平台的诚实结论

- **Android**：Termux 是唯一"整栈 Python 复用"通道（含 streamlit，Q2 有逐依赖
  矩阵 + TUR 预编译 pydantic-core/tiktoken 实证）；代价是发行形态糙（F-Droid +
  一次性 bootstrap + 授权 RUN_COMMAND/关电池优化）、Android 12+ 会杀后台进程
  （termux-app#5150）、上不了架。想要"正经安装 App"只有 Flutter 重写。
- **iOS**：Python 重栈 2026 年仍无通道（a-Shell 纯 Python pip / Pyto 无
  pydantic-core / BeeWare 缺全部关键 native wheel）→ **只有 Flutter 重写一条路**。
- 平台决策是最大分叉：**Android-only → Termux 路线 1-3 天可尝鲜**；
  **含 iOS → 直接规划 Flutter 重写**。

## 离线数据（Q3，与路线正交）

- 除实时类（snapshot/MCP/亿信/搜索）外全部可预取离线；全市场 ~1-1.2 GB、
  100 只自选 ~15-20 MB、日增量 ~0.3-4 MB。
- **ZODB 写放大 34x 实测**（324 MB 库 / ~9.7 MB 对象）→ 全市场不可行，
  自选股规模可直接搬 `.fs`；移动端默认 SQLite。
- 需新写最集中的一点：**离线主闸**短路 DataAcquisition 网络抓取 + 快照日期
  透出 UI/prompt + 同步管理器。
- 交易日判定用数据驱动的 `latest_trading_day(stock)`（零网络、精确），
  不用 `get_last_business_day`（无节假日日历）。
- **边界（决策点）**：云端 LLM ⇒ 生成新分析必须联网；"断网"只能 =
  查看上次同步快照与缓存报告。

## 决策依赖（需用户确认）

1. **手机平台**（Android-only 还是含 iOS）——决定走 Termux 还是 Flutter。
2. **"断网"语义**：是"不依赖家庭/局域网服务，手机+蜂窝网随时分析"
   （云端 LLM 满足），还是"无互联网也能打开看已同步的数据"
   （需接受"离线只能看快照"）？
3. 若走 Termux：能否接受"装 F-Droid Termux + 跑一次脚本"的初始安装摩擦？
