// node:net → react-native-tcp-socket 适配层(Metro resolveRequest 把 'node:net'
// 重定向到本文件)。node-tdx-market 的 dist 产物只用到 net.Socket,但按 Node 的
// 位置参数风格调用:connect(port, host, cb)、write(data, cb)。而
// react-native-tcp-socket 只接受 connect(options, cb) / write(data, encoding?, cb?),
// 且 write 的第二个参数若不是 string 会被当成 encoding 吞掉回调——这里统一做参数归一。
// 类型只能从 default 命名空间取(包的类型声明把 Socket/isIP 等都挂在
// `export default _default` 下;运行时 module.exports 则直接具名导出,两者一致)。
import net from 'react-native-tcp-socket';

const { Socket: TcpSocket, isIP, isIPv4, isIPv6 } = net;

type TcpSocketClass = typeof TcpSocket;
type TcpSocketInstance = InstanceType<TcpSocketClass>;
type ConnectOptions = Parameters<TcpSocketInstance['connect']>[0];
type WriteEncoding = Parameters<TcpSocketInstance['write']>[1];
type WriteCallback = (err?: Error) => void;

export class Socket extends TcpSocket {
  connect(options: ConnectOptions, callback?: () => void): this;
  connect(port: number, host?: string, callback?: () => void): this;
  connect(
    portOrOptions: number | ConnectOptions,
    hostOrCallback?: string | (() => void),
    maybeCallback?: () => void
  ): this {
    if (typeof portOrOptions === 'number') {
      const host = typeof hostOrCallback === 'string' ? hostOrCallback : undefined;
      const callback = typeof hostOrCallback === 'function' ? hostOrCallback : maybeCallback;
      return super.connect({ port: portOrOptions, host }, callback) as this;
    }
    return super.connect(portOrOptions, hostOrCallback as () => void) as this;
  }

  write(buffer: string | Buffer | Uint8Array, callback?: WriteCallback): boolean;
  write(
    buffer: string | Buffer | Uint8Array,
    encoding?: WriteEncoding,
    callback?: WriteCallback
  ): boolean;
  write(
    buffer: string | Buffer | Uint8Array,
    encodingOrCallback?: WriteEncoding | WriteCallback,
    maybeCallback?: WriteCallback
  ): boolean {
    if (typeof encodingOrCallback === 'function') {
      return super.write(buffer, undefined, encodingOrCallback);
    }
    return super.write(buffer, encodingOrCallback, maybeCallback);
  }

  setKeepAlive(enable?: boolean, initialDelay?: number): this {
    // 原生端(TcpSocketClient.java)完全忽略 initialDelay,传 0 仅跳过库内
    // console.warn 噪音,行为不变。
    return super.setKeepAlive(enable, 0) as this;
  }
}

export function createConnection(options: ConnectOptions, callback?: () => void): Socket;
export function createConnection(port: number, host?: string, callback?: () => void): Socket;
export function createConnection(
  portOrOptions: number | ConnectOptions,
  hostOrCallback?: string | (() => void),
  maybeCallback?: () => void
): Socket {
  const socket = new Socket();
  if (typeof portOrOptions === 'number') {
    const host = typeof hostOrCallback === 'string' ? hostOrCallback : undefined;
    const callback = typeof hostOrCallback === 'function' ? hostOrCallback : maybeCallback;
    socket.connect(portOrOptions, host, callback);
  } else {
    socket.connect(portOrOptions, hostOrCallback as () => void);
  }
  return socket;
}

export const connect = createConnection;
export { isIP, isIPv4, isIPv6 };
