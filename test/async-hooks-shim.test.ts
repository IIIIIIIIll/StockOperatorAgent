// async-hooks-shim 单测(R4:此前零测试)。
//
// 这个 shim 是 Hermes 下 LangChain 系 `new AsyncLocalStorage()` 的唯一实现。
// 它的破坏面不是「tracing 不准」而是「模块顶层 new 时抛错 → 整个图不进」,
// 所以这里钉的是 run/exit/enterWith 的作用域纪律,而不是跨 async 边界的可见性
// (后者按设计退化 undefined,不是 bug)。
import { describe, expect, it } from 'vitest';
import { AsyncLocalStorage } from '../app/lib/async-hooks-shim.ts';

describe('async-hooks-shim AsyncLocalStorage', () => {
  it('未进入任何作用域时 getStore 为 undefined', () => {
    expect(new AsyncLocalStorage<string>().getStore()).toBeUndefined();
  });

  it('run 内可见 store,run 结束回到 undefined', () => {
    const als = new AsyncLocalStorage<string>();
    expect(als.run('outer', () => als.getStore())).toBe('outer');
    expect(als.getStore()).toBeUndefined();
  });

  it('嵌套 run 按 LIFO 恢复外层 store', () => {
    const als = new AsyncLocalStorage<string>();
    const seen: Array<string | undefined> = [];
    als.run('a', () => {
      seen.push(als.getStore());
      als.run('b', () => {
        seen.push(als.getStore());
      });
      seen.push(als.getStore()); // 内层退出后应回到 a
    });
    seen.push(als.getStore()); // 外层退出后应清空
    expect(seen).toEqual(['a', 'b', 'a', undefined]);
  });

  it('run 内抛错也恢复 store(不留脏状态)', () => {
    const als = new AsyncLocalStorage<string>();
    expect(() =>
      als.run('x', () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(als.getStore()).toBeUndefined();
  });

  it('run 把额外参数透传给回调', () => {
    const als = new AsyncLocalStorage<number>();
    const got = als.run(7, (a: unknown, b: unknown) => [als.getStore(), a, b], 1, 'two');
    expect(got).toEqual([7, 1, 'two']);
  });

  it('enterWith 直接置位;disable 清空', () => {
    const als = new AsyncLocalStorage<number>();
    als.enterWith(42);
    expect(als.getStore()).toBe(42);
    als.disable();
    expect(als.getStore()).toBeUndefined();
  });

  it('exit 内 getStore 为 undefined,退出后恢复原值', () => {
    const als = new AsyncLocalStorage<string>();
    als.enterWith('kept');
    const inside = als.exit(() => als.getStore());
    expect(inside).toBeUndefined();
    expect(als.getStore()).toBe('kept');
  });

  it('两个实例互不干扰(每模块各 new 一个)', () => {
    const a = new AsyncLocalStorage<string>();
    const b = new AsyncLocalStorage<string>();
    a.run('A', () => {
      b.run('B', () => {
        expect(a.getStore()).toBe('A');
        expect(b.getStore()).toBe('B');
      });
    });
  });
});
