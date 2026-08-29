# E2E 全功能真实验证报告(2026-08-29)

任务:08-29-e2e-full-features · web(生产构建 + chrome)+ 安卓(debug APK +
emulator-5554)· 5 次真实 LLM 全流程(评审门批准「全部都覆盖」)

## 1. 运行矩阵

| # | 运行面 | ticker | 市场 | 步骤 | 耗时 | 最终决策 | D15 终态 |
|---|--------|--------|------|------|------|----------|----------|
| 1 | web | 600036 招商银行 | cn | 64 | 1029.7s | 6896 字符 | ✓ |
| 2 | web | 00700 腾讯 | hk | 56 | 896.8s | 7333 字符 | ✓ |
| 3 | web | AAPL Apple | us | 66 | 1169.8s | 7059 字符 | ✓ |
| 4 | 安卓 | 600036 招商银行 | cn | 52 | 700.6s | 5336 字符 | ✓ |
| 5 | 安卓 | AAPL Apple | us | 56 | 868.5s | 6504 字符 | ✓ |

D15 判据(每运行全部满足):「✓ 分析完成(N 步)」+ 7 角色 chips「完成」+
「真实 LLM」标签 + 页面无「演示模式」+ 无错误横幅 + 无错误级日志。

## 2. 功能矩阵证据

| 功能 | web cn | web hk | web us | 安卓 cn | 安卓 us |
|------|--------|--------|--------|---------|---------|
| 真实 LLM 链(mode=real) | ✓ | ✓ | ✓ | ✓ | ✓ |
| LLM 网络面 | /llm-proxy 30/30 2xx | 8 份报告日志 | 8 份报告日志 | 8 份报告日志 | 8 份报告日志 |
| TDX 采集 | 5850 根日K+F10(代理) | — | — | 5850 根日K+F10(直连) | — |
| Yahoo 采集 | — | 200,7.9s | 11519 根日K | — | ✓(直连) |
| 联网搜索(DDG) | 44/44 2xx | ✓ 工具轮 | ✓ 工具轮 | ✓ | ✓ |
| 亿信五能力 | ✗(见 F1) | ✗(F1) | ✗(F1) | ✓(502 间歇) | ✓(502 间歇) |
| TDX MCP 情报 | ✗ CORS(见 F2) | ✗ CORS | ✗ CORS | ✓ 执行 | ✓ 执行 |
| 多市场数据进报告 | CNY/招商银行 | HKD/Tencent×2 | USD/Apple×2 | CNY | USD |
| 图表渲染 | ✓ MA/BOLL 图例 | ✓ | ✓ | ✓ | ✓ |
| 委员会 8 角色+修订+终审 | ✓ | ✓ | ✓ | ✓ | ✓ |
| 工具轮(模型主动请求) | web_search 多次 | 同上 | 同上 | web_search/billions_search 多次 | 同上 |
| LangSmith 追踪 | 跳过(用户决定) | — | — | — | — |
| Finnhub 增强 | 无 key → 降级(未配置) | — | — | — | — |

## 3. 发现(findings)

### F1(产品 bug,严重):web 端亿信五能力全灭 —— Illegal invocation
- 现象:web 每次亿信调用 `亿信 API 请求失败：Failed to execute 'fetch' on 'Window': Illegal invocation`(FINDB/SEARCH/TWITTER/FETCH/ANALYST 全部),信息面素材缺失。
- 根因:`src/billionsClient.ts` 构造器 `this._fetch = opts.fetch ?? globalThis.fetch`,随后 `this._fetch(url, opts)` **以方法形式调用**。Chrome 强制 fetch 的 this === Window:实测 `holder.f = globalThis.fetch; holder.f(url)` 必现 Illegal invocation,而裸调用/bind 正常(headless chrome 1440×900 复现实验)。
- 影响面:web 平台亿信全灭;安卓(RN fetch 不检查 this)正常——安卓有真实 502 响应与报告引用为证。
- 修复建议(一行级):`this._fetch = opts.fetch ?? ((...a) => globalThis.fetch(...a))`,或调用点改裸调用。**本任务不修码,待用户批准开修复任务。**
- 08-24 未暴露原因:当时未注入 billionsApiKey,主闸关闭未走 fetch。

### F2(环境/设计缺口):TDX MCP web 直连被 CORS 阻断
- 现象:web 情报段「(通达信 MCP 查询异常,跳过600036的实时情报)」;安卓无此问题。
- 根因:`https://mcp.tdx.com.cn:3001/mcp` OPTIONS 预检响应**无 Access-Control-Allow-Origin**(nginx/Express,实测),浏览器跨域拦截。TdxMcpClient 在 web 端浏览器直连(无同源代理)。
- 建议(需批准):server 侧加 `/tdx-mcp` 同源代理(对齐 /llm-proxy 模式),或接受降级。
- 注:TDX **行情采集**(日K/F10)不受影响——走 /tdx-collect 代理,双端实证 5850 根日K。

### F3(上游间歇,非缺陷):亿信 HTTP 502 ×3 + DDG 502 ×1
- 安卓 us 18:51:30 report 502、18:51:36 twitter 502、安卓 cn 18:36:57 search 502;web cn 18:10:37 /web-search 502 一次(其余 44 次 2xx)。
- 语义:尽力而为路径优雅降级不阻塞(08-24 同款实证),符合 error-handling 设计。

### F4(验证环境 gotcha 实证,非产品缺陷)
- 安卓通知权限弹窗冻结底层渲染 → 终态截图显示旧 lastRun(8/24)——关闭弹窗后渲染解冻,lastRun 实际已更新(8/29 19:05)。
- web headless:首帧 passive effect 未 flush,`__soa` 在首次交互后才注入(手动 probe 残留导致误判)——自动化驱动需先交互。
- 安卓输入:RN TextInput 对 `adb input text`(commitText)不响应、对逐键 KEYCODE 响应——文本输入需逐键;模拟器 stylus 手写引导弹窗会吞输入,需先禁用(`settings put secure stylus_handwriting_tutorial_shown 1`)。

## 4. AC 矩阵

| AC | 结果 | 证据 |
|----|------|------|
| P1 前置门 | ✓ | vitest 670P/1S(基线≥666)、tsc 0 错误、chart:build+check OK 零 diff、git 干净 |
| W1 web 构建托管 | ✓ | export 成功、server 8090、无错误横幅 |
| W2 注入生效 | ✓ | 无 gate notice、无「演示模式」、lastRunAt=真实 LLM |
| W3 web cn 全功能 | ✓ | 64 步完成 + 30/30 llm 2xx + TDX 5850 根日K+F10 + 工具轮实证 |
| W4 web 多市场 | ✓ | hk 56 步(HKD/Tencent 数据)+ us 66 步(USD/Apple/11519 根日K) |
| A1 安卓构建安装 | ✓ | assembleDebug 成功、无 FATAL(冷启动日志) |
| A2 安卓注入生效 | ✓ | logcat「LLM 已配置:sk-j…30Lp ✓」 |
| A3 安卓 cn 全功能 | ✓ | 52 步 + TDX 直连 5850 根日K+F10 + 零错误级日志 |
| A4 安卓多市场 | ✓ | us 56 步 + Apple 319.70 美元 + 零错误级日志 |
| R1 报告与掩码 | ✓ | 本文档;密钥仅掩码形式;skipped(LangSmith/Finnhub)如实说明 |

## 5. 密钥与成本

- 密钥:运行时注入(localStorage / run-as 沙盒),报告全掩码(sk-j…30Lp 形式);
  根 .env 的 ANDROID_KEYSTORE_* 未触碰;LANGSMITH_* 未注入(用户跳过)。
- 成本:5 次全流程 LLM + 亿信若干调用(上限 3/2/3 per run);总耗时 ~1h15m。

## 6. 资产索引

- assets/web-cn/{terminal-state,data-tab}.webp、assets/web-hk/terminal-state.webp、
  assets/web-us/terminal-state.webp、assets/android-cn/terminal-state.png、
  assets/android-us/terminal-state.png
- reports-web-{cn,hk,us}.txt(web 三市场页面全文,含全部 8 角色报告与数据卡)
- 运行时日志:logs/soa-ts.log(web 全量,含每次 LLM 调用结果)、adb logcat(安卓)

## 7. 结论与建议

**5/5 运行 D15 终态全过,主链路(真实 LLM + 采集 + 委员会 + 工具轮 + 多市场)双端稳定。
一个产品 bug(F1 web 亿信)与一个设计缺口(F2 web TDX MCP 代理)待用户裁定**——
建议:批准 F1 修复任务(一行级,低风险)+ F2 评估是否加 /tdx-mcp 同源代理。
