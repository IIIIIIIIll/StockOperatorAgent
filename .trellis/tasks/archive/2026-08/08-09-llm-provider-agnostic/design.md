# Design：LLM 服务去供应商化

## 架构与边界

```
env (LLM_API_KEY / LLM_MODEL / LLM_BASE_URL [+ LLM_REASONING_EFFORT 可选])
  └─ core/llms/llm_factory.py  make_llm() -> ChatOpenAI     ← 单一构造点
       └─ core/investment_committee.py  llm = _llm or make_llm()
UI 侧（core/ui/display.py）:
  _llm_configured() 门控（三键齐全）→ 设置面板（模型/Base URL/Key 持久化）
    └─ utils/env_file.py  UPDATE_WHITELIST + 校验（必填 + URL 格式）
```

**边界原则**：`make_llm()` 是全库唯一 ChatOpenAI 构造点；供应商专属参数
（reasoning_effort、extra_body）一律不内置于工厂——`LLM_REASONING_EFFORT`
设了才透传，extra_body 彻底不提供（Qwen 私有参数随死代码删除）。

## 模块设计：`core/llms/llm_factory.py`

```python
def make_llm() -> ChatOpenAI:
    """通用 OpenAI 兼容 LLM 工厂（唯一构造点）。

    - LLM_API_KEY  必填非空；LLM_MODEL 必填非空；
      LLM_BASE_URL 必填且 http:// 或 https:// 开头（格式级校验，
      不做网络可达性探测）
    - 缺失/非法 → ValueError，消息列出问题键（可读，供 UI/CLI 提示）
    - seed=114514 恒定（与旧 DeepSeekApi 行为一致）
    - LLM_REASONING_EFFORT 可选：设了才传 reasoning_effort
      （DeepSeek 用户配 max 保持现状；空/未设 → 不传，任意兼容服务安全）
    """
```

- 不传 `extra_body`（无供应商私有参数）
- 无 key 构造即失败语义保留（旧 DeepSeekApi 无 key 构造抛 OpenAIError；
  现在改为更可读的 ValueError——UI 门控在渲染前拦截，构造失败只发生在
  非 UI 调用路径）
- 删除 `core/llms/deepseek/` 目录（文件迁为工厂后不留空壳）

## 装配接线（core/investment_committee.py）

- 删 `from core.llms.deepseek.deepseek_api import DeepSeekApi`，
  改 `from core.llms.llm_factory import make_llm`
- `llm = _llm or make_llm()`（line 101 原样语义，`_llm` 测试注入点不变）
- line 94 docstring 同步（默认 LLM 描述 → 通用 OpenAI 兼容配置）

## UI（core/ui/display.py）

- **门控改名**：`_has_deepseek_key` → `_llm_configured()`——三键齐全
  （LLM_API_KEY / LLM_MODEL / LLM_BASE_URL 均存在且非空）才放行渲染；
  缺失 → st.error（line 373 文案同步：列出缺失键）
- **面板（模型与密钥节）**：
  - `settings_model`：selectbox（2 选项）→ `st.text_input` 自由文本
  - 新增 `settings_llm_base_url`：`st.text_input`（非密码，placeholder
    提示 http(s):// 前缀）
  - `settings_deepseek_key` → `settings_llm_key`（password，placeholder
    语义保留"已配置（留空表示不修改）"）
  - 删除 `settings_dashscope_key` 字段
- **`_collect_persisted_updates`**：`LLM_MODEL` = settings_model（非空校验
  交给 env_file，面板空值保存 → st.error）；`LLM_BASE_URL` =
  settings_llm_base_url；`LLM_API_KEY` = settings_llm_key
- **`_PERSISTED_PASSWORD_WIDGETS`**：settings_llm_key → LLM_API_KEY；
  其余（TDX/BILLIONS/LANGSMITH）不动

## env_file.py

- `UPDATE_WHITELIST`：DEEPSEEK_API_KEY / DEEPSEEK_MODEL / DASHSCOPE_API_KEY
  → LLM_API_KEY / LLM_MODEL / LLM_BASE_URL（白名单仍 8 键）
- `_MODELS` 枚举校验删除（自由文本）；新增：
  - `LLM_MODEL`：非空（_KEY_KEYS 类语义，但非密钥——独立分支）
  - `LLM_BASE_URL`：非空且 `startswith(("http://", "https://"))`；
    非法 → `LLM_BASE_URL 必须以 http:// 或 https:// 开头`
- `_KEY_KEYS`：LLM_API_KEY 取代原两键；`_NEW_KEY_COMMENTS` 同步
- 校验失败返回消息只含键名不含值（R6 密钥纪律不变）

## 文档

- `.env.example`：LLM 节重写——LLM_API_KEY / LLM_MODEL（任意模型名，
  例 deepseek-v4-flash、gpt-4o、qwen-plus-latest）/ LLM_BASE_URL（任意
  OpenAI 兼容 endpoint）+ LLM_REASONING_EFFORT 注释（可选）+ 迁移说明
  （旧 DEEPSEEK_* 键映射：DEEPSEEK_API_KEY→LLM_API_KEY、
  DEEPSEEK_MODEL→LLM_MODEL、DEEPSEEK_BASE_URL→LLM_BASE_URL；
  DASHSCOPE_API_KEY 删除）
- `README.md:16`：配置段改 LLM_* 三键 + 迁移提示

## 测试面

- `test/core/llms/deepseek/test_deepseek_api.py` → 重写为
  `test/core/llms/test_llm_factory.py`：
  - 三键齐 → model/base_url/key 正确传入、seed=114514
  - 缺 key / 缺 model / 缺 base_url → ValueError，消息含缺失键名
  - base_url 非 http(s) 前缀 → ValueError
  - LLM_REASONING_EFFORT 未设 → 不传；设了 → 传
- `test/core/llms/qwen/` 删除
- `test/core/ui/test_display.py`：门控测试改 LLM_* 三键矩阵
  （全齐放行 / 缺任一拦截）；面板收集测试改新 widget/键
- `test/utils/test_env_file.py`：白名单用例换 LLM_*；新增 base_url
  格式校验用例（合法 http(s) 通过、裸 "api.deepseek.com" 拒绝）
- `test/e2e/conftest.py:72-73,229,258` 与 `test/e2e/mock_app.py:9-12`：
  dummy 注入改 `LLM_API_KEY` + `LLM_MODEL` + `LLM_BASE_URL` 三键
  （门控现在要求三键齐全）
- `test/e2e/test_settings_panel.py`：面板流程改新字段
  （模型自由文本 + Base URL 输入 + LLM API Key）

## 兼容与迁移

- **破坏性变更（用户已拍板）**：旧 .env 的 DEEPSEEK_* 不再生效——README /
  .env.example 提供手动迁移映射；不写自动迁移代码
- UI 保存键名变化：旧用户 .env 里的 DEEPSEEK_MODEL 等保留为无关键
  （白名单外不写不删，符合"只动白名单键"纪律）
- `_llm` 测试注入点签名不变，离线图测试零改动

## 权衡记录

- 必填强校验（R5）vs 零配置友好：用户拍板必填——代价是首次使用必须
  填三键，收益是永不静默指向错误供应商
- ValueError vs 旧 OpenAIError：构造失败路径非 UI 即测试，更可读的消息
  优先；retry.py 只捕获 invoke 期 openai 错误，不受影响

## 回滚

- 单提交落地；回滚 = `git revert` 该提交（测试全量回归兜底）
- 风险文件：`core/ui/display.py`（门控 + 面板）、`utils/env_file.py`
  （校验）、`test/e2e/conftest.py`（env 注入——漏改则 e2e 全红）
