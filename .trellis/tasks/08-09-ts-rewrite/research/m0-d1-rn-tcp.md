# M0-D1：node-tdx-market 在 RN 运行时的 TCP 可行性

**结论：可行（路径 A），node-tdx-market 本体零改动，靠 Metro 层 polyfill。**

## 证据（源码级）

`node_modules/node-tdx-market/dist/client.js`：

- `const net = __importStar(require("node:net"))`（模块级）
- `createConnection()`：`new net.Socket()` → `socket.setKeepAlive(true, this.heartbeatInterval)` →
  `socket.connect(port, host, cb)` → `socket.on('data'/'error'/'close')` → `socket.write(frame, cb)` → `socket.destroy()`
- `Buffer` 使用面：`Buffer.alloc`×4、`Buffer.concat`×2、`Buffer.from`×1
- `net` 依赖文件：`client.js`（主行情）、`exhq-client.js`（扩展行情）、`server-list.js`（测速）

RN 运行时（Hermes/JSC）无 Node `net` 与 `Buffer`。

## 适配方案（D1 定案）

| 层 | 方案 |
|---|---|
| `net` | **react-native-tcp-socket 6.4.2**（MIT，Android+iOS，2026-07-26 仍活跃）——Metro `net` alias → 薄适配层：把其 `TcpSocket` 包装成 `net.Socket` 形状（new/connect/on/write/destroy/setKeepAlive 共 7 个 API，client.js 已确认全部用法） |
| `Buffer` | `buffer` npm 包 Metro alias（alloc/concat/from 三方法标准 polyfill） |
| 工程形态 | 原生模块 → **Expo Go 不支持**，需 dev build（EAS dev client）；`expo prebuild` 后含 config plugin |

## 风险与备选

- **风险 1（需 M3 建工程时实测）**：react-native-tcp-socket 的 New Architecture 兼容性——6.x 声称支持，验证点列入 M3。
- **风险 2**：适配层漏 API——7 个方法全部在 client.js 的 createConnection/dispatch 中确认，无其他 net 用法。
- **备选（若原生模块路径受阻）**：HTTP 行情源（东财/akshare 风格）替代 TDX 直连——代价是丢失 TDX 直连特性（快、稳、免鉴权），qfq/F10 语义不变。

## 影响

- 数据层选型不受影响：node-tdx-market 保留为主行情客户端。
- M0 其余步骤（D2-D4）在 Node 环境验证协议/解析正确性，RN 适配层在 M3 建工程时实现并实测。
