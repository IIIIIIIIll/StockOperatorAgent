# 设计：配置面板（模型/密钥/开关全进网页）

## 架构与边界

```
utils/runtime_config.py   ← 通用运行时覆盖层（新建，核心）
    _RUNTIME: dict[str, bool | int]
    set_runtime_overrides(dict) / clear_runtime_overrides()
    runtime_bool(key, env_fallback) / runtime_int(key, env_fallback)

utils/env_file.py         ← .env 原子写（新建）
    UPDATE_WHITELIST: frozenset[str]
    update_env_file(updates) -> bool    # 读-改-写 + os.replace + os.environ 同步

core/ui/display.py        ← 侧边栏「设置」面板（分 4 节）
    write_ui() 内 st.sidebar.expander
    提交处理：set_runtime_overrides(session_state 会话级项)

消费点改造（公共 API 不变，内部改读覆盖层）：
    web_search.py:34      web_search_enabled()      → runtime_bool("WEB_SEARCH_ENABLED", env判定)
    get_market_intel.py:32 _mcp_disabled()          → runtime_bool("TDX_MCP_ENABLED", env判定) 取反
    billsions_config.py   billions_enabled/max_calls → 覆盖优先，env 兜底
```

## 覆盖层键表（set_runtime_overrides 接受的键）

| 键 | 类型 | 语义 |
|---|---|---|
| `TDX_MCP_ENABLED` | bool | True=开 MCP，False=关（覆盖 env TDX_MCP_DISABLED） |
| `WEB_SEARCH_ENABLED` | bool | 同上（覆盖 env WEB_SEARCH_DISABLED） |
| `BILLIONS_MASTER` | bool | False=亿信全关；True=不强制（未覆盖项走 env） |
| `BILLIONS_{FINDB,SEARCH,TWITTER,FETCH,ANALYST}` | bool | 覆盖 env 能力闸 |
| `BILLIONS_{SEARCH,TWITTER,FETCH}_MAX_CALLS` | int | 覆盖 env 上限（非法值回退 env/默认） |

优先级（billions_enabled 语义，其余同理）：无 key 硬约束 → 覆盖 → env 兜底。
覆盖层默认空 → 消费点全部走 env → 与现状逐字节一致（AC1）。

## .env 原子写（env_file.py）

```
read .env（保留行序/注释/空白）→ 对白名单键：存在则原位替换值、不存在则
  末尾追加（带简短注释行）→ 写 tmp（同目录 .env.tmp.<pid>）→ os.replace
  原子替换 → 成功后 os.environ[key]=value 同步（立即生效）→ 失败清理 tmp
```

- **只动白名单键**：DEEPSEEK_API_KEY/MODEL、DASHSCOPE_API_KEY、TDX_API_KEY、
  BILLIONS_API_KEY、LANGSMITH_TRACING/API_KEY/PROJECT——用户手写键
  （TDX_MCP_DISABLED 等）零改动
- 值校验：model ∈ {flash, pro}；密钥非空字符串；TRACING 布尔化
- 不 log 写入值（logging spec）；返回 bool + 错误信息供 UI 提示
- 并发提示（非阻断）：用户 IDE 若打开 .env 且有未保存缓冲，其保存会覆盖
  UI 写入——UI caption 提示「保存前请先保存/关闭 IDE 中的 .env」

## 面板布局（display.py 侧边栏）

```
▸ 设置
  ├─ 模型与密钥（持久化）        [selectbox 模型] [password DeepSeek]
  │     [password DashScope] [password TDX] [password 亿信] [保存按钮]
  ├─ LangSmith（持久化）         [toggle 追踪] [password key] [text project]
  ├─ 能力开关（会话级）          [toggle TDX MCP] [toggle 联网搜索]
  │     [toggle 亿信总闸] [5×toggle 能力]（无 key/总闸关 → 置灰）
  ├─ 亿信调用上限（会话级）      [number 3×]
  └─ caption：持久化/会话级语义说明
```

- widget 用稳定 `key=`（session_state 持久）；会话区初始值 = env 有效状态
- 持久化区保存按钮 → `update_env_file` → st.success/error 提示；
  密钥输入框 type="password"（不明文回显，AC3）
- **保存后 `_has_deepseek_key` 即时通过**（os.environ 已同步，display 门控
  读 os.environ——evidence：display.py:17-24）
- 提交处理在 `build_stock_information` 前：`set_runtime_overrides` 收集
  会话区 6 开关 + 3 上限（不收集持久化区——那已落 env）

## 兼容与迁移

- 覆盖层默认空 → 零行为变化；既有 118 亿信测试不动全绿
- billsions_config 的 `_RUNTIME_OVERRIDES`（上任务设计）未落地（本任务
  直接以通用层实现，无迁移包袱）
- LangSmith TRACING 持久化是唯一"开关持久化"例外（遥测配置，防止重载
  意外重开追踪），design 记录在案
- e2e：mock 模式设置面板可真实交互（FakeGraph 不动）；零调用审计不受
  影响（面板保存只写 .env/覆盖层，不触发网络）

## 关键权衡

| 决策 | 选择 | 权衡 |
|---|---|---|
| 持久化分界 | 密钥/模型/LangSmith 持久化；开关/上限会话级 | 密钥落地重启保留；开关重载复位 = 成本兜底 |
| .env 写入 | 原子 replace + 白名单键 | 防半写文件/破坏手写配置；并发 IDE 编辑风险已提示 |
| 生效时机 | os.environ 同步立即生效（持久化）；下次提交生效（会话级） | 密钥/模型无需重启；开关语义与装配时机一致 |
| 密钥回显 | password 框 | 不明文；无法"看到旧值"是特性（防肩窥） |

## 回滚

- 覆盖层/env_file 均为新独立模块，删除即回滚；消费点改造单行级
- .env 写入有白名单 + 原子性；误写 = 重新保存正确值即可恢复
- e2e 新用例独立文件

## 风险文件

- `core/ui/display.py`（面板 + 提交同步，最大改动面）
- `utils/runtime_config.py` / `utils/env_file.py`（新建核心）
- `web_search.py` / `get_market_intel.py` / `billsions_config.py`（消费点）
- `test/e2e/`（交互用例 + 零调用审计）
