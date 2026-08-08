# 执行计划：配置面板（模型/密钥/开关全进网页）

## 实施清单（有序）

### Step 1 · 通用运行时覆盖层
- [ ] `utils/runtime_config.py`：`_RUNTIME` + `set_runtime_overrides` +
      `clear_runtime_overrides` + `runtime_bool(key, env_fallback)` +
      `runtime_int(key, env_fallback)`
- [ ] 消费点改造（公共 API 不变）：`web_search.py:34 web_search_enabled()`、
      `get_market_intel.py:32 _mcp_disabled()`、`billsions_config.py`
      `billions_enabled` / `billions_max_calls` 改读覆盖层
- [ ] 单测：覆盖优先级矩阵（TDX MCP/搜索/亿信 master/能力/上限）、默认空 →
      env 行为不变、env 隔离（set 前后 os.environ 不变）

**验证**：`python3 -m pytest test/utils/ test/core/llms/tools/ -q`

### Step 2 · .env 原子写
- [ ] `utils/env_file.py`：`UPDATE_WHITELIST` + `update_env_file(updates)`（读-
      改-写：白名单键原位替换/末尾追加、保留注释与顺序、tmp+os.replace 原子、
      失败清理、os.environ 同步、不 log 值）
- [ ] 单测：注释保留/顺序不变/白名单外键不动/新键追加带注释/原子性（注入
      写失败 → 原文件不变）/os.environ 同步/非法值（model 枚举、空 key）拒绝

**验证**：`python3 -m pytest test/utils/test_env_file.py -v`

### Step 3 · 设置面板（display.py）
- [ ] 侧边栏「设置」expander 4 节：模型与密钥（selectbox + 4 password +
      保存按钮）、LangSmith（toggle+key+project）、能力开关（6 toggle +
      置灰逻辑）、亿信上限（3 number）；caption 语义说明
- [ ] 提交处理：`set_runtime_overrides` 收集会话区 7 项，在
      `build_stock_information` 前调用
- [ ] 单测 test/core/ui/test_display.py：面板渲染（有/无亿信 key）、初始值
      = env 状态、保存 → update_env_file 调用参数、会话区同步调用、无 key
      置灰

**验证**：`python3 -m pytest test/core/ui/ -q`

### Step 4 · e2e
- [ ] `test/e2e/test_settings_panel.py`：保存模型/密钥 → 门控变化断言；
      会话开关切换（ANALYST 关 → 7 Tab）复用亿信用例；面板交互不触发
      零调用审计
- [ ] 既有 e2e 全绿（亿信 Tab 用例随 env 初始值不受影响）

**验证**：`python3 -m pytest test/e2e/ -v`

### Step 5 · 收尾
- [ ] 全量回归（无 streamlit 冲突）：`python3 -m pytest test/ -q`
- [ ] spec 更新：architecture.md（配置节 + utils 清单）、core/index.md
      （UI 节）、error-handling.md（env 写失败降级）、testing.md（基线）
- [ ] 提交 + 归档 + journal

## 验证命令

```bash
python3 -m pytest test/utils/ test/core/llms/tools/ test/core/ui/ -q
python3 -m pytest test/e2e/ -v
python3 -m pytest test/ -q      # 无 streamlit 运行中
```

## 风险与回滚点

| 步骤 | 风险文件 | 回滚点 |
|---|---|---|
| 1 | 三处消费点 | 覆盖层默认空 = 零行为变化；删除 runtime_config 即回滚 |
| 2 | `utils/env_file.py` | 独立模块；白名单+原子写防破坏 |
| 3 | `core/ui/display.py` | 面板区独立；提交同步点一行 |
| 4 | e2e | 新用例独立文件 |

## task.py start 前检查

- [ ] prd/design/implement 用户审阅通过（本任务范围已从"亿信开关"扩为
      "全配置面板"）
- [ ] 基线 0F/426P/20S 确认
