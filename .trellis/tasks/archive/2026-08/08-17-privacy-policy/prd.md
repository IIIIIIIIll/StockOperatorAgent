# PRD: Google Play 隐私政策文档

## Goal

为 Android 应用「做个好人AI股票分析系统」(package `com.stockoperatoragent.app`,Expo/RN,
仓库 StockOperatorAgent)编写一份符合 Google Play 要求的隐私政策,供 Play Console
「App content → Privacy Policy」页提交(需托管在活跃 URL 上)。

## 背景(已核实事实)

- 应用形态:web(浏览器为主入口)+ Android APK + 桌面 Electron 壳;多智能体股票分析,
  分析对象为**用户主动输入的股票代码**。
- 权限(AndroidManifest):`FOREGROUND_SERVICE` / `FOREGROUND_SERVICE_DATA_SYNC` /
  `POST_NOTIFICATIONS`(保活前台服务 + 通知)。**无**敏感权限(无定位/通讯录/SMS/相机)。
- 数据收集:无账号注册、无埋点、无广告 SDK、无 Firebase/Sentry 等分析 SDK
  (app/package.json 与 lock 文件核实)。用户数据仅:
  1. 用户自行填写的 API 密钥(LLM_API_KEY / TDX_API_KEY / BILLIONS_API_KEY 等),
     **仅存本地**(web: localStorage/IndexedDB;Android: 应用沙盒文件;
     桌面: userData 目录),不发往开发者服务器;
  2. 用户输入/分析的股票代码;
  3. 本地日志(含分析过程文本,落设备本地)。
- 第三方数据流(均为**用户配置或分析所需而触发**):用户自配的 LLM 服务商
  (OpenAI 兼容,base URL 用户指定)、通达信行情服务器(TDX)、亿信 Fin(可选,
  有 key 才启用)、联网搜索(Tavily/DuckDuckGo,查询文本)。
- 无开发者自有后端:分析请求从客户端直连上述第三方,开发者不收集、不出售、不共享
  个人数据。
- 开发者:Yuanhai Tan;联系渠道建议 GitHub Issues(repo: IIIIIIIIll/StockOperatorAgent)。
- 目标受众:成人;不面向儿童,无儿童定向内容。

## Deliverable

- `docs/privacy-policy.md` — 中文隐私政策,可直接托管上线(用户自行决定 URL 托管)。

## Acceptance Criteria

1. 文档为单一中文 Markdown,位于 `docs/privacy-policy.md`,标题含应用名与生效日期。
2. 覆盖 Google Play 要求(按帮助文档 9859455 与 User data policy):
   - 收集哪些数据(类型清单)、如何使用;
   - 是否共享/出售,与哪些第三方共享(含用户自配 LLM 服务商、TDX、亿信、搜索);
   - 数据存储位置与保留;
   - 权限说明(通知/前台服务);
   - 用户权利(删除/修改/撤销,密钥本地可清除);
   - 儿童隐私声明;
   - 联系方式(隐私相关问题渠道);
   - 政策变更通知方式。
3. 内容与实际应用行为一致(不虚构收集项);不承诺无法兑现的权利。
4. 文档附 Google Play 提交提示:URL 须活跃、应用内亦需链接(现状提示)。

## Non-Goals

- 不托管 URL / 不部署 GitHub Pages(用户自行决定托管位置)。
- 不写英文版(可后续按需翻译)。
- 不修改应用代码(应用内链接隐私政策属后续任务,若用户要求)。
