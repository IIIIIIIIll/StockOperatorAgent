# 执行计划：亿信 API 接入

## 实施清单（有序）

### Step 1 · 开关模块 + 客户端层
- [ ] `utils/billions_config.py`：`billions_enabled(cap)` / `billions_max_calls(cap, default)`
      （truthy 语义对齐 `WEB_SEARCH_DISABLED`：`("","0","false","no")`）
- [ ] `data_source/chinese_mainland/billions/client.py`：`BillionsClient` 4 方法 +
      `BillionsApiError`；`_http`/`_key` 注入；超时参数化（fin_db 120 / search 档位+10 /
      twitter 档位+10 / fetch 90）
- [ ] 单测 `test/data_source/test_billions_client.py`：注入 fake httpx 响应，golden 断言
      字段提取（result[].content、content[].title/link/date/extra）、错误归一化
- [ ] 单测 `test/utils/test_billions_config.py`：开关矩阵（key 缺失/总闸/能力闸/真值语义）

**验证**：`pytest test/data_source/test_billions_client.py test/utils/test_billions_config.py -v`

### Step 2 · fin-db 前置槽位
- [ ] `core/llms/tools/billions_fin_db.py`：`get_billions_financial_intel(ticker, _client=None)`
      → 开关关返回空串；失败返回占位段
- [ ] `investment_committee.py:38-49` `build_stock_information` 追加第 5 段（注入参数
      `_billions_intel=None` 对齐现有注入风格）
- [ ] 单测：开关关 → 空串；开 → 文本拼入 stock_information；client 失败 → 不抛、无污染

**验证**：`pytest test/core/ -v`（相关用例）+ 新单测

### Step 3 · LLM 工具三件套
- [ ] `core/llms/tools/billions_search.py` / `billions_twitter.py` / `billions_fetch.py`：
      仿 `web_search.py` 形状（`_client` 注入、懒导入、失败占位、闭包计数上限
      默认 3/2/3、env 覆盖）
- [ ] `investment_committee.py:74` tools 列表按开关扩展（`web_search_enabled()` 同位置）
- [ ] 单测：注入 fake client 断言工具输出与计数上限、超限占位、开关关不绑定

**验证**：`pytest test/core/ test/integration/ -v`

### Step 4 · 信息面分析师
- [ ] `utils/state.py` 增加 `information_analysis: str`
- [ ] `core/llms/prompt.py` 增加信息面分析师 system prompt
- [ ] `agents/chinese_mainland/information_analyst.py`：复制 expert 模板；node 内确定性
      预抓（announcement/report/web/twitter 各 1 次，fast/count=5/past 3 months，
      按开关过滤源、失败跳过）+ 单次 LLM 总结
- [ ] `investment_committee.py:108-123` 条件接线：ANALYST 开 → 添加节点 + 4 入边 join
      （traders）；关 → 不添加（与现状同构）
- [ ] `test/integration/test_graph_parallel.py`：`_RoutedLlm` 增加分析师 prompt 路由；
      两种图形态（3/4 专家并行）均覆盖
- [ ] 单测 `test/agents/test_information_analyst.py`：`_llm` 注入 + fake client，
      断言检索序列与报告结构

**验证**：`pytest test/agents/ test/integration/test_graph_parallel.py -v`

### Step 5 · UI 与 e2e 镜像
- [ ] `display.py:34-41` REPORT_TABS/REPORT_TITLES 改条件函数（ANALYST 开关）
- [ ] **`core/ui/data_markdown.py:186-196` `iter_sections` 注册 `【亿信金融数据库】` marker**
      （check 发现：不注册则该段并入情报节渲染；仿 `【实时市场情报】` 模式）
- [ ] **`test/core/test_committee_enrichment.py:30` 加 `BILLIONS_*` env 清除**
      （check 发现：开发者导出 key 后该"离线"测试会触发真实网络调用）
- [ ] `test/e2e/mock_committee.py` MOCK_REPORTS 增加 `information_analysis`
- [ ] `test/e2e/conftest.py` 注入 dummy `BILLIONS_API_KEY`；零真实调用审计断言
      增加"无亿信调用标记"；无 key e2e 用例断言新 Tab 不存在

**验证**：`pytest test/e2e/ -v`（mock 模式秒级）

### Step 6 · 收尾
- [ ] `.env.example` 增加 `BILLIONS_API_KEY` 与全部开关注释
- [ ] 全量回归（无 `streamlit run main.py` 运行中）：`python3 -m pytest test/ -q`
- [ ] spec 更新（data_source/core/agents 索引 + 新亿信约定）+ 提交：
      **error-handling.md 将 BillionsClient 列入 wrapper-source 例外**（check 建议：
      与 TdxSource 抛 ValueError 同构，由调用方捕获转换）

## 验证命令

```bash
python3 ./.trellis/scripts/get_context.py --mode packages   # 确认 spec 层
pytest test/data_source/test_billions_client.py test/utils/test_billions_config.py -v
pytest test/core/ test/agents/ test/integration/test_graph_parallel.py -v
pytest test/e2e/ -v          # mock 模式秒级、零 token
pytest test/ -q              # 全量（无 streamlit 运行时，ZODB flock）
```

## 风险与回滚点

| 步骤 | 风险文件 | 回滚点 |
|---|---|---|
| 2 | `core/investment_committee.py` | 仅追加段，去掉 `_billions_intel` 注入即回滚 |
| 3 | `core/investment_committee.py:74` | tools 列表恢复原状 |
| 4 | `utils/state.py`、`investment_committee.py` 图结构 | ANALYST 开关关即回滚；单步提交 |
| 5 | `display.py` REPORT_TABS 契约、e2e 镜像 | 条件函数返回原列表 |
| 全期 | `.env` | `BILLIONS_DISABLED=true` 一键全关 |

## task.py start 前检查

- [ ] prd.md / design.md / implement.md 用户审阅通过（最终规划摘要已呈现）
- [ ] implement.jsonl / check.jsonl 已含真实 spec/research 条目（种子行已删除）
- [ ] 全量测试基线 0F/308P/20S 确认
