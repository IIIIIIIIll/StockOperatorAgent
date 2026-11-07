// SoaKeepAlive:分析期间前台服务保活(Android)。
// 调用时机:分析开始 start(...),结束/失败/取消 stop()(锁屏中结束时推迟到回前台再停,
// 见 app/hooks/useAnalysis.ts)。
// 两层作用不同,缺一不可:
//   - 前台服务:把进程抬到前台优先级,免疫 LMK 低优先级回收;
//   - PARTIAL_WAKE_LOCK(KeepAliveService 内持):真正阻止 CPU 挂起。
//     只靠 FGS 不会豁免 Doze —— 屏幕灭 + 手机静止时 CPU 照样冻,JS 定时器与
//     socket 读取一起停摆。

import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';
import { info, warn } from '../../../src/log.ts';

type KeepAliveNative = {
  start: (title: string, body: string) => Promise<void>;
  stop: () => Promise<void>;
};

// 新架构(bridgeless)下 expo 模块须经 requireNativeModule 访问(NativeModules
// 直查为 null);模块未注册时抛错 → try/catch 降级为无保活(不阻断分析)。
let native: KeepAliveNative | null = null;
if (Platform.OS === 'android') {
  try {
    native = requireNativeModule('SoaKeepAlive') as KeepAliveNative;
  } catch {
    native = null;
  }
}

if (__DEV__ && Platform.OS === 'android') {
  info(`[soa keepalive] native module: ${native ? 'present' : 'MISSING'}`);
}

export function startAnalysisKeepAlive(title: string, body: string): void {
  if (__DEV__) info(`[soa keepalive] start(${title})`);
  native?.start(title, body).catch((e: unknown) => {
    // 前台服务启动失败(权限/系统限制)不阻断分析,静默降级为无保活;
    // __DEV__ 下记录失败原因便于排查(经 src/log.ts 单一日志出口,CR-39)。
    if (__DEV__) warn(`[soa keepalive] start failed: ${String(e)}`);
  });
}

export function stopAnalysisKeepAlive(): void {
  if (__DEV__) info('[soa keepalive] stop');
  native?.stop().catch((e: unknown) => {
    if (__DEV__) warn(`[soa keepalive] stop failed: ${String(e)}`);
  });
}
