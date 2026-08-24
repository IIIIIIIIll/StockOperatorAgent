# E2E Report: 真实场景双端验证(真实 LLM 分析) — 2026-08-24

## 结论

**PASS**。web 与安卓双端均以真实 LLM(deepseek-v4-flash @ opencode zen)完成 600036 全流程分析,D15 成功终态 + 「真实 LLM」判别标签双端齐备。真实 TDX 行情采集双端生效(尽力而为项,实际达成)。

## AC 矩阵

| AC | 判据 | 结果 | 证据 |
|----|------|------|------|
| AC-W1 | web 构建托管加载无 console error | ✅ | expo export 成功;加载期 console 仅 info(msgid 6-9);分析期仅 DDG 502 资源错(尽力而为路径,已优雅降级) |
| AC-W2 | 注入三键后非演示模式 | ✅ | 门控警告消失;console `LLM 已配置:LLM_API_KEY=sk-j…30Lp ✓ …`;终态横幅「真实 LLM」 |
| AC-W3 | web 真实分析 D15 成功终态 | ✅ | 「✓ 分析完成(47 步)」+ 7 chips 全「完成」+ 无「演示模式」;`/llm-proxy/chat/completions` **19 次全 200**;console `模式:真实 LLM` |
| AC-A1 | APK 安装启动无崩溃 | ✅ | assembleDebug BUILD SUCCESSFUL;冷启动 logcat 零 FATAL、crash buffer 0、无 ReactNativeJS:E |
| AC-A2 | 安卓真实分析 D15 成功终态 | ✅ | uiautomator 权威文本:「已显示上次分析结果 · 10:19:48 PM · 真实 LLM」+ 7 chips 全「完成」+「✓ 分析完成(36 步)」;logcat `分析完成:8 份观点,最终决策 5645 字符`、`耗时 178.1s` |

## 尽力而为项(用户裁定不计判据)

| 项 | 结果 |
|----|------|
| TDX 真实行情采集(web) | ✅ 超预期:`/tdx-collect?ticker=600036` 200,「采集完成:5846 根日K + F10」;采集数据页刷新(最新价 38.80→39.58) |
| 设备侧数据(安卓) | ✅ 采集数据页同样刷新至 39.58(与 web 一致,设备侧真实采集生效) |
| 联网搜索 | ⚠️ 间歇失败:设备端 DDG news HTTP 403(1 次);web 代理 3/17 次 502(reqid 29/140/153);均优雅降级不阻塞,其余搜索真实返回(招商银行 2026 半年报/净息差/高股息等查询) |

## 关键证据

- 截图:`assets/web-terminal.png`(47 步 + 真实 LLM 横幅)、`assets/android-terminal.png`(36 步 + 真实 LLM 横幅)。
- web console 终局:「投资经理完成终审」「报告[最终结论] 3878 字符」「分析完成:8 份观点」「耗时 381.9s」。
- 安卓 logcat 终局:「投资经理完成终审」「报告[最终结论] 5645 字符」「分析完成:8 份观点」「分析结束:耗时 178.1s」。
- web 网络面:`/llm-proxy/chat/completions` 19 次往返全 200、零非 2xx(AC-W3 的网络面佐证,排除 stub/演示路径)。
- 投资经理工具轮双端均触发多次 web_search 回滚重试(工具循环按设计工作)。
- 步数差异(47 vs 36)源于工具轮重试次数非确定性,两端终态语义一致。

## 执行通道

- web:`expo export --platform web` → `node --experimental-strip-types server.mjs`(127.0.0.1:8090)→ Chrome DevTools MCP 驱动(注入 localStorage `soa:settings` → reload → 点击「开始分析」)。
- 安卓:`gradlew assembleDebug` → adb 卸载重装(旧签名不兼容)→ `run-as` 写沙盒 `files/soa-settings.json`(expo-file-system `Paths.document`)→ Metro(8081,adb reverse)供 debug 包 bundle → adb input 驱动。

## Gotchas(供 spec 沉淀)

1. **chrome-devtools MCP 串行队列**:单个 `wait_for` 长超时会阻塞后续所有请求(客户端 30s 超时不取消服务端执行);长等待应改轮询 `evaluate_script`。
2. **安卓 debug 包不内嵌 bundle**:冷启动报「Unable to load script」,需 Metro + `adb reverse tcp:8081`;首次加载可白屏(Metro 惰性 chunk 构建中),force-stop 重启后正常。
3. **安卓系统通知权限弹窗**会冻结底层窗口渲染,截屏前需先关弹窗;uiautomator dump 是被遮挡时的权威状态来源。
4. **run-as 引号坑**:`adb shell run-as <pkg> sh -c 'a && b'` 复合命令引号易被剥,拆成单命令直传。
5. **旧签名残留**:模拟器上历史安装签名不匹配 → 先 `adb uninstall` 再装。

## 密钥残留位置(本机,均掩码于档案)

- Chrome MCP profile(localStorage `soa:settings`)——保留供后续 E2E。
- 安卓模拟器 app 沙盒 `files/soa-settings.json`——保留;`/data/local/tmp/soa-settings.json` 中转件已删。
- 内置 headless browser profile localStorage——保留(早期通道探测用)。

## Out of scope(未验)

iOS、release 签名产物、性能/视觉回归、settings UI 自动化深度测试、多 ticker/多市场矩阵、LLM 输出质量评估。
