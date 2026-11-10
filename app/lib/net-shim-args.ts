// node:net 位置参数风格的归一(纯函数,零运行时依赖)。
//
// 为什么单独一个文件:net-shim.ts 顶层 `import net from 'react-native-tcp-socket'`
// —— 原生模块在 Node/vitest 里取不到。把「Node 位置参数 → 库调用形态」的映射
// 抽到这里,测试就能在纯 Node 下钉死重载语义,不需要 `vi.mock`(house style)。
//
// 要钉住的两处真实事故面:
//   1) connect 的 Node 风格是 connect(port, host?, cb?),库只收 connect(options, cb)。
//   2) write 的第二个参数若不是 string,库会把它当 encoding —— 于是
//      write(data, cb) 的回调被吞掉,上层等 callback 永远不返回。

export type ConnectCallback = () => void;
export type WriteCallback = (err?: Error) => void;

export type ConnectArgs =
  | { kind: 'options'; options: object; callback: ConnectCallback | undefined }
  | { kind: 'positional'; port: number; host: string | undefined; callback: ConnectCallback | undefined };

/** 归一 connect 的两种调用形态。数字入参 = Node 位置参数;其余 = 库的 options。 */
export function normalizeConnectArgs(
  portOrOptions: number | object,
  hostOrCallback?: string | ConnectCallback,
  maybeCallback?: ConnectCallback,
): ConnectArgs {
  if (typeof portOrOptions === 'number') {
    return {
      kind: 'positional',
      port: portOrOptions,
      host: typeof hostOrCallback === 'string' ? hostOrCallback : undefined,
      callback: typeof hostOrCallback === 'function' ? hostOrCallback : maybeCallback,
    };
  }
  // options 形态下第二参仍可能是回调(库的 connect(options, cb))
  return {
    kind: 'options',
    options: portOrOptions,
    callback: typeof hostOrCallback === 'function' ? hostOrCallback : maybeCallback,
  };
}

export interface WriteArgs<E> {
  encoding: E | undefined;
  callback: WriteCallback | undefined;
}

/** 归一 write:回调落在第二参时不能让它被当成 encoding 吞掉。 */
export function normalizeWriteArgs<E>(
  encodingOrCallback?: E | WriteCallback,
  maybeCallback?: WriteCallback,
): WriteArgs<E> {
  if (typeof encodingOrCallback === 'function') {
    // 已由 typeof 收窄到函数分支;泛型 E 未约束,TS 无法自动排除 `E & Function`
    return { encoding: undefined, callback: encodingOrCallback as WriteCallback };
  }
  return { encoding: encodingOrCallback, callback: maybeCallback };
}
