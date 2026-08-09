# 技术债清理（2026-08-09 审计落地）

## Goal

把 2026-08-09 技术债审计（4 维度扫描：死代码/重复、分层违规、测试健康、配置依赖）中**可执行**的发现落地为修复。架构分层纪律（10 条规则零违规）不在本轮范围。

## 任务地图

| 子任务 | 交付物 |
|---|---|
| `08-09-deps-manifest` | requirements.txt 降 pin 对齐已验证环境 + 补 python-dotenv |
| `08-09-config-discoverability` | .env.example 补全生产开关 + README 修正 |
| `08-09-test-quality` | 拆 test_need_update 同义反复 + 补专家 agent / None 降级路径测试 |

## Requirements

- 只修审计确认过的项，不做新功能、不改行为语义（所有修复必须保持"改动前逐字节/逐行为等价"或明确列出行为差别的测试）。
- 依赖对齐方向（用户 2026-08-09 拍板）：**降 pin 到已验证环境**，不升环境。
- 审计中标注"有意保留"的已知项（节假日日历未建模、日K 缓存只写不读、akshare 备用路径、InMemorySaver、QwenApi 死代码）**不处理**，仅可顺带在文档注明。
- 每个子任务独立可验收；验收方式在各自 prd 的 Acceptance Criteria 中，必须可离线验证（无网络、无 LLM、无真实 TDX）。

## Acceptance Criteria

- [ ] 三个子任务全部验收通过。
- [ ] 依赖改动后 fresh venv 安装冒烟通过（deps-manifest 验收项）。
- [ ] 所有生产读取的 env 键在 .env.example 可发现（config-discoverability 验收项）。
- [ ] 测试套件新增用例全绿，无新 skip/xfail（test-quality 验收项）。
- [ ] spec 与代码漂移项（ZODB/altair 版本注记、logging.md f-string 注记等）同步更新。
- [ ] 父任务集成复核：跨子任务边界无遗漏（如 env 键改动与文档一致性、requirements 改动后 e2e 仍可跑）。

## Notes

- 审计完整发现见 2026-08-09 会话（未留档为独立文件；如需留档可补 docs/ 或本目录 research/）。
- 已知且有意保留（不做，只记录）：QwenApi 生产无消费点；`fetch_minute`/`fetch_index` 死代码；亿信工具工厂骨架三分复制；`get_last_business_day` 无节假日日历。
