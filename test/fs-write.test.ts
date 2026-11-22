// src/fsWrite.ts —— expo-file-system SDK 58 的写入口径回归。
//
// 背景(安卓 release 实测):SDK 58 把 `File.write()` 改成异步(返回 Promise),
// 同步版本拆出 `writeSync()`。仓库里所有落盘都是「写 tmp → moveSync 原子替换」,
// 不 await 就 move → 目标落成 **0 字节**,而 App 自己的日志一片干净。
// 症状:历史归档 `index.json` / `<id>.json` 空文件 → 冷启动「历史正文损坏:
// Unexpected end of input」→ 点开历史永远「历史记录不存在或已损坏」。
import { describe, expect, it } from 'vitest';
import { writeNow } from '../src/fsWrite.ts';

describe('writeNow(SDK 58 同步写)', () => {
  it('有 writeSync → 只走 writeSync,绝不发起异步 write', () => {
    const calls: string[] = [];
    writeNow({
      write() {
        calls.push('write'); // SDK 58 上这里是 Promise —— 发起即丢失
        return Promise.resolve();
      },
      writeSync(contents, options) {
        calls.push(`writeSync:${contents}:${String(options?.append)}`);
      },
    }, 'data', { append: true });
    expect(calls).toEqual(['writeSync:data:true']);
  });

  it('旧运行时(只有同步 write)→ 退回 write,不算失败', () => {
    const calls: string[] = [];
    writeNow({
      write(contents) {
        calls.push(`write:${contents}`);
      },
    }, 'legacy');
    expect(calls).toEqual(['write:legacy']);
  });

  it('append 选项原样透传(日志追加依赖它)', () => {
    const seen: Array<{ append?: boolean } | undefined> = [];
    writeNow({
      write() {},
      writeSync(_c, options) { seen.push(options); },
    }, 'line\n', { append: true });
    expect(seen).toEqual([{ append: true }]);
  });
});
