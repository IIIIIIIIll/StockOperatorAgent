// react-native 的最小测试替身(vitest resolve.alias 指向本文件)。
//
// 为什么需要:app/ 下的 hook 静态 import 'react-native'(RN 专属,Flow 源码),
// Node/vitest 无法解析 —— 但 hook 逻辑本身与 RN 无关。测试只需要 AppState。
//
// 为什么用 alias 而不是 vi.mock:本仓 house style 无 mock 框架,且
// `vi.mock('react-native')` 在「根 node_modules 与 app/node_modules 两棵树」下
// 解析出的 ID 不一致,注册不上(2026-11-21 实测)。
//
// 测试控制面:`__setAppState(next)` 派发 change;`__appStateListeners()` 断言清理。

export type RnAppStateStatus = 'active' | 'background' | 'inactive' | 'unknown';

type Listener = (state: RnAppStateStatus) => void;

const listeners = new Set<Listener>();

export const AppState = {
  currentState: 'active' as RnAppStateStatus,
  addEventListener(_type: 'change', fn: Listener) {
    listeners.add(fn);
    return {
      remove() {
        listeners.delete(fn);
      },
    };
  },
};

/** 测试用:切换状态并派发(等价于系统回调)。 */
export function __setAppState(next: RnAppStateStatus): void {
  AppState.currentState = next;
  for (const fn of [...listeners]) fn(next);
}

/** 测试用:当前监听器数量(断言卸载不泄漏)。 */
export function __appStateListeners(): number {
  return listeners.size;
}

/** 测试用:恢复初始态(配合 beforeEach)。 */
export function __resetAppState(): void {
  listeners.clear();
  AppState.currentState = 'active';
}

export default { AppState };
