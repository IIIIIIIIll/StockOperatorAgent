# 设计：Agent 基类（7× 模板公共管道去重）

## 架构与边界

```
agents/base.py（新建）—— AgentNode 基类：**不变项**收敛
    __init__(llm, config, progress_updater=None, tools=None, *, role_message)
        prompt 壳 + {system_message}/{current_date} partials
        bind_tools NotImplementedError 回退（FakeListChatModel 兼容）
        self.llm = self.prompt | llm；存 config/progress_updater/tools
    build_chain(role_message, llm=None)      —— 第二链（trader 的 revise 链）
    complete_expert(query_text, state_key, *, start_msg, done_msg, log_label)
        —— 专家骨架：safe_progress → invoke_with_retry → push_report →
           {"messages": [query[0], response], key: content}
    complete_with_tools(query_text, state_key, *, chain=None, max_tool_rounds=None,
                        start_msg, done_msg, log_label)
        —— 工具角色骨架：invoke_with_tools（revise 用 chain=self.revise_llm、
           max_tool_rounds=3）→ push_report → {"messages": 全量, key: content}
    info_section(state)                      —— 信息面条件段（3× 复制的 4 行）

core/llms/tools/_items.py（新建）—— collect_content_items(data) -> list[dict]
    result[].content[] 条目收集（非 dict 跳过，字段缺失容错）——3 处收敛
    （billions_search/billions_twitter/information_analyst）

core/llms/tools/_capped.py（新建）—— capped_call(counter, max_calls, label,
    fail_label, fn, *args, **kw) -> str
    亿信工具工厂公共骨架：上限判定（已达上限占位文本**逐字节保留**）→
    计数 → try/except → logger.warning + 失败占位文本（不 raise）

7 个 agent 文件保留：角色 prompt 常量、查询构建（f-string，**逐字节不变**）、
角色特有逻辑（信息面分析师的确定性预抓 _prefetch/_search_section）。
```

## 迁移映射（7 agent → 基类用法）

| 文件 | 构造 | 节点方法 |
|---|---|---|
| fundamental_analysis_expert | `AgentNode(..., role_message=fundamental_analysis_expert_message)` | `complete_expert(query, "fundamental_analysis", ...)` |
| trend_analysis_expert | 同上（trend 消息） | `complete_expert(..., "trend_analysis", ...)` |
| technical_indicator_analyst | 同上 | `complete_expert(..., "technical_indicator_analysis", ...)` |
| information_analyst | 同上（_client 注入保留——基类 __init__ 接受 `**kwargs` 或子类自行 super() 前处理；**预抓逻辑不动**） | 预抓段保留 → 末段 LLM 骨架 `complete_expert(..., "information_analysis", ...)`（query 构建含预抓 context，逐字节不变） |
| bullish_trader | 基类 + `self.revise_llm = self.build_chain(bullish_revise_message)` | 初稿 `complete_with_tools(..., "bullish_opinions", ...)`；修订 `complete_with_tools(..., chain=self.revise_llm, max_tool_rounds=3, ...)` |
| bearish_trader | 同上 | 同上 |
| investment_manager | 基类（role_message=investment_manager_message） | `complete_with_tools(..., "final_decision", ...)` |

- 所有构造器签名保持 `(llm, config, progress_updater=None, tools=None)`
  ——注册表 Role.factory 零改动
- log_label 取现有 logger 前缀（"Fundamental Analysis Expert"、
  "Bullish Trader"、"Bullish Trader Revise"……）——日志格式
  `logger.debug("{} Query: {}", log_label, query_text)` 与现状等价

## 硬边界（违反即破坏既有测试）

1. **查询文本逐字节不变**：`test/agents/test_query_baselines.py` 用记录型
   LLM 抓查询 repr 全串比对——节点方法内的 f-string 内容一个字节都不能动
2. **工具 schema 不变**：`test_billions_tools.py` 钉死工具名/参数/docstring
   ——@tool 装饰函数保持各自签名与 docstring；`capped_call` 只包执行体
3. **占位文本不变**：已达上限/失败占位（`（已达本次运行检索上限...）`、
   `（亿信搜索失败：{exc}）` 等）逐字保留——cap 语义与 tool_loop 兜底
   依赖这些文本的调用方行为
4. **progress 文案不变**：safe_progress 的中文文案原样传入骨架参数
5. **State key 显式传参**：agent 不 import role_registry（注册表保持
   装配/UI 面向；agent 自包含——避免 agents → core.role_registry 反向耦合）
6. **prefetch/查询构建不抽象**：信息面分析师预抓、各角色查询构建保持
   各文件内显式——基类只收**不变管道**

## 兼容与风险

- 基类不改变 invoke 语义：complete_expert 逐条对齐 invoke_with_retry 的
  payload 形状（`{"query": query}`）；complete_with_tools 逐条对齐
  invoke_with_tools 参数（max_tool_rounds=None → 默认 15 由 tool_loop 兜底）
- FakeListChatModel（离线图测试）路径：bind_tools NotImplementedError 回退
  保留 → 集成测试全绿即证明
- revise 双链：bind_tools 后的 llm 实例复用（现状先 bind 再建双链）——
  build_chain 复用**已绑定** llm（构造内绑定一次，两链共享）
- 降级风格（error-handling spec）：工具执行异常 catch → warning + 占位，
  不 raise——capped_call 单点承载
- 信息面分析师 `_collect_items` 与 billsions_search._collect_items 是同一
  实现 → 收敛到 _items.py 后以 `from core.llms.tools._items import
  collect_content_items` 导入（code-reuse guide：契约单点维护）

## 不做

- 不改 prompt.py（system_prompt 壳与角色消息零变化）
- 不做动态/元编程注册（注册表已覆盖装配；agent 类保持显式继承）
- 不合并 web_search._summarize_results（键契约不同：title/link/snippet，
  非 result[].content[] 形态——只有形式相似，语义不同不硬并）
