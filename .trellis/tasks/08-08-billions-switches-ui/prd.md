# 配置面板：模型/密钥/开关全部进网页

## Goal

侧边栏「设置」面板承载**全部应用配置**（用户 2026-08-08 明确：把所有配置都
做进网页）：模型与密钥（DeepSeek 模型/全部 API 密钥/LangSmith）**持久化**
——UI 保存原子写 `.env` 并同步 os.environ，立即生效且重启保留；能力开关
（TDX MCP/联网搜索/亿信总闸+5 能力）与亿信调用上限**会话级**——运行时
覆盖层，本次会话生效，重载恢复 `.env` 值。

## Background / Confirmed Facts

- 亿信开关交互化（08-08-billions-switches-ui 原规划）已获用户批准，现并入本
  任务全配置范围
- 装配时机：`build_stock_information` 与 `make_investment_committee` 每次
  表单提交执行（display.py:149/186）；TDX MCP 开关在**调用时**判定
  （get_market_intel.py:32）、联网搜索在**装配时**判定（web_search.py:34）、
  亿信开关在装配+调用时判定——会话级覆盖层需被三处消费点读取
- 密钥读取点：`DeepSeekApi` 构造（DEEPSEEK_API_KEY/MODEL）、
  `get_market_intel`（TDX_API_KEY）、`BillionsClient`（BILLIONS_API_KEY）、
  `QwenApi`（DASHSCOPE_API_KEY）；UI 仅 `_has_deepseek_key` 门控
  （display.py:17-24，读 os.environ）——**os.environ 同步后 UI 门控立即
  生效**，无需重启
- `.env` 当前含用户手写配置（TDX_MCP_DISABLED=1 等）；用户 IDE 可能打开
  `.env`（并发编辑风险需提示）

## Requirements

- **R1 通用运行时覆盖层**（`utils/runtime_config.py` 新建，亿信专用覆盖从
  billsions_config 迁出/泛化）：`set_runtime_overrides(dict)` /
  `clear_runtime_overrides()`；键表：`TDX_MCP_ENABLED`、`WEB_SEARCH_ENABLED`、
  `BILLIONS_MASTER`、`BILLIONS_{FINDB,SEARCH,TWITTER,FETCH,ANALYST}`、
  `BILLIONS_{SEARCH,TWITTER,FETCH}_MAX_CALLS`；优先级 = 覆盖 → env 兜底；
  覆盖层默认空 → 现有行为零变化
- **R2 消费点改造**：`web_search_enabled()`（web_search.py:34）、
  `_mcp_disabled()`（get_market_intel.py:32）、`billions_enabled` /
  `billions_max_calls`（billsions_config.py）改读覆盖层（公共 API 不变）
- **R3 .env 原子写**（`utils/env_file.py` 新建）：`update_env_file(updates:
  dict)`——读-改-写：**只更新白名单键**（现有键原位改值，新键追加末尾），
  保留注释与无关键与顺序；tmp 文件 + `os.replace` 原子替换；写入后同步
  os.environ；白名单 = DEEPSEEK_API_KEY/DEEPSEEK_MODEL/DASHSCOPE_API_KEY/
  TDX_API_KEY/BILLIONS_API_KEY/LANGSMITH_TRACING/LANGSMITH_API_KEY/
  LANGSMITH_PROJECT
- **R4 设置面板**（display.py 侧边栏「设置」expander，分节）：
  - **模型与密钥（持久化）**：DEEPSEEK_MODEL selectbox（flash/pro）、4 个
    password 输入（DeepSeek/DashScope/TDX/亿信，预填当前值）+ 「保存」按钮
    → `update_env_file` + 成功/失败提示；保存后 `_has_deepseek_key` 门控
    即时通过
  - **LangSmith（持久化）**：TRACING toggle + key + project（开发者遥测
    配置，持久化例外——否则每次重载意外重开追踪）
  - **能力开关（会话级）**：TDX MCP、联网搜索、亿信总闸 + 5 能力 toggles
    （初始值 = env 有效状态；无 key/总闸关 → 置灰）
  - **亿信调用上限（会话级）**：3 个数字输入（search/twitter/fetch，
    默认 env 值）
  - caption：持久化区「保存后立即生效并写入 .env」；会话区「下次分析生效，
    重新加载恢复 .env」
- **R5 会话同步**：表单提交前 `set_runtime_overrides(从 session_state 收集
  开关与上限)`（仅会话级项）
- **R6 密钥纪律**：密码输入框（不明文回显）；任何路径不 log 密钥值；
  `update_env_file` 不 log 写入值
- **R7 测试**：覆盖层优先级矩阵 + env 隔离；env_file 原子写（含注释保留、
  顺序不变、白名单外键不动、并发文件内容快照模拟）；面板渲染/同步；
  e2e：保存密钥 → 门控变化、会话开关切换 Tab 显隐、零调用审计

## Out of Scope

- 能力开关/上限的持久化（会话级语义，重载复位——成本兜底）
- .env 白名单外键的编辑（防止 UI 破坏用户手写配置）
- 多会话共享配置（Streamlit 单会话）
- 密钥变更后对已构造 client 的热更新（下次装配/调用自然生效）

## Acceptance Criteria

- [ ] AC1 覆盖层：默认空 → 全链路行为与现状逐字节一致（既有 426 测试零回归）；
      覆盖项优先于 env；无 BILLIONS_API_KEY 时亿信覆盖无效（主闸硬约束）
- [ ] AC2 env 原子写：白名单键更新后 .env 注释/顺序/无关键不变；tmp+replace
      原子性（写失败不留残文件）；os.environ 同步即时生效
- [ ] AC3 面板渲染：有/无亿信 key 两态；密码框不回显明文；会话区初始值 =
      env 有效状态
- [ ] AC4 持久化生效：UI 改 DEEPSEEK_MODEL/任意密钥 → 保存 → 同会话后续
      run 用新值（os.environ 同步），重启后 .env 值保留
- [ ] AC5 会话开关：TDX MCP/联网搜索/亿信总闸/能力/上限切换 → 下次提交
      生效；重载恢复 env；不写 os.environ（会话区）
- [ ] AC6 e2e：设置面板交互用例（保存密钥 + 开关切换 Tab 显隐）全绿 +
      零调用审计通过；全量回归零新增失败
