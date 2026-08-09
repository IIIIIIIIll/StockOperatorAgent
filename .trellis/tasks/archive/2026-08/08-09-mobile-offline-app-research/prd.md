# 手机离线 App 可行性研究

## Goal

研究"把 StockOperatorAgent 做成**安装到手机、完全断网可用**的本地 App"的
技术可行性，产出：可行路径（可能多条）+ 每条路径的技术栈、工作量量级、
质量损失、关键风险，供后续决策是否立项、选哪条路。

## 背景与硬约束

- 当前应用是 Python + Streamlit Web 应用：LangGraph 6-agent 委员会、
  DeepSeek 云端 LLM（默认 deepseek-v4-flash）、TDX/pytdx 实时行情 +
  akshare 备用、ZODB 文件存储、亿信可选情报。
- 用户目标形态：**手机上安装的 App（点图标打开），应用本体在手机本地
  执行，没有单独后端**（不依赖家里电脑跑服务、不依赖云服务器）。
- **LLM 用云端 API，不要端侧模型**（2026-08-09 用户修正）——分析推理
  走 DeepSeek 等云端，手机不跑本地 LLM。
- 数据与分析的"本地"边界：数据获取/存储/分析流程在手机本地跑；云端
  仅限 LLM 推理调用。
- 断网语义（待研究后与用户确认的决策点）：云端 LLM 意味着**分析需要
  网络**；离线能力 = 预取数据快照 + 缓存报告查看，而非离线生成新分析。
- 用户手机平台：**未确认**（iOS / Android 都需覆盖，结论中给出平台差异）。

## 关键可行性问题（研究必须回答）

### Q1: 端侧 LLM 能力
- 手机上跑本地 LLM 的现实：可选模型（Qwen3 / Llama / Phi / DeepSeek
  蒸馏版等）、量化档位、内存占用、速度（tokens/s）、手机硬件门槛
  （iPhone 与主流 Android 各档）。
- **函数调用 / tool calling 支持**：本地上小模型的工具调用可靠性——
  当前流程重度依赖 bind_tools（web_search + 亿信三件套 + 对抗修订）。
- 质量落差：deepseek-v4-flash（云端）→ 端侧小模型的金融分析质量损失，
  是否仍满足"多智能体报告"的产品价值。
- 框架对比：llama.cpp / Ollama / MLX（iOS）/ MLC-LLM / ExecuTorch，
  以及 Flutter 侧绑定（flutter_llama_cpp / llama.rn 等）成熟度。

### Q2: 现有 Python 栈能否上手机
- Android：Termux（完整 Linux 环境跑 Python 全栈）vs Chaquopy
  （Python 嵌入 Android App）。现有依赖（pytdx / akshare / langgraph /
  langchain / ZODB / pandas / numpy / streamlit）各自在两条路径下的
  可用性、已知坑（编译、ABI、纯 Python vs C 扩展）。
- iOS：BeeWare / PythonKit / Pyto 等——重依赖栈是否有任何可行通道。
- 结论给到"复用现有代码量占比"的估计。

### Q3: 离线数据从哪来
- TDX/akshare 都是联网源：离线意味着**预取**。需要哪些数据
  （历史日K、个股概览、业绩报告）、单股体量、全市场体量（A 股 5000+ 只）。
- 同步策略：联网时按需/批量下载 → 离线分析；同步窗口、增量更新、过期语义
  （现有 freshness 门概念能否复用）。
- 移动端存储：ZODB 能否用（纯 Python + 文件存储，iOS 沙盒/Android
  应用目录可行性）vs 换 SQLite/duckdb。
- 离线时的降级：实时行情/亿信情报/网络搜索不可用的占位语义
  （现有开关与降级路径已很成熟，可复用多少）。

### Q4: App 形态与工作总量
- 候选架构（至少列出并对比）：
  - A. 手机全栈本地跑（Termux 或 Chaquopy 跑现有 Python + 端侧 LLM）
  - B. Flutter/Dart 重写业务逻辑 + 端侧 LLM（零 Python）
  - C. 混合：App 壳（Flutter）+ 内嵌 Python 引擎 + 端侧 LLM
- 每条路径：新写代码量、复用代码量、维护成本、APK/IPA 体积、
  上架与签名要求、风险点。
- "完全断网"与"联网时预取数据"边界的诚实表述：股票分析本质需要数据，
  离线 = 用上次同步的快照分析，需明确这一语义是否被用户接受。

## Research Artifacts（产出物）

- `.trellis/tasks/08-09-mobile-offline-app-research/research/*.md`
  （每个 Q 一个文件，含来源链接、版本号、具体命令/示例）

## Acceptance Criteria

- [x] Q2 Python 栈上手机有结论：Termux/Chaquopy/iOS 三路逐依赖可用性，
      附已知坑
- [x] Q3 离线数据方案有结论：数据清单/体量/同步策略/存储选择/降级语义
- [x] Q4 给出 ≥2 条候选架构的对比表（工作量/复用率/体积/风险），
      并给出推荐与理由
- [x] 交叉验证 Q2 vs Q4（Chaquopy 系的 pydantic-core 阻断）落盘
      research/synthesis.md
- [x] 产出物落盘 research/ 目录，不留在聊天里

（Q1 端侧 LLM 已随 2026-08-09 用户修正作废：LLM 走云端 API，不研究端侧模型。）

## Notes

- 本任务只做研究，不做实现；研究结论可能引出新的实现任务（父/子任务树）。
- 手机平台未确认——研究覆盖 iOS/Android 两平台，差异写清楚；
  最终平台决策留待研究后与用户确认。

## 结论与决策（2026-08-09）

- 研究完成，产出落盘 `research/`：q2-python-on-mobile.md、
  q3-offline-data.md、q4-app-architecture.md、synthesis.md。
- **用户决策：移动端暂缓，保持现有 Streamlit Web 应用形态**。
  未来若重启移动端，直接读 `research/synthesis.md` 的综合结论：
  - Android 快速路线 = Termux 全栈（1-3 天，~100% 复用，发行糙）；
  - 双平台/正经 App = Flutter 全重写（6-12 周，~0% 复用）；
  - Chaquopy 系路线已被交叉验证推翻（pydantic-core 无 recipe，
    langgraph/langchain 硬依赖 pydantic>=2 → 委员会层不可运行）。
