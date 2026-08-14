# 00-final-audit：phaseout 收尾核验汇总

> 任务：08-14-phaseout-final-audit ｜ 2026-08-14
> 方法：4 只读 scout 并行（残留引用/持久化语义/TS 功能完整/交付物文档）→ 主 agent 汇总去重 → dispatch 修复 REAL。

## 结论

**TS 运行面零 Python 依赖，无结构性遗漏**。4/4 BLOCKER 闭环、MISSING 0、C1-C8 全按决策落地、持久化四族语义对齐、freshness 跨会话生效。核验发现 **10 项 REAL（全部低危文档/spec/单行）**，已修复；OBS 记录在案。

## REAL 修复清单（10 项）

| # | 位置 | 问题 | 处置 |
|---|---|---|---|
| R1 | .trellis/spec/index.md | 顶层导航仍描述 Streamlit+LangGraph+akshare+ZODB+Qwen；Python 分层未标历史 | 改为 TS 单一实现描述；Python 层合并为 Historical (archived)；示例路径更新 |
| R2 | .trellis/spec/guides/ 3 份 | 会话注入指引仍教 pytest/display.py/akshare/ZODB 已删物 | 加历史归档 banner；UI 验证指引改 vitest/tsc |
| R3 | ts/index.md | 缺「持久化后 freshness 跨会话」契约 | 补持久化 bullet（store-idb/file、写穿透、storeReady、跨会话门） |
| R4 | ts/index.md | .streamlit/config.toml 处置未留档 | 状态块注明保留待用户决策 |
| R5 | .env.example:3 | 指向已删 utils/runtime_config.py | 改指 ts/src/webSearch.ts envDisabled / committee.ts envDisabledBool |
| R6 | .env.example:28-29 | 「缺失任一不渲染分析区」过时（实际 demo 占位跑通） | 改为 demo 占位语义 |
| R7 | .env.example:50-52 | LANGSMITH 上报声称但 TS 未接入 | 改为「仅持久化未接线」 |
| R8 | .env.example:54-55 | ENV_FILE_PATH 残留（BY_DESIGN 应随删） | 删除 |
| R9 | ts/app/.env.example:7 | EXPO_PUBLIC_TAVILY_API_KEY 与消费点前缀不符 | 注明 Tavily 仅 Node 路径/浏览器走代理，删除或注释 |
| R10 | ts/src/store-memory.ts:45-47 | replaceDatas 空输入清库（08-13 已知 INFO 未修） | 空早退提前到 delete 前；补测试 |

## OBS 记录（观察，非缺陷）

- 磁盘残留（database 312MB/logs 6.6MB/data tdx_cache）gitignored，待用户清理决策
- .streamlit/config.toml 保留待决策；export_fixtures.py 悬空冻结成立（决策留档齐全）
- getStock 返回别名引用（内存三族）；乱序输入 lastDataUpdate 非 max（升序契约）；close() 后 mutator 静默复活；ready 失败永久缓存无重试；FileStore 单文件损坏整 hydrate 失败；flush 仅覆盖调用时刻队列；runner.ts:66 陈旧注释
- README Node ≥22 实为 ≥22.6；export_fixtures.py docstring 旧路径；根 .gitignore 陈旧条目（bin/include/lib64/pyvenv.cfg/developing-with-streamlit）
- 历史分层 spec 无独立归档 banner（ts/index.md 单点声明覆盖）；.backup-2026-08-09/ 备份
- TS 代码「移植自 Python」注释 40 处为设计溯源，非遗漏

## 验证

- 修复后：vitest 全绿 + tsc 0 错误（FixAuditReal 报告）
- 核验范围：4 scout 报告见各 agent artifact（01-refs / 02-persist / 03-ts-complete / 04-deliverables）
