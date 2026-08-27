# StockOperatorAgent - 多智能体交易决策系统

> 2026-08-14：Python 业务代码已全部 phaseout（分域删除，见任务
> `08-14-phaseout-e-py-deletion`），本仓库为**纯 TypeScript 实现**（web 浏览器
> 为主入口，另有 Node 探针）。

---

## 安装

请确保你已经安装了 **Node.js ≥ 22**（Node 探针需 `--experimental-transform-types`；
生产 server 走 `--experimental-strip-types`，Node ≥ 23.6 默认开启）。然后：

```bash
npm install      # 业务层 + 测试（vitest / tsc / probe）
cd app && npm install     # web 应用（Expo / React Native Web）
```

## 使用

1. **配置 LLM**：在网页**侧边栏「设置」面板**的「模型与密钥」填写三个必填键
   （OpenAI 兼容，任意供应商）——`LLM_API_KEY`（API Key）、`LLM_MODEL`（模型名，
   如 `deepseek-v4-flash`、`gpt-4o`）、`LLM_BASE_URL`（endpoint，如
   `https://api.deepseek.com`、OpenCode Zen 网关 `https://opencode.ai/zen/go/v1`、
   本地 vLLM/Ollama 网关）。可选 `LLM_REASONING_EFFORT=max` 透传推理档。设置保存
   于浏览器 localStorage，保存即生效。未配置三键时应用使用**演示占位 LLM**跑通
   全图（报告为占位文本）。
   - 可选：`TDX_API_KEY`（通达信 MCP）启用实时市场情报（概念板块/资金流）注入
     agent 决策；未配置时正常降级（跳过实时情报段），`TDX_MCP_DISABLED` 可显式
     关闭。
   - 可选：`BILLIONS_API_KEY`（亿信 Fin 开放平台）启用公告/研报/新闻/推特检索与
     自然语言金融问数；未配置时亿信能力关闭、信息面分析师自动经免费联网搜索
     （DuckDuckGo）兜底；`BILLIONS_*_DISABLED` 独立关闭各能力，
     `BILLIONS_*_MAX_CALLS` 限制每次分析的调用上限。
   - 所有密钥与能力开关、亿信调用上限均在侧边栏「设置」面板修改，保存即生效。
2. 运行 web 应用（生产，默认 `http://localhost:8090`，仅监听回环）：

```bash
cd app && npx expo export --platform web && node server.mjs
```

   开发模式：`cd app && npm start`（Expo dev server）。
3. Node 探针（真 TDX 直连完成一次全分析 → `probe-output/report.json`）：

```bash
node --experimental-transform-types tools/probe.mts 600036
```

4. 测试与类型检查：

```bash
npm test && npm run typecheck   # vitest 全绿 + tsc --noEmit
```

![基础界面](docs/start_page.png)

## 功能

1. 基于真实市场数据，提供基本面、趋势、技术指标与信息面分析报告
2. 支持多智能体协作决策（专家初稿 → 多空对抗修订 → 投资经理终审）
3. 提供可视化的交易决策界面（报告 Tab、采集数据表格与图表）
4. 侧边栏设置面板：模型/密钥/能力开关/亿信调用上限全部可在网页修改

## 数据源

- **主链路（纯 TDX）**：`src/tdx/` 直连通达信行情服务器（npm `node-tdx-market`
  / pytdx 协议）。历史行情（前复权 qfq）、**个股概览**（行情/股本/估值与市值
  派生/涨跌幅）、**业绩报告**（F10 财务分析节解析 + 环比自算）与**技术指标**
  全部由 TDX 提供；web 端经同源 `/tdx-collect` 代理采集（Node 探针直连）。
  个股数据**按需单股采集**（分析哪只采集哪只，不做全市场扫描）。
- **亿信 Fin（可选）**：`src/billionsClient.ts` REST 薄包装——公告/研报/新闻/
  推特检索（信息面分析师预抓 + agent 的 LLM 工具）+ 自然语言金融问数（采集数据
  的「亿信金融数据库」段）。`BILLIONS_API_KEY` 为主闸（web 端在设置面板填写），
  未配置时全部关闭；信息面分析师自动回退免费联网搜索（DuckDuckGo，免 key）预抓
  素材——亿信优先、联网兜底，双失败才产出「未检索到素材」占位报告（web 端经
  同源 `/web-search` 代理）。
- **联网搜索**：`src/webSearch.ts`——Tavily（有 key 时优先）→ DuckDuckGo
  html/news.js 双端点回退；信息面分析师的 `web_search` 工具与预抓兜底共用。
- **北交所 / akshare**：明确不支持（用户决策 08-13）。BJ 代码（4/8 前缀）在
  UI 入口明确提示不支持而非静默 NaN。
- **字段缺失语义**：pytdx 无数据的字段（量比/5分钟涨跌/动量/毛利率等）输出
  NaN/N/A，不报错；名称索引拉取失败时回退股票代码。

## 注意事项
- 请确保你的API密钥安全，不要泄露给他人。web 端密钥存于浏览器 localStorage
  （跨浏览器不共享）；Node 探针从环境变量读取。
- 首次分析某只股票时需从 TDX 拉取全量历史日K（约 1-2 秒/只），请耐心等待。
- 本项目仅供学习和研究使用，不构成任何投资建议。

## 发布（GitHub Actions 自动构建）

打 `v*` tag 即触发 CI 构建桌面安装包（Windows NSIS / Linux AppImage+deb / macOS
dmg）与 Android APK，产物自动挂到 GitHub Release；手动触发（无 tag）时产物改传
Actions artifact 供自测。

### 发布说明（CHANGELOG 决策）

本仓库不维护独立 CHANGELOG.md：每次发版的说明写在对应 GitHub Release body
（release.yml 自动填充安装/签名提示，变更点手动补充），README 发布章节同步
维护产物清单与流程。三份文档源（CHANGELOG / Release / README）易漂移，故
不再引入第三份——后续发版只在 Release body 记录变更，勿新建 CHANGELOG。

### 发版步骤

1. 更新 `desktop/package.json`、`app/package.json` 与 `app/app.json` 的
   `version`（如 `1.1.0`；Android 产物版本取自 `app/app.json`，三处需一致）。
2. 打 tag 并推送（tag 必须为 `v<version>`，与上述三处 version 对齐）：

```bash
git tag v1.1.0
git push origin master --tags
```

3. 打开仓库 **Actions** 页确认 `release` 工作流（`desktop` + `android` 两个 job）
   全绿；tag 推送会自动在 **Releases** 页创建 Release 并挂载产物（私有仓库的
   Release 资产需登录 GitHub 后下载）。

### 产物清单

| 平台 | 产物 | 说明 |
|---|---|---|
| Windows | `StockOperatorAgent-Setup-<version>.exe` | NSIS 安装包 |
| Linux | `StockOperatorAgent-<version>-<arch>.AppImage`、`StockOperatorAgent-<version>-<arch>.deb` | 便携 / 安装包 |
| macOS | `StockOperatorAgent-<version>-<arch>.dmg` | 磁盘映像 |
| Android | `soa-<version>.apk` | 可直接安装 |
| Android (Play) | `soa-<version>.aab` | Google Play 上架包(与 APK 同一签名密钥) |

### 手动触发（CI 自测）

仓库 **Actions** → `release` → **Run workflow**（无需打 tag）。此时产物不上
Release，改为上传到 Actions artifact（桌面产物按 OS 分目录、APK 为
`soa-<分支名>.apk`），下载即可自测。

### 签名限制

- **Windows / macOS 产物未签名**：Windows SmartScreen 可能提示"未知发布者"；
  macOS 打开时会触发 Gatekeeper"无法验证开发者"提示，需在"系统设置 → 隐私与
  安全性"中手动允许。正式签名需购买证书（代码签名证书 / Apple Developer
  Program），属后续工作。
- **Android 默认 debug 签名**：未配置签名 Secrets 时 APK 使用 expo prebuild
  默认的 debug keystore 签名（可安装、可用于自测）；正式发布请配置正式签名（见下）。

### Android 正式签名配置（可选）

1. 生成 keystore（JDK 自带 keytool；`<...>` 按实际替换）：

```bash
keytool -genkeypair -v -keystore release.keystore -alias <alias> \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass <store-password> -keypass <key-password> \
  -dname "CN=StockOperatorAgent, OU=Dev, O=StockOperatorAgent, C=CN"
```

2. 仓库 **Settings → Secrets and variables → Actions** 配置 4 个 Secrets：

| Secret | 值 |
|---|---|
| `ANDROID_KEYSTORE_B64` | keystore 文件的 base64 编码（`base64 -w0 release.keystore` 的输出，粘贴为一整行） |
| `ANDROID_KEYSTORE_PASSWORD` | keystore 口令（对应 `-storepass`） |
| `ANDROID_KEY_ALIAS` | 密钥别名（对应 `-alias`） |
| `ANDROID_KEY_PASSWORD` | 私钥口令（对应 `-keypass`） |

3. 下次构建时 CI 自动写入 keystore、生成 `keystore.properties` 并以正式签名构建
   （脚本 `tools/configure-android-signing.mjs`，幂等，重复运行零变化）。**未配置
   上述 Secrets 时自动降级 debug 签名**，流水线不中断。

> 请妥善保管 keystore 文件与口令：丢失后无法再向已发布的 APK 提供升级。
