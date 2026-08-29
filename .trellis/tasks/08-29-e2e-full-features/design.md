# Design: 全功能端到端真实验证

## 环境拓扑

- **web**:`app/` 内 `npx expo export --platform web` → `node --experimental-strip-types server.mjs`(hub 托管,默认 127.0.0.1:8090)。server.mjs 经 `src/env.ts` 读 `process.env`——**无 dotenv**,启动时须把根 `.env` 键导出进 hub start env(`set -a; source ../.env; set +a` 或解析注入),否则 /tdx-collect 的 TDX key 等缺。
- **安卓**:`app/android && ./gradlew assembleDebug` → `adb install -r` → Metro(8081)+ `adb reverse tcp:8081`(debug 包不内嵌 bundle,冷启动需 Metro)。
- **驱动**:web = chrome(puppeteer 双通道 console 收集 + 页内 onerror/unhandledrejection 包装);安卓 = adb logcat + screencap + uiautomator dump + input。

## 设置注入(密钥运行时注入,不落库)

- web:localStorage `soa:settings`,键结构 `{keys:{llmApiKey,llmModel,llmBaseUrl,tdxApiKey,billionsApiKey,finnhubApiKey,langsmithKey,langsmithProject,langsmithTracing},switches:{tdxMcp:true,webSearch:true,billionsMaster:true,findb:true,search:true,twitter:true,fetch:true,analyst:true},caps:{searchMax:3,twitterMax:2,fetchMax:3}}`。finnhub 无 key → 留空走降级。
- 安卓:`adb shell run-as com.stockoperatoragent.app sh -c 'cat > files/soa-settings.json'`(单命令直传,防引号剥层;经 /data/local/tmp 中转时用后即删)。
- 键值取自根 `.env` 运行时读取;档案只留掩码。

## 证据通道

| 通道 | 用途 |
|------|------|
| chrome console 双通道(puppeteer console/pageerror + 页内包装) | 错误级输出、模式:真实 LLM、工具调用痕迹 |
| hub 托管 server 日志 | /llm-proxy /tdx-collect /web-search /yahoo-collect 请求与状态 |
| DOM 行为级判据 | 「✓ 分析完成(N 步)」、chips 状态、演示模式标签缺席、情报/搜索/亿信段落内容 |
| adb logcat(-s ReactNativeJS:E + FATAL EXCEPTION 过滤) | 安卓错误面 |
| screencap/uiautomator dump | 安卓终态视觉 + 被遮挡时权威状态 |

## 运行序列(计费受控)

1. 前置门(vitest/tsc/chart 双门)→ 确认树干净。
2. 安卓构建后台先行(最长杆)。
3. web 构建 + server 起(根 .env 键注入 env)。
4. **web cn 全功能**(600036):注入 → reload → 无演示模式 → 启动分析 → 全程
   收集证据 → D15 终态截图。
5. **web hk**(00700)→ **web us**(AAPL):同配方,验证 Yahoo 链 + Finnhub 降级。
6. 安卓:安装 → 注入 → Metro 反向 → cn 全功能(600036)→ us 全功能(AAPL)
   (评审门已批准「全部都覆盖」)。
7. 汇总 research/e2e-report.md(AC 矩阵 + 证据路径 + 降级记录)→ trellis-check
   → commit → 归档。

## 风险与降级

- **亿信/TDX MCP 浏览器直连 CORS**:失败则 console/段落出现降级文案——如实
  记录为"链路不可用(环境)"而非产品缺陷;证据=降级文案 + 请求状态。
- **DDG 间歇 403/502**:尽力而为路径,优雅降级不阻塞(08-24 实证)。
- **LangSmith**:用户评审门决定跳过——不注入 langsmith 键,报告标注未验证。
- **LLM 运行间重试非确定性**:步数随运行变化,终态语义为准。
- 发现**产品级阻塞 bug** → 停止该面,报告并征得同意后另开修复任务(本任务
  不修码)。

## 回滚

纯验证任务,无产品代码改动;唯一产物为构建缓存与研究文件。任一面失败即
记录跳过依据,web 与安卓互不阻塞。
