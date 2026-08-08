# Implement: Playwright UI 测试框架（mock 模式）

## 执行顺序（每步独立可验证）

1. **导出种子 fixture**（需网络，一次性）
   - `scripts/export_seed_002027.py`：调 `build_stock_information("002027")`
     把输出文本写入 `test/e2e/seed/fixture_002027.txt`
   - ✅ 验证：文件存在且含 overview/日K/业绩报告段落；`git diff` 确认生产
     代码未动
2. **mock 层**：`test/e2e/mock_committee.py` + `test/e2e/mock_app.py`
   - FakeGraph.stream yield 5 个报告 key（各 key 一条 markdown 报告，观点
     含两条不同内容验证 expander 追加渲染）
   - ✅ 验证：`DEEPSEEK_API_KEY=dummy streamlit run test/e2e/mock_app.py
     --server.headless=true` 手动起服，浏览器手测提交 002027 → 6 tab 渲染
     （记录服务器日志无 API 调用痕迹）
3. **conftest fixtures**：server 子进程管理（health 就绪轮询）+ chromium
   context + on-fail 截图
   - ✅ 验证：一个最小用例（标题断言）能跑通
4. **用例**：
   - test_smoke.py：标题/表单/提交按钮/6 tab
   - test_interaction.py：提交 002027 → 数据 Tab canvas 图表 + markdown
     表格；5 报告 tab header + 内容；观点 expander「第 1 次观点」默认展开
   - test_invalid_input.py：非 6 位数字报错；BJ 代码（43xxxx）报不支持
   - test_theme.py：colorScheme 仿真亮/暗 → 背景色断言
5. **全量验证**：`pytest test/e2e/ -v`，计时 < 2 分钟；零 LLM/零网络
   断言（计数器 + 日志检查）通过；`git diff` 生产目录零改动
6. **spec 更新**：新增/更新 `.trellis/spec/core/index.md` 测试章节
   （UI e2e 框架用法、mock 契约、运行命令）—— trellis-update-spec
7. **提交**：commit（feat(test): Playwright UI 测试框架 mock 模式）
8. **归档任务** + journal 记录

## 验证命令

```bash
# 每步
python3 scripts/export_seed_002027.py          # 步骤 1
streamlit run test/e2e/mock_app.py ...         # 步骤 2 手动冒烟
pytest test/e2e/test_smoke.py -v               # 步骤 3
pytest test/e2e/ -v                            # 步骤 5 全量
git diff --stat core/ main.py agents/ data_*/  # 步骤 5 生产零改动
```

## Review 门禁

- 门禁 A（步骤 2 后）：mock 手测通过，服务器日志无 LLM/网络痕迹
- 门禁 B（步骤 4 后）：每个用例独立可断言，无共享时序耦合
  （不依赖用例执行顺序）
- 门禁 C（步骤 5 后）：全量绿 + 时长 + 零调用三证齐全
- 回滚点：任何步骤失败 → 仅新增 test/e2e/ + scripts/export_seed 文件，
  删除即回滚（无生产代码牵连）

## 已知坑（memory/历史）

- 1.61.1 主题切换不在 ⋮ 菜单 → colorScheme 仿真
- 模型不能读图 → 结构断言为主
- Streamlit 每次交互 rerun 顶层代码 → server 日志重复落盘问题已由
  main.py `_ensure_file_handler` 幂等处理（mock_app 无需重复处理）
- 图表容器 testid 是 stFullScreenFrame；altair 渲染为 .vega-embed canvas
