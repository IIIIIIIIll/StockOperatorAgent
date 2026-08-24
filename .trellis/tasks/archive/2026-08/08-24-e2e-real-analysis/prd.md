# PRD: 真实场景双端 E2E 验证(真实 LLM 分析)

## Background

08-23 e2e-web-android 任务的验证止于 demo stub LLM + 无效 key 失败路径;「Yahoo/Finnhub/LLM 真实外网链路」与「真实数据源全链路」当时明确 out-of-scope。用户现要求补**带真实分析的端到端验证**,web 与安卓双端。

LLM 三键取自仓库根 `.env`(`LLM_API_KEY`/`LLM_MODEL=deepseek-v4-flash`/`LLM_BASE_URL=https://opencode.ai/zen/go/v1`,OpenAI 兼容),运行时注入两端设置存储——`app/.env` 的 `EXPO_PUBLIC_LLM_*` 刻意留空,key 不进 bundle。

## Goal

在真实运行面(web 生产构建托管 + 安卓 debug APK)上,用真实 LLM 凭证完成一次完整分析链路,行为级判据验证成功终态。

## Acceptance Criteria

- **AC-W1** web:`expo export --platform web` 构建成功,server.mjs 托管加载无 console error(双通道收集)。
- **AC-W2** web:注入三键后 `llmConfigured=true` 生效——页面**不出现**「演示模式」标签(与 08-23 demo 路径的判别性证据)。
- **AC-W3** web:发起分析后真实 LLM 全流程完成:「✓ 分析完成(N 步)」+ 全角色 chips「完成」;`/llm-proxy` 有 2xx 往返(网络面佐证非 stub)。
- **AC-A1** 安卓:`gradlew assembleDebug` 成功,安装 emulator-5554 启动无 FATAL EXCEPTION。
- **AC-A2** 安卓:注入三键后真实分析全流程完成(D15 成功终态 + 无「演示模式」);logcat ReactNativeJS 无错误级输出。

## Constraints

- **密钥不入库**:任务工件/报告/截图一律掩码(`sk-jGV3…30Lp` 形式),完整值仅存在于运行时注入动作中。
- 真实 LLM 调用计费(deepseek-v4-flash);单 ticker 单次全流程,不做多轮重放压测。
- **真实行情数据链路(TDX/Yahoo)尽力而为仅记录**:采集成功则佐证数据进入分析上下文;失败如实记录原因,**不计失败**(用户裁定)。
- 模拟器沿用现成 emulator-5554,不新装 SDK 组件。
- 判据复用 `.trellis/spec/ts/web-e2e.md` D15 行为级配方 + console 双通道 gotcha。

## Out of scope

iOS、release 签名产物、性能/视觉回归、settings UI 自动化深度测试、多 ticker/多市场矩阵、LLM 输出质量评估(只验链路真伪与终态)。
