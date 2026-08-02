# Design: ZODB 读写锁 + LLM 调用重试（review #5+#6）

## Part A — #5 ZODB 读写锁

### A1. 问题精确定位

- `get_zodb_storage` 单例（ZODBStorage.py:75-99）——`_instance_lock` 双重
  检查只防并发首调双构造。
- `ZODBStorageInstance` 的连接：`root.stocks` OOBTree 读写 + `transaction`
  模块（进程级当前事务）——同一进程两个线程交错读写同一连接：
  - 读方在写方 tpc 中间读到不一致视图 → `POSKeyError`
  - 两线程各自 commit → 事务对象竞争 → `ConflictError` / `TransactionError`
- Streamlit：每浏览器会话一个线程执行 `write_ui`；多标签页/多用户并发是
  真实场景（spec 原"UI 层串行渲染即满足"假设不成立）。

### A2. 锁设计

```python
# ZODBStorage.py
class ZODBStorageInstance:
    def __init__(self):
        ...
        self.lock = threading.RLock()   # 读写锁：所有 storage 访问持锁
```

RLock 理由：
- 访问链 `get_stock → mutate(commit) → put_stock(commit)` 天然嵌套
  （get 持锁 → add_datas 内部 commit 仍持锁）——RLock 同线程可重入，
  免"先释放再取"的碎化窗口。
- 非递归 Lock 会在 `DataAcquisition.acquire_*` 里
  `with lock: stock.add_data(...)` 嵌套 `add_data` 内再获取时死锁。

加锁边界（DataAcquisition 操作级）：

```python
def acquire_historical_data_tdx(self, ticker, _scope=None):
    stock = self.storage.get_stock(ticker)          # 读
    ... gate 判定 ...
    with self.storage.lock:
        ... fetch → qfq → add_datas（内部 commit）→ put_stock（内部 commit）...
    return True
```

边界论证：
- **只包数据读写段**（fetch 可包可不包——fetch 不碰 ZODB，包住无害且简单）。
- **不包**：`build_stock_information` / `graph.stream`（LLM 分钟级）——
  包住会把并发会话的数据+LLM 全串行化，违背并行意图。
- `ensure_stock` 的 #1 刷新分支同样持锁。
- `FetchScope`（#2+#3 子任务）是 per-call 对象，无跨线程共享 → 无锁需求。

替代方案（不采用）：
- 每线程独立连接：FileStorage flock 进程级不可重入 → 进程内第二个实例
  `LockError`（spec 已论证）——不可能。
- 每会话独立 ZODB DB（不同文件）：分库分家，违背单库语义——不采用。
- `ConflictError` 自动重试（zodb retry）：仅缓解写写冲突，读读/读写
  窗口仍在——不替代锁。

### A3. 测试

```python
def test_concurrent_access_safe(self):
    """两线程并发 get/mutate/commit 同一 stock：无 POSKeyError/ConflictError。
    验证锁把并发访问串行化。"""
    da = DataAcquisition()
    stock = _seed_stock(da, "999997")
    errors = []
    def worker():
        try:
            for _ in range(20):
                s = da.storage.get_stock("999997")
                s.overview_last_update = datetime.datetime.now()
                transaction.commit()
        except Exception as e:
            errors.append(e)
    ts = [threading.Thread(target=worker) for _ in range(2)]
    ...join...
    assert errors == []
```

（无锁时该测试有概率暴露 POSKeyError/ConflictError——不保证必现，
锁的验证 = 测试恒绿 + 实现审查锁作用域。）

## Part B — #6 LLM 重试

### B1. 问题

agent 模板 `self.llm.invoke({"query": query}, config=config)` 无重试。
DeepSeek 429（限流）/5xx/连接超时 → 图整体失败 → display 报错 → 用户
重付 5 次调用。

### B2. 包装设计

```python
# core/llms/retry.py
import tenacity

RETRYABLE = ("429", "500", "502", "503", "504")   # 状态码判定
# langchain-openai 抛 OpenAIError；httpx 抛 httpx.HTTPStatusError /
# ConnectionError / TimeoutException——按类型判定可恢复性

def invoke_with_retry(llm, payload, config, *, attempts=3, base_delay=1.0):
    """LLM 调用重试包装：429/5xx/连接/超时退避重试；业务错误直抛。"""
    @tenacity.retry(
        retry=tenacity.retry_if_exception(_is_retryable),
        wait=tenacity.wait_exponential(multiplier=base_delay, max=8),
        stop=tenacity.stop_after_attempt(attempts),
        reraise=True,
    )
    def _invoke():
        return llm.invoke(payload, config=config)
    return _invoke()
```

`_is_retryable(exc)` 判定：
- `openai.RateLimitError`（429）→ 重试
- `httpx.ConnectError` / `TimeoutException` → 重试
- `openai.InternalServerError` / `APIConnectionError` → 重试
- `openai.AuthenticationError` / `BadRequestError`（400，业务错误）→ 不重试

agent 模板改动（5 节点统一）：

```python
from core.llms.retry import invoke_with_retry
...
response = invoke_with_retry(self.llm, {"query": query}, config=self.config)
```

### B3. 测试（注入 fake llm，无 mock 框架）

```python
class _FlakyLlm:
    """前 n 次抛 RateLimitError，之后返回 FakeListChatModel 响应。"""
    def __init__(self, fails=1, exc=RateLimitError(...)):
        self.fails = fails; self.calls = 0
    def invoke(self, payload, config=None):
        self.calls += 1
        if self.calls <= self.fails:
            raise self.exc
        return AIMessage(content="ok")
```

- 429×1 → 成功：`calls == 2`
- 429×3（attempts=3）→ 耗尽抛：`calls == 3` 且抛原异常（reraise）
- 400 业务错误 → 不重试：`calls == 1`
- 单节点图集成：FakeListChatModel + 包装（#4 的图测试可复用）

## Part C — 边界与兼容

- 重试耗尽仍抛 → 既有 UI 守护捕获（display.py try/except）——错误路径
  行为不变，仅增加延迟与成功率。
- 锁与重试互不依赖（#5 锁作用域不含图阶段；#6 包装不碰 storage）。
- spec 修订：
  - data_storage/index.md：线程安全段补读写锁（RLock、作用域、跨 LLM
    不持锁）。
  - agents/index.md：LLM Configuration 或模板段补 invoke 重试约定
    （retry.py、可恢复错误清单）。
