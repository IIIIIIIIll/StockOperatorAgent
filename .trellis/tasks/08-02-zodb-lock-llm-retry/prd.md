# fix: ZODB 读写锁 + LLM 调用重试（review #5+#6）

## Goal

review #5: 单例连接非线程安全——Streamlit 多会话并发读写同一连接（POSKeyError/ConflictError 风险）；扩展现有构造锁为读写锁。#6: agent 节点裸 invoke，429/超时整体失败——加 2-3 次退避重试包装。

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
