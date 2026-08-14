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
3. 提供可视化的交易决策界面（报告 Tab、采集数据表格与图表、暗色主题）
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
