// SoaKeepAlive:分析期间前台服务保活(Android)。
// 调用时机:分析开始 start(...),结束/失败/取消 stop()。
// 前台服务使进程成为前台进程,豁免 Doze 冻结与内存回收,JS async 链继续跑。

import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';

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
  console.log('[soa keepalive] native module:', native ? 'present' : 'MISSING');
}

export function startAnalysisKeepAlive(title: string, body: string): void {
  if (__DEV__) console.log(`[soa keepalive] start(${title})`);
  native?.start(title, body).catch(() => {
    // 前台服务启动失败(权限/系统限制)不阻断分析,降级为前台运行
  });
}

export function stopAnalysisKeepAlive(): void {
  if (__DEV__) console.log('[soa keepalive] stop');
  native?.stop().catch(() => {});
}
