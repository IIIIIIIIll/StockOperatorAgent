# Q4: App 形态与工作总量——手机本地 App（无单独后端）候选架构对比

**查询**：手机安装 App、应用本体本地执行、无单独后端、LLM 走云端 API（无端侧模型）的候选架构与工作量对比（2026-08-09 用户修正版：去掉了原 Q4 中的"端侧 LLM"假设，全部路径改为手机直连 DeepSeek API）。
**日期**：2026-08-09
**基线数据**（本地实测，`wc -l`）：

- 可复用 Python 基数：**首方代码 6,552 行**（agents 568 + core 3,841 + data_source 首方 1,306 + data_structure 234 + data_storage 104 + utils 499），另有 vendored 第三方 `data_source/chinese_mainland/tdx/vendor/` 4,219 行（移动端不需要，TDX MCP 脚本不在主路径）。
- core 3,841 行中 **core/ui/ 1,232 行是 Streamlit UI**（display/charts/data_markdown/theme），业务逻辑 2,609 行与 UI 解耦。
- 测试 10,890 行——B 路线重写时测试也要跟着重写。
- 关键解耦事实（对本任务极为有利）：`InvestmentCommittee.make_investment_decision(ticker)` 已是**无 UI 入口**（headless，返回 `graph.stream` 事件生成器）；`progress_updater` 全链路 None 容错（`core/llms/progress.py` 的 `safe_progress` 对 None 直接 return）；`core/role_registry.py` 明确不 import streamlit；`import akshare` 只存在于备用路径 `data_source/chinese_mainland/akshare/fetch_stcok_data.py`（47 行，主流程不调用）。
- C 扩展依赖面（移动端关键）：主路径直接 import 的 C 扩展**几乎为零**——lxml/pyarrow/zstandard/orjson/ormsgpack/watchdog/uuid_utils/cffi 在首方代码 0 引用；pytdx 纯 Python；openpyxl 仅 dead import。实际 C 扩展面 = pandas/numpy（pandas 带动）+ BTrees（ZODB 加速器，同包带纯 Python 回退）+ pillow/pyarrow（仅 Streamlit 带入）。
- LLM 调用：`langchain_openai.ChatOpenAI`，`base_url` 默认 `https://api.deepseek.com`，可 `DEEPSEEK_BASE_URL` 覆盖（现部署已切 OpenCode Zen 网关 `https://opencode.ai/zen/go/v1`，OpenAI 兼容）。

---

## Findings

### 0. 先修正一个前提：网络依赖分解（研究点 6）

- **手机直连 DeepSeek API：可行，国内网络是常态场景。** DeepSeek 是国内公司，官方 API 在国内直连延迟常报 <200ms、典型 300–800ms 首字节；但大量公开案例存在间歇性超时/连接重置（DNS 污染、移动网络波动、服务端 429/5xx），标准缓解是**区分连接/读取超时 + 指数退避重试（500/502/503/504）**——openai SDK 内建 `max_retries`（默认 2），langchain-openai 继承，现有代码无需改动；SSE 流式在弱网下中断的概率高于家庭宽带，重试语义落在"整次分析重跑"（LangGraph 图节点级），可接受。第三方 OpenAI 兼容网关（OpenCode Zen，现部署已在用）是备选 base_url。**结论：LLM 云端化不构成手机路径的障碍。**
- **TDX/pytdx 从手机网络直连：可行但有不确定性。** pytdx 走 TCP 7709 连国内通达信行情服务器，常见坑是**服务器 IP 轮换**（内置 hosts.py 过期），需要多服务器 failover（pytdx `select_server` 或自维护列表）；运营商网络下向国内 IP 的 7709 出站 TCP 一般可用，但无公开强证据，个别服务器/时段可能受限，需真机验证。家庭宽带稳定性 > 运营商网络（NAT 空闲超时、信号切换会断 TCP）。akshare 备用路径走 HTTP（东财/新浪接口），手机网络没问题，但主路径不用它。
- **真离线语义**（决策点，非实现问题）：预取数据快照（ZODB 文件）可离线查看；新分析 = 云端 LLM，必须联网。

### 1. 候选架构 A：手机全栈跑现有 Python（两条子路线）

#### A1：Termux（Android，非打包）

- **形态**：用户在 F-Droid/GitHub 装 Termux（Play Store 版已废弃停更）→ `pkg install python ...` → 装依赖 → `streamlit run main.py`，手机浏览器/WebView 打开 localhost。
- **UI 方案 (a)：本地 Streamlit + WebView/浏览器** —— 可行。Streamlit 在 Termux 有成功先例（需 `libzmq`、`libarrow-cpp`、`MATHLIB=m`、`LDFLAGS=-lpython3.11` 等 env 补丁；有人报手机浏览器里 UI 显示不全的个例）。冷启动：裸 Streamlit 桌面 ~1s 初始化（GitHub issue #6066）、本地典型 3–4s；手机上 import pandas/numpy 即 1–2s，预估**手机冷启动 5–10s**（flash 速度主导，不确定区间 3–15s）。**Streamlit 官方不支持移动端**，移动端回归 bug 频发（iOS 26 Safari 渲染失败、Android st.chat_input 1.46.0 回归、file_uploader 安卓问题），但本项目 UI 只用 tabs/button/markdown/图表等基础组件，风险低于上述 bug 场景；WebView 内嵌（Chrome 内核）可避开 Safari 问题。
- **UI 方案 (b)：纯 API + 原生 UI** —— 逻辑上等价于 A3（见下），Termux 里跑一个自写 Flask/FastAPI 薄服务 + 原生 App 调 localhost。
- **发行形态**：无 APK、无法点图标打开、上不了架。用户侧安装成本高（Termux + 依赖源码编译 numpy/pandas 10–60 分钟）。**Android 12+ Phantom Process Killer 会在后台 SIGKILL Termux 进程**（即使 wake-lock + 关电池优化，termux-app issue #5150）——前台使用可接受，后台同步不可靠。
- **iOS：无解**（Termux 是 Android 专用）。
- **工作量**：新写 ~50–150 行（安装脚本/启动脚本），复用 ~100%。**1–3 天**。风险集中在发行与系统杀进程。

#### A2：Chaquopy 打包 APK + 内嵌 Streamlit + WebView

- **形态**：普通 APK，Gradle 插件（官方最新 **17.0.0，2025-12-01**；支持 Python 3.10–3.14，3.12+ 仅 64 位；AGP 7.3.x–9.2.x，minSdk 24）。Python 源码进 `src/main/python`，pip 依赖**构建期打包、无运行时 pip**。
- **UI 方案 (a)**：Kotlin WebView 加载 localhost:8501。**坑**：Android 9+ 默认禁明文 HTTP，WebView 对 localhost 也报 `ERR_CLEARTEXT_NOT_PERMITTED`——需 `network_security_config` 给 `localhost` + `127.0.0.1` 开 cleartext（两者不可互相替代，都要配；`usesCleartextTraffic` 与 networkSecurityConfig 二选一有优先级陷阱）。有 Google issue #397619883 实证。
- **依赖风险**：Chaquopy 对 numpy/pandas/scipy/matplotlib/pillow 有预配置补丁（OpenBLAS 交叉编译，构建服务器**首次构建数小时**）；Streamlit 会拖入 **pyarrow/pillow** 这两个重 C 包（pyarrow 构建极慢）——这是 A2 最大的工程痛。numpy/pandas 版本需对齐 Chaquopy 构建服务器支持的版本（现有 pin numpy==2.3.2/pandas==2.3.2 可能需降级，未验证）。
- **APK 体积**：解释器+stdlib **20–40MB**，numpy/pandas/pyarrow/pillow 再加数十 MB，**单 ABI 预估 80–150MB**（参考：Chaquopy issue #448 报 600MB→单 ABI 230MB→去 TF ~100MB；本项目无 TF，量级约 80–150MB，需实测）。
- **iOS：无解**（Chaquopy 仅 Android）。
- **工作量**：新写 ~300–500 行（Gradle 配置 + Kotlin WebView Activity + 程序化启动 streamlit + 脚本），复用 ~95%。**1–2 周**（大头是首次构建调试）。

#### A3：Chaquopy 打包 APK + 原生 UI（不跑 Streamlit）

- **形态**：同 A2 打包，但**丢弃 core/ui/（1,232 行）**，Kotlin/Compose 写原生 UI 调 `make_investment_decision`；`ProgressBridge` 本就是 queue 桥，可平移为"Python 入队 → 通道 → Kotlin 进度条"。
- **收益**：甩掉 streamlit 后 **pyarrow/pillow 不再进依赖树**，C 扩展面缩到 numpy/pandas/BTrees；APK 预估 **50–90MB（单 ABI）**；启动快（无 streamlit 服务层）。
- **工作量**：新写 Kotlin UI + JSON 胶水 ~800–2,000 行，复用业务栈 ~100%。**2–4 周**。
- **iOS：无解。**

### 2. 候选架构 B：Flutter/Dart 全重写（iOS/Android 唯一通吃路线）

- **Dart 侧 LLM 调用：成熟。** 官方链 `langchain` 0.8.1（2025-12-20）/`langchain_openai` 0.8.1+1（2025-12-27）活跃；其内部客户端 **openai_dart 8.0.0（2026-08-01 仍在发版）**，OpenAPI 生成、支持自定义 baseUrl/代理、全平台流式与 function calling（langchain_dart v0.0.14 发布说明明确弃用已停维护的 dart_openai）。DeepSeek 走 `base_url` 指向即可。
- **LangGraph 在 Dart：不成熟。** pub.dev 上 `langgraph`（Dart）仅 **0.0.1-dev.3（2025-10-15）**，dev 预发阶段——不能用于生产。但本项目图结构简单（投资委员会 8/9 节点、线性+条件边），Dart 手写状态机约 200–400 行可替代，风险可控。
- **数据层**：ZODB 无 Dart 实现 → 换 SQLite（drift/sqflite，成熟）或 Hive。pandas DataFrame 处理（复权/指标计算 `get_trend_indicators` 等）→ 手写 Dart 数学；`StockOutputFormatter` 中文格式化模板可平移。**TDX 协议无 Dart 客户端**——pytdx 是 Python 独有，Dart 侧要么按 pytdx 源码移植 TCP 客户端（~500–1,000 行，协议文档化程度低、维护重），要么改走东财/新浪 HTTP 公开接口（~500–800 行）。
- **工作量与复用**：业务 6,552 行 + 测试 10,890 行全部重写为 Dart/或按需重测；**新写 ~8,000–12,000+ 行 Dart**（含 UI），复用率 ~0%（仅概念/提示词/格式化模板平移）。**6–12+ 周（1–3 人月）**，且金融计算正确性要靠新测试兜底。APK ~20–40MB（无模型权重），iOS 同代码。风险：重写引入的计算/协议正确性回归、双平台测试矩阵。
- **结论**：跨平台（含 iOS）的**唯一**路线；若最终目标仅 Android，性价比低于 A3/C。

### 3. 候选架构 C：Flutter 壳 + Chaquopy 内嵌 Python 引擎

- **通信**：官方路径是 MethodChannel（Dart ↔ Kotlin）→ Chaquopy Python API（Kotlin 直接调 Python，PyObject）；数据过 JSON（DataFrame→JSON 丢类型，图表数据需显式序列化）。pub.dev 有 `flutter_python_bridge` 0.1.0（很新、个人项目），不建议依赖。FFI：Chaquopy 无公开 Dart FFI 通路，走 MethodChannel 是务实选择。**注意主线程**：Python 调用放后台线程/isolate，避免 ANR。
- **工作量**：Dart UI ~1,500–2,500 行 + Kotlin 桥 ~200–400 行 + Python 入口适配 ~150–300 行，业务栈复用 ~100%。**4–8 周**。
- **APK 体积**：Flutter ~20–30MB + Chaquopy 20–40MB + pandas/numpy ⇒ **单 ABI 预估 70–110MB**。
- **风险**：双语言调试（Python 栈报错在 Chaquopy 侧、UI 在 Dart 侧）、Chaquopy 构建管线、序列化边界；**iOS 无解**（Chaquopy 仅 Android）——iOS 若要覆盖，该平台只能退化为 B 的 Dart 逻辑（C+B 混合），即"Android 用 Python 内核、iOS 用 Dart 内核"的双栈维护，维护成本叠加。
- **结论**：与 A3 相比多一个 Flutter UI 层但业务栈不变；唯一多出来的价值是 UI 现代化与潜在 iOS 铺垫（但 iOS 内核仍需 Dart 重写，价值有限）。

### 4. 三架构对比表（工作量/复用率/体积/风险/平台）

| 维度 | A1 Termux（Android） | A2 Chaquopy+Streamlit+WebView（Android） | A3 Chaquopy+原生 UI（Android） | B Flutter 全重写（双平台） | C Flutter 壳+Chaquopy（Android 内核） |
|---|---|---|---|---|---|
| 新写代码 | ~50–150 行（脚本） | ~300–500 行 | ~800–2,000 行（Kotlin UI） | **8,000–12,000+ 行 Dart** | ~2,000–3,200 行（Dart+Kotlin+Python 适配） |
| 复用率 | ~100%（装环境） | ~95%（换入口+WebView） | ~100% 业务栈（弃 UI） | ~0%（提示词/模板平移） | ~100% 业务栈（新 UI+桥） |
| 工作量量级 | **1–3 天** | **1–2 周** | **2–4 周** | **6–12+ 周** | **4–8 周** |
| APK/IPA 体积 | 无 APK（发行靠 F-Droid+源码编译） | **~80–150MB**（单 ABI，含 pyarrow/pillow） | **~50–90MB**（单 ABI） | **~20–40MB**（双平台） | **~70–110MB**（单 ABI） |
| 核心风险 | 发行摩擦极高；Android 12+ 杀后台进程；无上架 | Chaquopy 首次构建数小时；pyarrow 构建重；版本 pin 需降级；iOS Safari 问题绕过但 UI 非移动原生 | Chaquopy 构建管线；原生 UI 重写 core/ui | 金融计算/协议正确性回归；TDX 协议无 Dart 客户端；测试全重写 | 双语言调试；序列化边界；iOS 无 Python 内核 |
| iOS | 无 | 无 | 无 | **有**（唯一通吃路线） | 无（iOS 需退化 B） |
| 上架 | 不可能（非 App） | 可上架（Play/侧载） | 可上架 | 可上架 | 可上架 |
| 离线查看预取快照 | 可 | 可 | 可 | 可 | 可 |
| 维护成本 | 低（零代码）但用户侧爆炸 | 中（依赖构建+版本锁） | 中 | **高**（双平台双测试） | 中高（双语言） |

**推荐（供主代理决策，非定论）**：

1. 若平台最终是 **Android-only**：**A3 性价比最高**（2–4 周、APK 真安装、业务 100% 复用、无 pyarrow 之痛）；要现代 UI 再升级 C。
2. 若平台含 **iOS**：**只有 B** 是完整路线（Python 无 iOS 通道，见下）；此时 A/B/C 不再互斥，而是"Android=A3/C 内核 + iOS=B 内核"的双栈，或干脆全量 B。
3. A2 基本无存在理由（比 A3 慢、大、构建更痛，仅省一个 Kotlin UI）。
4. A1 只适合"先快速验证"或自用尝鲜，不构成产品形态。

### 5. iOS vs Android 差异结论（研究点 5，附证据）

- **Android**：Termux（系统级 Linux 环境）与 Chaquopy（打包进 APK）两条 Python 通道都成立。
- **iOS：Python 重栈通道 2026 年仍不可行**，证据链：
  - Termux 仅 Android；Chaquopy 是 Android Gradle 插件（官方文档、GitHub 均无 iOS 产物）。
  - iOS 唯一的 Python 打包工具链是 BeeWare Briefcase + Python-Apple-support：**iOS 应用必须在 macOS 上交叉编译，且 C 扩展必须有预编译 iOS wheel**——否则 Briefcase 直接报"Cannot compile native modules"（beeware/briefcase issue #2230 实例）。
  - wheel 供给现状（2025 年进展，BeeWare 官方 Status Update）：PEP 730/738 使 Python 3.13 将 iOS/Android 列为 Tier 3、pip 24.3 支持 iOS 平台标签、PyPI 2025 年起接受 iOS wheel、Pillow 11.3.0 发布官方 iOS wheel、**NumPy 的 iOS 补丁 2025-07 接近合并但未发布**、**pandas/lxml/pyarrow/zstandard 等无 iOS wheel**——本项目栈的核心 C 包大部分仍要自己 xbuild/mobile-forge 交叉编译 + 代码签名，工程量大且脆弱。
  - 替代品：Pyto（App Store 独立解释器，不可嵌入自家 App）、PythonKit（需自嵌 CPython，同一交叉编译问题）。
- **结论：无端侧模型后 iOS 仍只有 Flutter 重写（B）一条路**；"iOS 用 Python 栈"的幻想可以排除，BeeWare 短期不可作生产依赖（除非上游 2026 年补齐 pandas 等 wheel——未证实，需盯 PyPI 平台标签）。

### 6. 补充事实（研究点 1/3 交叉）

- Streamlit 官方无移动端支持声明与大量移动回归 issue（#12205/#11891/#11722/#13326）——本项目组件基础、风险中低，且 WebView 可绕开 Safari。
- ZODB 上手机：纯 Python + BTrees（C 加速器可构建、同包含纯 Python 回退），单文件 .fs 落应用私有目录，无并发问题（单用户）；freshness/17:00 门与离线语义天然兼容；`InMemorySaver` checkpoint 本就不跨进程，无迁移成本。
- 预取数据体量（Q3 已另有研究文件，此处不展开）：单股日K+概览+业绩报告 KB 级，全 A 股 5000+ 只日K 约数百 MB 级——手机本地存储无压力。

## External References

- Chaquopy 官方 GitHub：https://github.com/chaquo/chaquopy （17.0.0, 2025-12-01；Python 3.10–3.14；AGP 7.3.x–9.2.x；minSdk 24；无 iOS）
- Chaquopy 文档（Android、Python 版本、ABI）：https://chaquo.com/chaquopy/doc/17.0/android.html
- Chaquopy APK 体积实证（600MB→单 ABI 230MB）：https://github.com/chaquo/chaquopy/issues/448
- Chaquopy 包配置（numpy/pandas/scipy 补丁，DeepWiki）：https://deepwiki.com/chaquo/chaquopy/6.1-package-configuration
- Termux 官方分发（F-Droid/GitHub，Play Store 已废弃）：https://f-droid.org/en/packages/com.termux/ ；https://github.com/termux/termux-app
- Termux 被 Android 12+ Phantom Process Killer 后台击杀（wake-lock 无效）：https://github.com/termux/termux-app/issues/5150
- Termux 数据科学栈安装指南（numpy 1.26.4 pin、源码编译）：https://github.com/termux/termux-packages/discussions/25247
- Streamlit 装进 Termux 的坑（libzmq/libarrow-cpp/MATHLIB）：https://discuss.streamlit.io/t/how-to-install-streamlit-in-termux/19303 ；https://github.com/termux/termux-packages/discussions/8036
- Streamlit 移动端回归 issue 集：https://github.com/streamlit/streamlit/issues/12205 、https://github.com/streamlit/streamlit/issues/11722 、https://github.com/streamlit/streamlit/issues/11891 、https://github.com/streamlit/streamlit/issues/13326
- Streamlit 启动时间（1s 初始化、pandas import 240ms）：https://github.com/streamlit/streamlit/issues/6066
- Android WebView localhost 明文 HTTP 被禁实证：https://issuetracker.google.com/issues/397619883 ；https://stackoverflow.com/questions/58505838/api-29-webview-neterr-cleartext-not-permitted
- langchain_dart v0.0.14 弃用 dart_openai → openai_dart（baseUrl/流式/function calling）：https://github.com/davidmigloz/langchain_dart/releases/tag/langchain-v0.0.14
- pub.dev 版本/日期实测：langchain 0.8.1（2025-12-20）、langchain_openai 0.8.1+1（2025-12-27）、openai_dart 8.0.0（2026-08-01）、langgraph (Dart) 0.0.1-dev.3（2025-10-15）：https://pub.dev/api/packages/langchain 等
- BeeWare 2025-07 状态更新（numpy iOS 补丁接近合并、Pillow 11.3 官方 iOS wheel）：https://beeware.org/news/buzz/2025/july-2025-status-update/ ；2025-04：https://beeware.org/news/buzz/2025/april-2025-status-update/
- Briefcase iOS 缺 wheel 报错实证：https://github.com/beeware/briefcase/issues/2230
- iOS wheel 交叉编译工具（xbuild/mobile-forge/meson-python）：https://github.com/beeware/xbuild ；https://deepwiki.com/beeware/Python-Apple-support/3.3-cross-compilation-support
- DeepSeek API 国内超时/重试实战：https://cloud.baidu.com/article/3714546 ；https://cloud.baidu.com/article/4788393 ；DeepSeek 域名分流（国内网络）：https://clashfaq.com/zh-CN/blog/articles/clash-deepseek-web-api-split-rules-2026.html
- pytdx 行情服务器 IP 轮换与更新方法：https://www.cnblogs.com/BeyondTechnology/p/18456471 ；https://blog.csdn.net/KongDong/article/details/127952215
- Flutter+Python 桥生态现状（flutter_python_bridge 0.1.0，个人项目）：https://pub.dev/packages/flutter_python_bridge

## Caveats

- **工作量/体积为量级估算**：APK 体积（A2/A3/C）无真机构建实测，参考 Chaquopy issue #448 与解释器 20–40MB 基准外推，误差 ±50%；A3 的 50–90MB 尤其依赖"去掉 streamlit 后 pyarrow/pillow 不被打包"这一推断（Chaquopy 只打包声明依赖，推断成立，但未实测）。
- **Chaquopy 对 numpy==2.3.2 / pandas==2.3.2 的支持未验证**：官方补丁矩阵按版本维护，可能需降级到 1.x/2.1.x 等构建服务器已覆盖的版本；降级对现有代码的影响（pandas API 兼容）未评估。
- **iOS 判断有 12 个月时效**：BeeWare/上游 2025 年在快速补 wheel（numpy 接近合并、cibuildwheel 支持 iOS），2026 年底 pandas/lxml 可能出 iOS wheel——届时 BeeWare 路线需重估；但"今天立项 iOS Python 栈"仍是高风险。
- **Termux 杀进程结论偏 Android 12+**：厂商（MIUI/ColorOS 等）杀后台更激进，真机差异大，未逐一验证。
- **TDX 从运营商网络直连为推断**：无公开权威数据，需真机验证（建议立项后先做"手机热点跑现有栈"的 30 分钟冒烟测试）。
- **Streamlit 冷启动 5–10s 为外推**：基于桌面 1s 初始化 + 手机 flash/CPU 差异，未在真机实测。
- **langgraph (Dart) 0.0.1-dev 的评估基于 pub.dev 版本号**，未深读其 API 完整性；即使可用也不建议生产依赖。
- 平台（iOS/Android）未确认是本对比表的最大假设——**推荐结论在平台确定前不锁死**。
