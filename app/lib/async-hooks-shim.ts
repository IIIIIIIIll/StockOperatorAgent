// node:async_hooks 最小实现 —— Hermes 无原生 async_hooks。LangChain 系
// (langgraph/dist/node.js、core/dist/context.js)在模块顶层 new AsyncLocalStorage()
// 并注册为全局 tracing 上下文;core 自带 mock 兜底(getStore 恒 undefined),
// 这里提供同步作用域可见的 store:run() 内 getStore() 返回该 store,跨 async
// 边界退化 undefined —— LangSmith tracing 自动降级,图执行/LLM 调用不依赖它。
class AsyncLocalStorage<T = unknown> {
  private store: T | undefined;

  getStore(): T | undefined {
    return this.store;
  }

  run<R>(store: T, callback: (...args: unknown[]) => R, ...args: unknown[]): R {
    const previous = this.store;
    this.store = store;
    try {
      return callback(...args);
    } finally {
      this.store = previous;
    }
  }

  enterWith(store: T): void {
    this.store = store;
  }

  disable(): void {
    this.store = undefined;
  }

  exit<R>(callback: (...args: unknown[]) => R, ...args: unknown[]): R {
    const previous = this.store;
    this.store = undefined;
    try {
      return callback(...args);
    } finally {
      this.store = previous;
    }
  }
}

export { AsyncLocalStorage };
