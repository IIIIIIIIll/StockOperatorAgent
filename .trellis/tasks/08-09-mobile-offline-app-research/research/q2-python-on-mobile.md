# Q2 研究：现有 Python 代码栈能否跑在手机本地（Termux / Chaquopy / iOS）

- 任务：`mobile-offline-app-research`（Q2）
- 日期：2026-08-09
- 查询方式：PyPI 元数据（JSON API）+ 各平台官方仓库/文档/GitHub issue + 本机实测 import 链（桌面 Python 3.13.5，与本仓库 requirements.txt 同版本环境）

## 栈基线（来自 requirements.txt + architecture.md）

Python 3.13 + Streamlit 1.61.1 + LangGraph 1.2.10 + langchain(-core 1.5.3, -openai 1.4.1, -community) + openai 2.52.0 + ZODB 6.0.1（FileStorage，.fs 文件）+ pytdx 1.72（主链路）+ akshare 1.18.81（备用路径）+ pandas/numpy 2.3.2 + lxml + curl_cffi + py-mini-racer/akracer + pyarrow + pydantic 2.11.7 + tornado 6.5.2 + dotenv/loguru。

**本机实测 import 链（关键证据，桌面 3.13 同版本环境测量）**：

| 实测导入 | 连带加载的原生模块 |
|---|---|
| `import langchain_core` + `langgraph` + `langchain_openai` | langsmith、orjson、zstandard、uuid_utils、xxhash、pydantic_core、tiktoken、requests、httpx（jiter/websockets 惰性，未在 import 时加载） |
| `import akshare` | py_mini_racer、curl_cffi、lxml、pandas（akracer 惰性） |
| `import ZODB.FileStorage` | BTrees、persistent、zope.interface、zodbpickle、transaction、zc.lockfile（zope.proxy/ZConfig 惰性） |
| `import streamlit` | pyarrow、starlette、pandas、numpy、protobuf（watchdog/tornado/httptools 惰性，服务启动时才加载） |

即：**LLM 层（langchain/langgraph/openai）在任何平台上实际依赖 pydantic-core、tiktoken、orjson、zstandard、uuid_utils、xxhash 这些原生扩展**；akshare 依赖 py_mini_racer（V8 引擎）。这不是理论推断，是实测。

---

## Findings

### 1. Android 路径 A：Termux —— 唯一可行通道（有条件）

**1.1 现状与版本**
- Termux 是官方维护的终端模拟器应用，内建完整 Linux 用户态（bionic libc 的 Android 原生环境，非虚拟机）。最低 Android 7.0（API 24）；完整包支持 Android 7+。需从 F-Droid 安装（Play 版已废弃）。
- 当前主仓 python 包为 **3.14.6-1**（2026-08-09 实测 termux 官方仓库）；3.13 阶段已过去。pip 安装 C 扩展包时，若无适配 wheel 会回退到源码编译（需要 clang/rust），这是 Termux 一贯模式。
- Python 3.13 时代（2025-2026 初）Termux 曾推动 pandas 支持 3.13（termux-packages#28857，2026-03 时 TUR 已提供 python-pandas 3.0.1-1）。**结论：Termux 的 Python 版本不落后，滞后的是"你 pin 的精确版本"是否被预编译**。

**1.2 关键依赖的可用安装路径（逐包实测仓库）**
- **TUR pypi-wheel-builder**（`--extra-index-url https://termux-user-repository.github.io/pypi/`）已预编译（2026-08-09 实测索引，28 个包）：**pydantic-core、numpy、pandas、lxml、tiktoken、cryptography、scipy、scikit-learn、polars、pillow** 等。其中 **pydantic-core 是 LLM 栈的命门，Termux 有 wheel，Chaquopy 没有**——这是两条路径的决定性差异。
- termux-main 主仓有：python-numpy 2.4.4、python-pandas（TUR 3.0.1）、python-lxml、**python-pyarrow 25.0.0**、python-pillow、python-scipy。
- 无预编译、需 pip 源码编译（Termux clang/rust/maturin 可行，体积小）：jiter（Rust）、orjson（Rust）、uuid_utils（Rust）、xxhash（C）、zstandard（C）、watchdog（小 C）、httptools（小 C）、curl_cffi（Rust，较重）。
- **py_mini_racer / akracer（V8 引擎）在 Termux 上无预编译、源码编译 V8 现实上不可行** → `pip install akshare` 无法完整安装。缓解：akshare 在本项目是**备用路径**（architecture.md 明确主流程不再调用）；可用 `pip install akshare --no-deps` + 手动装其余依赖绕过（akshare 的 py_mini_racer 在 `import akshare` 时即被加载，实测——但只要不 import akshare 即可；纯 TDX 主链路不需要它）。
- pytdx：**纯 Python、零依赖**（PyPI 元数据 requires_dist 为空，作者声明"无须引入 .dll/.so"）→ 任意平台 pip 直接装。

**1.3 嵌入与"用户无感"发行形态：不可嵌入，但可做"半无感"包装**
- Termux 是独立 App，**不能作为库嵌入别的 App**（无官方 SDK/库形态）。
- 替代机制（官方支持）：
  - **RUN_COMMAND intent**（`com.termux.RUN_COMMAND`，Termux ≥0.95）：别的 App 可发送 intent 让 Termux 在后台/前台执行任意命令（如启动 streamlit）。前置一次性设置：`~/.termux/termux.properties` 加 `allow-external-apps=true`、包装 App 声明并获授 `com.termux.permission.RUN_COMMAND`、Android 10+ 需"显示在其他应用上层"权限、关电池优化。→ **包装 APK + RUN_COMMAND 启动 + WebView 指向 http://127.0.0.1:8501** 是最接近"普通 App 体验"的形态。
  - **Termux:Widget**：桌面一键快捷方式，`~/.shortcuts/tasks/` 下的脚本后台运行（不弹终端）。冷启动有已知问题（需先开过一次 Termux + 关电池优化）。
  - **Termux:Boot**：开机自启脚本；**termux-services**（`sv` 命令）：把 streamlit 当守护进程跑。
  - Termux:API：通知/剪贴板/电量等 intent 接口（对包装 App 有辅助价值）。
- 结论：做不到"用户装一个 APK 完事"，但"装 Termux + 跑一条一次性 bootstrap 脚本 + 用包装 App/Widget 启动"是可达的最低摩擦形态。Android 10+ 后台限制意味着常驻服务需要前台通知，电量/被杀问题靠关电池优化缓解（dontkillmyapp 类清单）。

**1.4 全栈可行性与已知坑**
- LLM 层：pydantic-core ✓（TUR）、tiktoken ✓（TUR）、jiter/orjson/uuid_utils/xxhash/zstandard 源码编译（rust/clang）→ **可行**。
- 数据层：pytdx ✓ 纯 Python；ZODB 全族（ZODB/BTrees/persistent/zodbpickle/zope.interface/zope.proxy/transaction/zc.lockfile/ZConfig）均有纯 Python 实现或 `PURE_PYTHON` 回退（BTrees 4.0.7+ 支持 `PURE_PYTHON` 环境变量；zope.interface/zope.proxy 有纯 Python fallback；zodbpickle 有纯 Python 实现）→ **可行**。.fs 文件落 `$HOME/database/`（App 私有目录，无需存储权限）。
- UI 层：streamlit 依赖链中 pyarrow ✓（termux-main）、numpy/pandas/pillow ✓、tornado 纯 Python ✓、watchdog/httptools 小 C 编译 → **理论可行**，且社区有实际安装路径记录（termux-packages discussion #8036：`pkg install libarrow-cpp` + `export MATHLIB=m` + `pip install streamlit`）。但：
  - **pin 冲突（实测）**：streamlit 1.61.1 要求 `pyarrow<25,>=7`，而 termux-main 只有 pyarrow 25.0.0（aarch64 池实测仅此一版）→ 需要 `pip install streamlit --no-deps` + 手动装齐依赖（接受 pyarrow 25），或等 streamlit 放宽 pin。numpy 2.4.4 vs pin 2.3.2、TUR pandas 3.0.1 vs pin 2.3.2 同理（版本漂移，需在 spike 时验证兼容）。
  - 社区实测反馈参差：CrewAI 论坛有人 Galaxy A55 + Termux 里 Ollama/CrewAI 都跑通，但 streamlit GUI 在浏览器打不开（未给出错误细节）；有人按 #8036 步骤成功。**需真机 spike 验证**。
- 网络：pytdx 走原始 TCP 直连 TDX 行情服务器（119.x/101.x 段），Termux 无权限限制；Android 上无需任何配置。
- 资源：全栈驻留预估 1-2 GB RAM（pandas+pyarrow+langgraph+streamlit 同进程），主流手机（6-12GB）可承受；CPU 编译期消耗大，运行期 OK。

### 2. Android 路径 B：Chaquopy —— 当前栈不可行（数据层子集可行）

**2.1 版本/ABI/门槛**：Chaquopy 17.0.0 支持 Python 3.10.19/3.11.14/3.12.12/**3.13.9**/3.14.0；Python 3.12+ 仅 arm64-v8a 与 x86_64（32 位 ABI 已弃）；最低 API 24；2025 年起 Apache-2.0 开源并发布到 Maven Central，是目前**唯一活跃维护的 CPython-for-Android 预编译分发源**（BeeWare 的 Android 支持停留在 3.11 以下）。16KB page 设备需 Python 3.13+。

**2.2 pip 打包规则**：依赖在 Gradle 的 `pip {}` 块声明、**构建期打包进 APK**（运行时无 pip）；17.0.0 起 pip 25.3 默认 `--only-binary`（纯 Python sdist 仍可装，C 扩展必须走 Chaquopy 的预编译 wheel 仓库 `https://chaquo.com/pypi-13.1/` 或自写 recipe 交叉编译）。

**2.3 预编译覆盖（实测索引）**：仅 cffi、lxml、numpy、pandas、tornado、zope-interface、zstandard 等 7 个与本栈相关。**缺失即阻断**：
- **pydantic-core（Rust）：无 recipe，社区多次尝试失败**——chaquopy#995/#1063/#1326、pydantic-core#1607（pyo3 符号缺失）。官方唯一建议是 `pydantic<2`，但 **langgraph 1.x / langchain-core 1.x 硬性要求 pydantic>=2** → **LLM 层整体不可能**。
- jiter（openai 硬依赖）：无预编译；chaquopy#1326 中有人成功自建 jiter wheel（先例存在，但 pydantic-core 仍失败）。
- tiktoken（langchain-openai 硬依赖，实测 import 即加载）：无预编译。
- orjson/uuid_utils/xxhash（langsmith 硬依赖，实测 import 即加载）：无预编译（zstandard 除外 ✓）。
- **pyarrow：无 recipe（C++ 巨构），streamlit 不可能**。curl_cffi / py-mini-racer / akracer：无 recipe → **akshare 不可能**。
- watchdog/httptools：小 C 扩展，无预编译但默认构建器或可处理（未验证）。

**2.4 可行子集**：pytdx（纯 Python）+ ZODB 全族（纯 Python/PURE_PYTHON fallback；zope.interface 还有预编译）+ pandas/numpy（预编译 ✓）+ lxml ✓ + cffi ✓ + tornado ✓ → **只能做一个"数据层 App"**：原生 Kotlin UI + Chaquopy 桥接，进程内跑 pytdx 拉数据、ZODB 存 .fs、pandas 计算。这不满足本任务"完整 Python 栈 + 现有代码"的要求。

**2.5 APK 体积**：解释器+stdlib+NumPy 起步 +20-40MB，逐 ABI 翻倍；本数据层子集预估 100-200MB（单 ABI arm64）。官方建议按 ABI 拆 flavor（AAB 不省空间，因为 Chaquopy 把 ABI 库当 assets 打包）。

**2.6 线程/GIL**：Chaquopy 每个实例一个 Python 线程（有 GIL），Java↔Python 桥接层可用；langgraph 的 asyncio 在它上面跑无理论障碍（反正被 pydantic-core 卡死）。Android 生命周期：长驻服务需前台 Service + 唤醒锁，与 Termux 相同问题。

### 3. iOS —— 不可行（证据）

- **a-Shell**（App Store 终端）：内置 CPython 3.11，pip 只能装**纯 Python** 包（其 C 编译器产出 WASM 而非可加载 .so）→ numpy/pandas 装不了，**pydantic-core 更不可能** → langchain/langgraph/openai 全挂。沙盒只允许写自己的 Documents/Library/tmp。
- **Pyto**：捆绑预编译 numpy/pandas/matplotlib/scikit-learn（85%+ 桌面性能），但**没有 pydantic-core**，其 pip 也只限纯 Python → LLM 栈仍挂；且是闭源商店应用，不是可分发形态。
- **BeeWare/Briefcase**：唯一"把 Python 打包成可上架 App"的路径。2026-07 里程碑：NumPy 把 Android/iOS 列为 Tier 3 支持平台、贡献了 contourpy/kiwisolver 的 iOS 支持——但 **pydantic-core/tiktoken/orjson/curl_cffi/py-mini-racer/pyarrow 均无 iOS wheel**；其构建工具链钉在 pre-PEP517 的旧 pip、对新版 Meson 构建（numpy/scipy）无解、scipy 卡 Fortran 编译器；对"仓库里没有的包自己交叉编译"官方评价是"不是简单事"（Python-Apple-support#175）。streamlit 在 iOS 无任何先例。
- **iOS 沙盒对 ZODB .fs**：沙盒**本身不是阻断点**——App 可以在自己容器内写文件、fcntl/flock 锁可用，.fs 文件落 Application Support/Documents 完全合法；App Store 对捆绑解释器（BeeWare 模式）可过审。真正的阻断点是上面的依赖链全缺 + streamlit 的"本地服务"形态与 iOS 前后台生命周期（挂起即断网断服务）冲突 + 动态代码审查风险。
- **结论：iOS 无任何通道能把"langgraph+pandas+ZODB+streamlit"栈送上去**。若未来要做 iOS，只能全平台用另一套技术栈（如 Rust/Kotlin Multiplatform），与本项目 Python 栈无关。

### 4. 逐依赖可用性矩阵

图例：✅ 预编译/直接可用 · ⚠️ 需源码编译或变通 · ❌ 无可行路径。Termux 列假设已 `pkg install` 工具链（clang/rust）+ 挂 TUR wheel 源。

| 依赖（pinned） | Termux | Chaquopy | iOS | 备注 |
|---|---|---|---|---|
| pytdx 1.72 | ✅ 纯 Python 零依赖 | ✅ | ⚠️（依赖链不可达） | 原始 TCP，Android 需 INTERNET 权限（Chaquopy manifest） |
| akshare 1.18.81 | ⚠️ py_mini_racer(V8) 无解 → `--no-deps` 变通；主流程不用 | ❌ curl_cffi/py-mini-racer 无 recipe | ❌ | `import akshare` 即加载 py_mini_racer+curl_cffi（实测） |
| langgraph 1.2.10 | ✅ pydantic-core TUR wheel + xxhash 编译 | ❌ pydantic-core 无 recipe | ❌ | 硬依赖 pydantic>=2.7 |
| langchain-core 1.5.3 | ✅（拖 uuid-utils/orjson/zstandard/xxhash） | ❌ | ❌ | 实测 import 即加载 langsmith 全家 |
| langchain-openai 1.4.1 | ✅ tiktoken TUR ✓ + jiter 编译 | ❌ | ❌ | tiktoken import 即加载（实测） |
| openai 2.52.0 | ✅ jiter 需 rust 源码编译 | ❌ | ❌ | jiter 运行时解析 JSON 流用 |
| pydantic 2.11.7 / pydantic-core 2.33.2 | ✅ **TUR 预编译** | ❌ 社区多次失败（#995/#1063/#1326、pydantic-core#1607） | ❌ 无任何 iOS 构建 | **决定性差异点** |
| jiter（openai 系） | ⚠️ rust 编译（maturin TUR ✓） | ⚠️ #1326 有自建先例 | ❌ | |
| tiktoken | ✅ **TUR 预编译** | ❌ | ❌ | |
| ZODB 6.0.1（.fs） | ✅ 纯 Python + PURE_PYTHON fallback | ⚠️ 大概率可行（纯 Python fallback；zope.interface 预编译 ✓），BTrees/persistent 的 C 加速缺省 | ⚠️ 沙盒允许自容器写文件/flock，但整链不可达 | uuid_utils 不是 ZODB 6.0.1 依赖（PyPI 元数据确认），是 langchain-core 拖进来的 |
| BTrees / persistent / zodbpickle / zope.interface / zope.proxy / transaction / zc.lockfile / ZConfig | ✅ 纯 Python/PURE_PYTHON | ⚠️ 同上 | ⚠️ 同上 | zope.proxy 纯 Python fallback 存在（4.3.1+ 可选编译）；本栈实测 import 不需要 zope.proxy/ZConfig |
| pandas 2.3.2 | ✅ TUR 3.0.1（**版本漂移**：3.0 系 copy-on-write 默认，需验证） | ✅ 预编译（版本受 Chaquopy 仓库约束） | ⚠️ 仅 Pyto 捆绑 | |
| numpy 2.3.2 | ✅ termux-main 2.4.4（漂移） | ✅ 预编译（含 OpenBLAS） | ⚠️ BeeWare Tier3 / Pyto | |
| lxml 6.0.1 | ✅ TUR wheel + termux-main python-lxml | ✅ 预编译 | ❌ | |
| pyarrow 21/24 | ⚠️ termux-main 25.0.0（**与 streamlit 1.61.1 的 `<25` pin 冲突**，需 --no-deps 变通） | ❌ 无 recipe | ❌ | streamlit 硬依赖 |
| curl_cffi 0.14 | ⚠️ rust 源码编译（较重） | ❌ | ❌ | akshare 硬依赖 |
| py_mini_racer 0.6 / akracer | ❌ V8 现实上不可编译 | ❌ | ❌ | akshare 硬依赖，import 即加载 |
| streamlit 1.61.1 | ⚠️ 可行但 pin 冲突 + 社区反馈参差，需真机 spike | ❌ pyarrow 无 recipe | ❌ | 服务形态与 iOS 生命周期冲突 |
| tornado 6.5.2 | ✅ 纯 Python | ✅ 预编译 | ⚠️ | streamlit 服务端（运行时才加载） |
| watchdog 6.0 / httptools | ⚠️ 小 C 源码编译 | ⚠️ 小 C，未验证 | ❌ | streamlit 服务启动时加载 |
| websockets 15 / starlette / uvicorn / altair / pydeck / anyio / h11 | ✅ 纯 Python | ✅ 纯 Python | ⚠️ 纯 Python 但整链不可达 | |
| orjson 3.11.9 | ⚠️ rust 编译 | ❌ 无预编译 | ❌ | langsmith 硬依赖（实测加载） |
| xxhash 3.5 / zstandard 0.24 | ⚠️ C 编译（zstd 内置） | ✅ zstandard 预编译；xxhash ⚠️ | ❌ | langgraph/langsmith 硬依赖（实测加载） |
| uuid_utils 0.17 | ⚠️ rust 编译 | ❌ | ❌ | **langchain-core 硬依赖**（实测加载） |
| dotenv / loguru / requests / httpx / tenacity / click / toml / rich / protobuf / PyYAML / packaging / cachetools / blinker / python-dateutil / tzdata / cffi | ✅ 纯 Python | ✅ 纯 Python / cffi 预编译 | ⚠️ 纯 Python 可装但整链不可达 | cffi 是 lxml 等的间接依赖，Chaquopy 预编译 ✓ |

### 5. Streamlit 在手机上的角色（Q5）

- **Termux：Streamlit 服务能跑，UI 不用换。** 现状是"能装、能启动"（社区安装路径 #8036 有记录），但需要解决 pyarrow pin 冲突、watchdog/httptools 源码编译、后台保活（前台通知 + 关电池优化）；有一个失败先例（CrewAI 论坛用户 GUI 打不开）。**用户形态 = 手机浏览器或包装 App 内嵌 WebView 指向 `http://127.0.0.1:8501`**。Streamlit 本身是响应式 Web UI，手机浏览器可用。这是唯一"现有代码零改动"的路径。
- **Chaquopy：Streamlit 不可能**（pyarrow 无 recipe）→ UI 必须换成原生 Kotlin 或 WebView 自研 UI，通过 Java↔Python 桥调用逻辑层——且 LLM 层已被 pydantic-core 卡死，换 UI 也救不了。
- **iOS：无服务运行形态。**
- 若 Termux 上 streamlit 被证实不可靠，次选：把 UI 换成本地轻量 Web 服务（uvicorn/tornado + 手写页面）——但本项目 `core/ui/display.py` 是 streamlit 专属（st.* API），移植工作量大，应在 spike 验证后再决定。

### 6. 结论要点（给主代理）

1. **Termux 是唯一可行的全栈路径**，且是"现栈可移植"的（Python 3.14 当前、pydantic-core/tiktoken 有 TUR 预编译 wheel、ZODB/pytdx 纯 Python、streamlit 社区有成功安装路径）。
2. **Chaquopy 当前不可行**：唯一硬阻断是 pydantic-core（Rust）无 recipe 且社区多次失败，连锁卡死 langgraph/langchain/langchain-openai/openai；streamlit（pyarrow）、akshare（curl_cffi/py-mini-racer）同样无解。只能做数据层子集 App。
3. **iOS 不可行**（a-Shell 纯 Python pip、Pyto 无 pydantic-core、BeeWare wheel 农场缺全部关键原生包）。
4. 风险最高点在：**streamlit 在 Termux 真机上的可用性**（pin 冲突 + 社区反馈参差）和 **版本漂移**（pandas 3.0.1/pyarrow 25/numpy 2.4.4 vs pin 2.3.2/2.3.2）——建议先做一次真机 spike（Termux + 数据层 + ZODB + pytdx + streamlit 最小可跑）。
5. "用户无感"做不到：Termux 形态至少需要一次性手动设置（装 F-Droid 版 + bootstrap 脚本 + 授权 RUN_COMMAND/关电池优化），其后可用包装 App/Widget/Termux:Boot 启动。

## Caveats

- **未在真机执行安装**。所有"可用"结论基于：官方仓库实时索引（2026-08-09 实测 termux-main 与 TUR wheel 索引、Chaquopy pypi-13.1 索引）、PyPI 元数据、GitHub issue/discussion 与官方文档；import 链事实在本机桌面 3.13.5 同版本环境实测。Termux 侧的源码编译项（jiter/orjson/uuid_utils/xxhash/zstandard/watchdog/httptools/curl_cffi）未逐一验证。
- 版本漂移未验证：TUR pandas 3.0.1（copy-on-write 默认）对现有 pandas 2.3 代码的兼容性、termux-main pyarrow 25.0.0 与 streamlit 1.61.1 `<25` pin 冲突的绕法（--no-deps 手动装齐）均需 spike。
- streamlit-on-Termux 证据参差：一个成功安装路径记录（#8036）+ 一个失败反馈（CrewAI 论坛）。不能当作已证实。
- Chaquopy 的 pydantic-core 状态以 17.0.0 时代 issue 为准；社区仍在尝试（CIRISAgent 项目 build.gradle 里有本地 wheel 操作痕迹），但截至研究日无公开成功案例。
- akshare 在 Termux 的 `--no-deps` 变通未实测（py_mini_racer 在 `import akshare` 时加载，绕过方案是整体不 import akshare）。
- iOS 部分以 2026-07 BeeWare 状态更新为最新事实锚点；App Store 审查（动态代码）风险按 BeeWare 官方文档表述，未实测。
- 本任务"完全断网"的 LLM 部分（本地推理）不在 Q2 范围；Q2 只回答"Python 栈能否在手机本地跑"。网络权限层面：pytdx 的原始 TCP 在 Android 无额外障碍（Termux 免配置；Chaquopy 需 manifest 加 INTERNET）。

## External References

**Termux**
- Termux 安装与发行（Android 7+，F-Droid 推荐）：https://deepwiki.com/termux/termux-app/1.1-installation-and-distribution ；0.118.3 最低 API 24：https://www.apkmirror.com/apk/fredrik-fornwall/termux-fdroid-version/termux-f-droid-version-0-118-3-release/termux-f-droid-version-0-118-3-android-apk-download/
- pandas for Python 3.13 in Termux（TUR python-pandas 3.0.1-1，2026-03）：https://github.com/termux/termux-packages/issues/28857
- TUR pypi-wheel-builder（pydantic-core/tiktoken/numpy/pandas/lxml 预编译，`--extra-index-url https://termux-user-repository.github.io/pypi/`）：https://github.com/termux-user-repository/ ；wheel 索引实测：https://termux-user-repository.github.io/pypi/
- Termux python 3.14.6 / python-numpy 2.4.4 / python-pyarrow 25.0.0（2026-08-09 实测）：https://packages.termux.dev/apt/termux-main/dists/stable/main/binary-aarch64/Packages
- pyarrow 导入失败已知 bug：https://github.com/termux/termux-packages/issues/23607 ；libarrow-cpp 版本冲突：https://github.com/termux/termux-packages/issues/20861
- streamlit 安装路径记录（libarrow-cpp + MATHLIB=m + LDFLAGS）：https://github.com/termux/termux-packages/discussions/8036
- streamlit 在 Termux 失败先例（Galaxy A55，CrewAI 论坛）：https://community.crewai.com/t/running-ollama-crewai-streamlit-in-salsumg-galaxy-a55-termux/3998
- RUN_COMMAND intent（第三方 App 启动 Termux 命令）：https://github.com/termux/termux-app/wiki/RUN_COMMAND-Intent
- Termux:Widget（桌面快捷方式，`~/.shortcuts/tasks` 后台运行）：https://github.com/termux/termux-widget ；使用教程：https://terminaltools.hashnode.dev/how-to-use-termux-widget-for-one-tap-script-launch
- Termux:API 0.53.0（API 24+）：https://www.apkmirror.com/apk/fredrik-fornwall/termuxapi-github-version/termuxapi-github-version-0-53-0-release/

**Chaquopy**
- 17.0.0 发布说明（Python 3.10–3.14、16KB page、--only-binary）：https://chaquo.com/chaquopy/chaquopy-version-17-0-0/ ；changelog：https://chaquo.com/chaquopy/doc/current/changelog.html
- 包构建系统与 recipe（numpy/pandas/OpenBLAS）：https://deepwiki.com/chaquo/chaquopy/5.1-python-package-building
- 预编译 wheel 索引（实测：cffi/lxml/numpy/pandas/tornado/zope-interface/zstandard 有，pydantic-core/tiktoken/orjson/uuid-utils/pyarrow/curl_cffi 无）：https://chaquo.com/pypi-13.1/
- pydantic-core 失败记录：https://github.com/chaquo/chaquopy/issues/995 、https://github.com/chaquo/chaquopy/issues/1063 、https://github.com/chaquo/chaquopy/issues/1326 、https://github.com/pydantic/pydantic-core/issues/1607
- APK 体积与 ABI 拆分：https://chaquo.com/chaquopy/doc/14.0/faq.html#faq-size 、https://github.com/chaquo/chaquopy/issues/448 、https://github.com/chaquo/chaquopy/issues/1198
- numpy 官方 Android 支持 issue（动机：Android 成为 CPython 3.13 支持平台）：https://github.com/numpy/numpy/issues/27698

**iOS**
- BeeWare 2026-07 状态更新（NumPy iOS/Android Tier 3、contourpy/kiwisolver、uv）：https://beeware.org/zh_TW/news/buzz/2026/july-2026-status-update/
- BeeWare 预编译 iOS wheels 与"自己编译很难"（pre-PEP517、Meson、Fortran）：https://geeksrepos.com/beeware/Python-Apple-support/issues/175
- a-Shell（纯 Python pip 限制、沙盒）：https://deepwiki.com/holzschu/a-shell/3.1-programming-language-support
- Pyto（捆绑 numpy/pandas，CPython 3.10/3.11）：https://blog.gitcode.com/4b1d96f38a40a971bcbb2d89c8980c3c.html
- iOS Python 环境总览（runebook，Python 官方文档镜像）：https://runebook.dev/en/docs/python/using/ios

**PyPI 元数据（2026-08-09 实测）**
- pytdx 1.72（纯 Python，零依赖）：https://pypi.org/pypi/pytdx/json
- akshare（lxml/pandas/curl_cffi/py-mini-racer/akracer）：https://pypi.org/pypi/akshare/json
- streamlit 1.61.1（pyarrow<25、watchdog、starlette/uvicorn 系）：https://pypi.org/pypi/streamlit/1.61.1/json
- langgraph 1.2.10（pydantic>=2.7.4、xxhash）：https://pypi.org/pypi/langgraph/1.2.10/json
- langchain-core 1.5.3（pydantic、uuid-utils）：https://pypi.org/pypi/langchain-core/1.5.3/json
- langsmith 0.10.15（orjson/xxhash/zstandard/uuid-utils/websockets）：https://pypi.org/pypi/langsmith/0.10.15/json
- langchain-openai 1.4.1（openai>=2.45、tiktoken）：https://pypi.org/pypi/langchain-openai/1.4.1/json
- openai 2.52.0（pydantic、jiter）：https://pypi.org/pypi/openai/2.52.0/json
- ZODB 6.0.1（无 uuid_utils 依赖）：https://pypi.org/pypi/ZODB/6.0.1/json
- BTrees 纯 Python fallback（PURE_PYTHON）：https://github.com/zopefoundation/BTrees/issues/156 ；zope.proxy 纯 Python fallback：https://mail.zope.dev/pipermail/checkins/2017-November/078004.html
