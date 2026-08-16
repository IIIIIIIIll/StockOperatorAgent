// 真机采集模块桥 —— dynamic import 目标必须在 metro 项目根(app/)内:
// 跨根相对 specifier(如 app/hooks → ../../src/tdx/deviceCollect.ts)在 Android
// 运行时被 metro 重写为项目根相对路径(./src/tdx/deviceCollect)后解析失败
// (08-16-audit-remediation 实证,web 因平台门从不执行而幸免)。
// 桥内静态 re-export src/tdx(静态跨根 import 正常),动态 import 该桥时 specifier
// 保持在根内 → 运行时解析成功;web bundle 仍只含惰性 chunk 引用,不含 TCP 链。
export { collectForDevice, setDeviceStore } from '../../src/tdx/deviceCollect.ts';
