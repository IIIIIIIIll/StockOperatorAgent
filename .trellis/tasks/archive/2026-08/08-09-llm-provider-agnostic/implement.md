# Implement：LLM 服务去供应商化

## 执行顺序（依赖驱动）

### 1. 工厂：`core/llms/llm_factory.py`（新建）
- `make_llm() -> ChatOpenAI`：三键校验（必填 + URL 格式）+ seed=114514 +
  可选 LLM_REASONING_EFFORT
- 删除 `core/llms/deepseek/` 目录
- 删除 `core/llms/qwen/` 目录与 `test/core/llms/qwen/`
- **验证**：`pytest test/core/llms/ -v`（先删旧测试再写新测试会红——
  顺序：写新测试文件 → 删旧测试 → 全绿）

### 2. 装配：`core/investment_committee.py`
- import 与 `llm = _llm or make_llm()` + docstring
- **验证**：`pytest test/integration/ test/core/test_committee_enrichment.py -v`
  （离线图测试用 `_llm` 注入，应零改动全绿）

### 3. 校验层：`utils/env_file.py`
- 白名单三键替换 + LLM_MODEL 非空 + LLM_BASE_URL http(s) 校验 + 注释
- **验证**：`pytest test/utils/test_env_file.py -v`

### 4. UI：`core/ui/display.py`
- 门控 `_llm_configured()` + 面板（自由文本模型 / Base URL / LLM Key）+
  收集逻辑 + st.error 文案
- **验证**：`pytest test/core/ui/test_display.py -v`

### 5. e2e 层：`test/e2e/conftest.py` + `test/e2e/mock_app.py`
- dummy 注入改三键
- **验证**：`pytest test/e2e/test_settings_panel.py -v`（mock 模式秒级）

### 6. 文档：`.env.example` + `README.md:16`
- LLM_* 三键 + 迁移映射说明

### 7. 全量回归
- `pytest -v` 全量（含 e2e）；grep 验证零残留：
  `grep -rn "DEEPSEEK\|DASHSCOPE\|DeepSeekApi\|QwenApi" --include="*.py" --include="*.md" --include="*.env*" . | grep -v .trellis`

## 关键命令速查

| 阶段 | 命令 |
|------|------|
| 离线单测 | `pytest test/core/llms/ test/utils/test_env_file.py test/core/ui/test_display.py -v` |
| 集成 | `pytest test/integration/ -v` |
| e2e mock | `pytest test/e2e/ -v` |
| 全量 | `pytest -v` |

## 风险文件与回滚点

| 文件 | 风险 | 对策 |
|------|------|------|
| `core/ui/display.py` | 门控 + 面板双改，e2e 依赖 | 阶段 4 单跑 display 测试 |
| `utils/env_file.py` | 校验规则变化 | 阶段 3 单跑 env_file 测试 |
| `test/e2e/conftest.py` | 漏改注入键 → e2e 全红 | 阶段 5 单独验证 |
| 旧测试删除 | 先删后写会短暂红 | 新测试文件先落，旧文件后删 |

每阶段绿 → 进入下一阶段；任一阶段红 → 停在当前阶段排查（回滚点 =
上一绿阶段）。

## task.py start 前检查

- [ ] prd.md / design.md / implement.md 已获批（最终规划摘要用户已确认）
- [ ] 上述 7 个阶段顺序明确
