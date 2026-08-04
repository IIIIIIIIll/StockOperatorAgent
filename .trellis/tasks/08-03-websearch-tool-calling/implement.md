# Implement: Web 搜索工具调用

Task: 08-03-websearch-tool-calling · 依据 design.md 执行

## 前置条件

- [ ] 全量回归基线确认：`python3 -m pytest test/ -q` → 220 passed / 20 skipped
      （2026-08-03 已实测；跑测试前先停运行中的应用，ZODB flock）
- [ ] `pip install langchain-community==0.4.2 ddgs==9.14.4`（dry-run 已实测无冲突）

## 实施清单（顺序）

1. **requirements.txt**：追加 `langchain-community==0.4.2`、`ddgs==9.14.4`
   （直接 import 的包必须 freeze——spec gotcha）。
2. **`core/llms/tools/web_search.py`**（新）：
   - `web_search_enabled()`（对齐 `get_market_intel._mcp_disabled()` 判定语义）
   - `make_web_search_tool(_searcher=None)`：DuckDuckGoSearchResults(cn-zh,
     max_results=5, json) → 中文摘要文本；失败/空 → 占位文本不 raise；
     `_searcher` 注入点。
3. **`core/llms/tool_loop.py`**（新）：`invoke_with_tools(...)`，复用
   `invoke_with_retry`；`_MAX_TOOL_ROUNDS = 10`（2026-08-04 用户拍板放宽，
   原 2 轮实测不收敛）；轮数耗尽 → 收尾轮（指令不再调工具）保底完整回答；
   safe_progress 前后打点；
   工具异常 → 占位 ToolMessage。
4. **3 个 agent**（bullish / bearish / investment_manager）：
   - 构造器加 `tools=None` 第 4 参 + bind_tools try/except NotImplementedError
   - 节点方法换 `invoke_with_tools`，返回 loop 全量 messages
5. **`core/llms/prompt.py`**：bullish / bearish 决策要求各加一行联网搜索提示
   （investment_manager 已有，不动）。
6. **`core/investment_committee.py`**：装配时 `web_search_enabled()` 判定，
   三个 agent 传 `tools`。
7. **测试**：
   - 新 `test/core/llms/tools/test_web_search.py`：开关（disabled → 不绑定/
     占位）、失败 → 占位、`_searcher` 注入成功路径（不碰网络）
   - 新 `test/core/llms/test_tool_loop.py`：stub LLM（脚本化 AIMessage：
     无 tool_calls 单轮 / 有 tool_calls 一轮 / 工具异常占位 / 轮数上限截断
     后收尾轮保底完整回答（断言"轮数已用尽"指令进入 payload）/ 显式
     max_tool_rounds / messages 序列正确性：human → AIMessage(tool_calls)
     → ToolMessage → final）
   - 既有 `test_graph_parallel.py` 必须保持全绿（FakeListChatModel 回退路径）

## 验证命令（每步后跑对应子集，最后全量）

```bash
python3 -m pytest test/core/llms/tools/test_web_search.py test/core/llms/test_tool_loop.py -q
python3 -m pytest test/integration/test_graph_parallel.py -q
python3 -m pytest test/ -q        # 全量：目标 = 基线 220 passed/20 skipped + 新测试
```

注意：跑全量前停掉运行中的应用（ZODB flock）；用规范字母序全量命令
（自拼模块组合存在既有顺序污染，非本任务引入）。

## 手动验收（AC1，可选）

```bash
WEB_SEARCH_DISABLED= python3 - <<'EOF'
# 用 make_web_search_tool() 直接调一次中文财经查询，确认 ddgs 实测可用
EOF
```

## 风险点 / 回滚点

- **ddgs SDK 反爬升级** → 失败已降级占位，图不中断；可切 backend 或换供应商。
- **DeepSeek function calling 异常行为**（工具轮次超限）→ `_MAX_TOOL_ROUNDS`
  兜底 + 占位文本；超限时返回最后响应不阻断。
- 回滚：`git revert`（纯增量特性）；即时停用：`WEB_SEARCH_DISABLED=1` + 重启。
- 每完成一个文件即跑该文件相关测试，避免大爆炸式合入。

## 完成前检查（trellis-check 门）

- [ ] spec 合规（agents spec：模板形状 / invoke 约定 / prompt 位置）
- [ ] lint / 类型检查（按项目惯例）
- [ ] 全量回归绿（停 app）
- [ ] 跨层检查：无 data_source / data_storage / data_structure / State 改动
- [ ] 完成后 trellis-update-spec：agents spec 增补"工具调用循环"小节 +
  tools 段（web_search.py / tool_loop.py）
