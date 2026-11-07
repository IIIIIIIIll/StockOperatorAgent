# 2026-11-07 评审整改清单

> 来源：`docs/code-review-2026-11-07.md`（2 P0 / 5 P1 / 47 P2）。
> 策略：master 分 6 批提交，每批跑 `typecheck + vitest` 后提交。
> 状态：`[ ]` 待做 · `[x]` 已完成 · `[~]` 部分/改判。

## B1 · P0 数据正确性

- [x] CR-00 港美股 60 日涨跌幅取上市首日 → `slice(-61)`
- [x] CR-01 业绩 QoQ 累计口径 → 单季还原后再算

## B2 · P1 安全 / 合规 / 发布

- [x] CR-02 MCP/亿信代理客户端补 `X-SOA-Token`
- [x] CR-05 `app.json` 增 `android.versionCode` + 本地发布脚本版本守卫
- [x] CR-06 隐私政策权限章节改为事实清单
- [x] CR-07 `allowBackup=false` + 备份规则
- [x] CR-08 跨 host 重定向剥离 `Authorization`

## B3 · 核心编排 / 存储 / UI 行为

- [x] CR-20 expert 空内容兜底
- [x] CR-21 `done` 增 `degraded`
- [x] CR-22 `abort()` 用例 + 注释
- [x] CR-23 取消边界写入 spec/注释
- [x] CR-24 `web_search` 调用上限（已改为可配置：面板「工具调用上限」+ `WEB_SEARCH_MAX_CALLS`，1..20）
- [x] CR-28 hydrate 失败可见信号
- [x] CR-29 归档索引与正文对账
- [x] CR-30 设置原子写
- [x] CR-31 `getExpoBackend` 按目录缓存
- [x] CR-03 历史 load 代数门
- [x] CR-35 ErrorBoundary 随 Tab 复位
- [x] CR-36 校验失败同步 market
- [x] CR-37 设置面板 URL scheme 校验
- [x] CR-38 inflate 输出上限

## B4 · 构建 / CI / 工具 / 许可证

- [x] CR-04+40 提交内联 tsconfig + desktop build 恢复步骤
- [x] CR-41 probe 失败退出码 + 清旧报告
- [x] CR-42 6→5 mutator 文档
- [x] CR-43 release workflow 加测试 job
- [x] CR-44 README Node 版本
- [x] CR-55 发布脚本密钥暂存硬化
- [x] CR-56 签名缺失守卫
- [x] CR-57 镜像决策记录
- [x] CR-58 许可证统一 GPL-3.0-or-later

## B5 · 图表 / spec / 测试规范 / 隐私文本

- [x] CR-33 财务图 spec 折线→柱状
- [x] CR-34 涨跌幅图例色/同名 chip
- [x] CR-32 StoreLike 10 方法 + 悬空注释
- [x] CR-45 架构断言 7→8
- [x] CR-46 代理路由表补全
- [x] CR-47 `LAST_RUN_KEY` 钉死
- [x] CR-48 架构断言 2 正则
- [x] CR-49 useAnalysis 胶水测试
- [x] CR-50 测试 env 还原
- [x] CR-60 隐私政策补 Yahoo/Finnhub
- [x] CR-62 隐私政策日志条件说明

## B6 · 其余加固

- [x] CR-09 device-collect 去 `vi.mock`
- [x] CR-10 Yahoo 代理载荷形状门
- [x] CR-25 volume 缺失不伪造 0 → `DailyBar.volume` 改 `number | null`（null = 数据源未知），贯通四族 store/采集/概览/图表/pipeline；`isBar` 放行 null；换手率与概览走 NaN（显示 N/A）
- [x] CR-26 quoteSummary 状态码
- [x] CR-27 F10 内容长度守卫
- [x] CR-39 keepalive 走 log.ts
- [x] CR-51 SEC_HEADERS 单源/等值断言
- [x] CR-52 web-search 定时器清理
- [x] CR-53 GET 代理 Origin/来源判据
- [x] CR-54 billions query 转发
- [x] CR-59 token 公开性文档
- [x] CR-61 `.gitignore` keystore 通配（备注级）
- [x] CR-63 12 处未使用符号
