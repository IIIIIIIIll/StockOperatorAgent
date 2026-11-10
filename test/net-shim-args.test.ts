// net-shim 的参数归一(R4:此前 app/lib/net-shim.ts 零测试)。
//
// 为什么能直接测:归一逻辑抽到了 net-shim-args.ts —— 不 import
// 'react-native-tcp-socket'(原生模块在 Node 里取不到)。house style 禁 vi.mock,
// 所以用「把纯函数抽出来」代替打桩。
import { describe, expect, it } from 'vitest';
import { normalizeConnectArgs, normalizeWriteArgs } from '../app/lib/net-shim-args.ts';

describe('normalizeConnectArgs(node:net 位置参数 → 库 options 形态)', () => {
  it('connect(port) → 位置参数,host 与回调都缺省', () => {
    expect(normalizeConnectArgs(8081)).toEqual({
      kind: 'positional',
      port: 8081,
      host: undefined,
      callback: undefined,
    });
  });

  it('connect(port, host) → host 进 options', () => {
    expect(normalizeConnectArgs(6000, '127.0.0.1')).toEqual({
      kind: 'positional',
      port: 6000,
      host: '127.0.0.1',
      callback: undefined,
    });
  });

  it('connect(port, callback) → 第二参是函数时按回调处理,host 留空(不能当 host)', () => {
    const cb = () => {};
    expect(normalizeConnectArgs(6000, cb)).toEqual({
      kind: 'positional',
      port: 6000,
      host: undefined,
      callback: cb,
    });
  });

  it('connect(port, host, callback) → 三者各归其位', () => {
    const cb = () => {};
    const args = normalizeConnectArgs(6000, '10.0.2.2', cb);
    expect(args).toEqual({ kind: 'positional', port: 6000, host: '10.0.2.2', callback: cb });
  });

  it('connect(options) 对象形态原样透传', () => {
    const options = { port: 6000, host: 'example.com' };
    const args = normalizeConnectArgs(options);
    expect(args.kind).toBe('options');
    expect(args.kind === 'options' && args.options).toBe(options); // 同一个对象,不拷贝
    expect(args.callback).toBeUndefined();
  });

  it('connect(options, callback) → 回调留在第二位', () => {
    const cb = () => {};
    const args = normalizeConnectArgs({ port: 6000 }, cb);
    expect(args).toEqual({ kind: 'options', options: { port: 6000 }, callback: cb });
  });

  it('端口 0 不被当成假值丢掉', () => {
    expect(normalizeConnectArgs(0)).toEqual({
      kind: 'positional',
      port: 0,
      host: undefined,
      callback: undefined,
    });
  });
});

describe('normalizeWriteArgs(write 的 encoding / callback 歧义)', () => {
  it('write(data, callback) → 回调不被当作 encoding 吞掉(历史真实事故)', () => {
    const cb = () => {};
    expect(normalizeWriteArgs(cb)).toEqual({ encoding: undefined, callback: cb });
  });

  it('write(data, encoding, callback) → 原样分开', () => {
    const cb = () => {};
    expect(normalizeWriteArgs('utf8', cb)).toEqual({ encoding: 'utf8', callback: cb });
  });

  it('write(data, encoding) → 有编码无回调', () => {
    expect(normalizeWriteArgs('base64')).toEqual({ encoding: 'base64', callback: undefined });
  });

  it('write(data) → 两者皆空', () => {
    expect(normalizeWriteArgs()).toEqual({ encoding: undefined, callback: undefined });
  });

  it('undefined 第二参 + 第三参回调 → 回调仍要落地', () => {
    const cb = () => {};
    expect(normalizeWriteArgs(undefined, cb)).toEqual({ encoding: undefined, callback: cb });
  });
});
