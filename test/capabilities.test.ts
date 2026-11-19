// 端能力接缝单测(2026-11 架构整改):capabilities() 是唯一判定点,合并了三套
// 探针 —— detectPlatform()(环境嗅探)/ isDesktopBridge()(window.__soaDesktop)/
// 原先散落各处的 Platform.OS。这里钉住三种端下每个能力位的取值。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { capabilities, resetCapabilitiesCache } from '../app/lib/capabilities.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  resetCapabilitiesCache(); // memo 必须清,否则后一个用例读到前一个的探针结果
});

describe('capabilities 端能力接缝', () => {
  it('node 环境(探针/CI)→ node:无 DOM、file 后端、不走同源代理', () => {
    const c = capabilities();
    expect(c.platform).toBe('node');
    expect(c.hasDom).toBe(false);
    expect(c.isWeb).toBe(false);
    expect(c.isRn).toBe(false);
    expect(c.isDesktop).toBe(false);
    expect(c.storageBackend).toBe('file');
    expect(c.collectViaProxy).toBe(false);
  });

  it('浏览器(window + document)→ web:有 DOM、idb 后端、必须经同源代理', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {});
    const c = capabilities();
    expect(c.platform).toBe('web');
    expect(c.hasDom).toBe(true);
    expect(c.collectViaProxy).toBe(true);
    expect(c.storageBackend).toBe('idb');
    expect(c.isDesktop).toBe(false);
  });

  it('Electron renderer(有 __soaDesktop 桥)→ desktop,且优先于 web', () => {
    // renderer 同时满足 window + document —— 判定顺序错就会误报 web
    vi.stubGlobal('window', { __soaDesktop: { isDesktop: true } });
    vi.stubGlobal('document', {});
    const c = capabilities();
    expect(c.platform).toBe('desktop');
    expect(c.isDesktop).toBe(true);
    expect(c.hasDom).toBe(true);
    expect(c.collectViaProxy).toBe(true);
    // 与整改前一致:desktop 初始仍给 idb,随后由 DesktopStore 顶替
    expect(c.storageBackend).toBe('idb');
  });

  it('桥存在但 isDesktop !== true → 不算桌面壳(退化为 web)', () => {
    vi.stubGlobal('window', { __soaDesktop: { isDesktop: false } });
    vi.stubGlobal('document', {});
    expect(capabilities().platform).toBe('web');
  });

  it('memo 化:同一进程内探针只算一次,reset 后重算', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {});
    expect(capabilities().platform).toBe('web');
    // 环境变了但未 reset → 仍是缓存值(证明 memo 生效)
    vi.unstubAllGlobals();
    expect(capabilities().platform).toBe('web');
    resetCapabilitiesCache();
    expect(capabilities().platform).toBe('node');
  });
});
