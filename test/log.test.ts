import { describe, expect, it } from 'vitest';
import {
  RN_LOG_FILE,
  detectPlatform,
  fileWriteDisabled,
  formatLogLine,
  isNodeEnv,
  isRnEnv,
  isWebEnv,
  log,
  makeReporter,
  makeRnFileTransport,
  reportEndpoint,
  type RnFileSystem,
} from '../src/log.ts';

// ─── 全局环境存/取(无 mock 框架:临时替换全局后 finally 还原;navigator 在
// Node 是 getter-only 属性,须用 defineProperty 覆盖/还原)────────────────────
function stash(keys: string[]): Record<string, PropertyDescriptor | undefined> {
  const saved: Record<string, PropertyDescriptor | undefined> = {};
  for (const k of keys) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
  return saved;
}
function setGlobal(key: string, value: unknown): void {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}
function restore(saved: Record<string, PropertyDescriptor | undefined>): void {
  for (const [k, desc] of Object.entries(saved)) {
    if (desc === undefined) {
      try {
        delete (globalThis as Record<string, unknown>)[k];
      } catch {
        /* 不可删除的残留全局:忽略 */
      }
    } else {
      Object.defineProperty(globalThis, k, desc);
    }
  }
}

function withEnv(pairs: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(pairs)) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(pairs)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function captureConsole(): { lines: Record<string, string[]>; restore: () => void } {
  const lines: Record<string, string[]> = { log: [], warn: [], error: [], debug: [] };
  const orig: Record<string, unknown> = {};
  for (const m of ['log', 'warn', 'error', 'debug'] as const) {
    orig[m] = console[m];
    (console as unknown as Record<string, (...a: unknown[]) => void>)[m] = (...a: unknown[]) => {
      lines[m].push(a.map(String).join(' '));
    };
  }
  return {
    lines,
    restore: () => {
      for (const m of ['log', 'warn', 'error', 'debug'] as const) {
        (console as unknown as Record<string, unknown>)[m] = orig[m];
      }
    },
  };
}

// ─── RN 沙盒 fake file API(house style 注入点,无 mock 框架)────────────────
// 真实 expo-file-system File 是 path-based 句柄:同一路径的新实例读同一文件。
// fake 用按 name 的共享 store 模拟(transport 每次写都新建句柄)。
interface FileState {
  content: string;
  exists: boolean;
  creates: number;
  writes: number;
  moves: number;
}
class FakeFile {
  movedTo: string | null = null;
  constructor(
    public readonly dir: unknown,
    public readonly name: string,
    protected readonly store: Map<string, FileState>,
  ) {}
  private state(): FileState {
    if (!this.store.has(this.name)) this.store.set(this.name, { content: '', exists: false, creates: 0, writes: 0, moves: 0 });
    return this.store.get(this.name)!;
  }
  get exists(): boolean {
    return this.state().exists;
  }
  get size(): number {
    return this.state().content.length; // path-based:同路径新句柄读到同一文件大小
  }
  create(): void {
    const s = this.state();
    s.creates++;
    s.exists = true;
  }
  write(contents: string): void {
    const s = this.state();
    s.writes++;
    s.content = contents;
    s.exists = true;
  }
  textSync(): string {
    return this.state().content;
  }
  moveSync(destination: FakeFile, options?: { overwrite?: boolean }): void {
    // F03:对齐 expo-file-system 真实语义——目标已存在且未显式 overwrite → 抛错
    if (destination.exists && !options?.overwrite) {
      throw new Error(`moveSync: destination ${destination.name} already exists (overwrite: false)`);
    }
    const s = this.state();
    s.moves++;
    this.movedTo = destination.name;
    const ds = destination.state();
    ds.content = s.content;
    ds.exists = true;
    s.content = '';
    s.exists = false;
  }
}
function fakeFs(): { fs: RnFileSystem; store: Map<string, FileState>; F: typeof FakeFile } {
  const store = new Map<string, FileState>();
  class F extends FakeFile {
    constructor(dir: unknown, name: string) {
      super(dir, name, store);
    }
  }
  return { fs: { File: F as unknown as RnFileSystem['File'], Paths: { document: 'doc' } }, store, F };
}

describe('环境判定探针', () => {
  it('vitest(Node)默认分支 → node', () => {
    expect(isNodeEnv()).toBe(true);
    expect(isWebEnv()).toBe(false);
    expect(isRnEnv()).toBe(false);
    expect(detectPlatform()).toBe('node');
  });

  it('window+document 存在 → web 分支', () => {
    const saved = stash(['window', 'document']);
    try {
      setGlobal('window', { location: { origin: 'http://x' } });
      setGlobal('document', {});
      expect(isWebEnv()).toBe(true);
      expect(detectPlatform()).toBe('web');
    } finally {
      restore(saved);
    }
  });

  it('navigator.product==="ReactNative" → rn 分支', () => {
    const saved = stash(['navigator']);
    try {
      setGlobal('navigator', { product: 'ReactNative' });
      expect(isRnEnv()).toBe(true);
      expect(detectPlatform()).toBe('rn');
    } finally {
      restore(saved);
    }
  });

  it('web 与 RN 探针并存 → web 优先', () => {
    const saved = stash(['window', 'document', 'navigator']);
    try {
      setGlobal('window', {});
      setGlobal('document', {});
      setGlobal('navigator', { product: 'ReactNative' });
      expect(detectPlatform()).toBe('web');
    } finally {
      restore(saved);
    }
  });
});

describe('console transport(格式 [soa <level>] 逐字节不变,AC5)', () => {
  it('info/warn/error 各走对应 console 方法,格式不变', () => {
    const cap = captureConsole();
    try {
      log('info', 'hello');
      log('warn', 'careful');
      log('error', 'boom');
      expect(cap.lines.log).toEqual(['[soa info] hello']);
      expect(cap.lines.warn).toEqual(['[soa warn] careful']);
      expect(cap.lines.error).toEqual(['[soa error] boom']);
      expect(cap.lines.debug).toEqual([]);
    } finally {
      cap.restore();
    }
  });

  it('debug 级 __SOA_DEBUG 门控:开 → console.debug;关 → console.log(既有 fallthrough)', () => {
    const savedDebug = Object.getOwnPropertyDescriptor(globalThis, '__SOA_DEBUG');
    const cap = captureConsole();
    try {
      setGlobal('__SOA_DEBUG', '1');
      log('debug', 'trace-on');
      setGlobal('__SOA_DEBUG', '0');
      log('debug', 'trace-off');
      expect(cap.lines.debug).toEqual(['[soa debug] trace-on']);
      expect(cap.lines.log).toEqual(['[soa debug] trace-off']);
    } finally {
      if (savedDebug === undefined) {
        try {
          delete (globalThis as Record<string, unknown>).__SOA_DEBUG;
        } catch {
          /* ignore */
        }
      } else {
        Object.defineProperty(globalThis, '__SOA_DEBUG', savedDebug);
      }
      cap.restore();
    }
  });
});

describe('上报 transport(payload 形状 + 降级)', () => {
  it('payload 形状:POST /logs + {ts, level, message, platform},keepalive', () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init: init ?? {} });
      return { ok: true } as Response;
    }) as unknown as typeof fetch;
    const reporter = makeReporter(fakeFetch, () => 'http://logs.test/logs');
    reporter('error', 'boom', 'web');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://logs.test/logs');
    const init = calls[0].init;
    expect(init.method).toBe('POST');
    expect(init.keepalive).toBe(true);
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(payload.level).toBe('error');
    expect(payload.message).toBe('boom');
    expect(payload.platform).toBe('web');
    expect(typeof payload.ts).toBe('string');
    expect(Number.isNaN(new Date(String(payload.ts)).getTime())).toBe(false);
  });

  it('endpoint 为空 → 不上报(不上报风暴)', () => {
    const calls: string[] = [];
    const fakeFetch = (async (url: string) => {
      calls.push(url);
      return { ok: true } as Response;
    }) as unknown as typeof fetch;
    const reporter = makeReporter(fakeFetch, () => '');
    reporter('info', 'x', 'rn');
    expect(calls).toHaveLength(0);
  });

  it('上报失败静默,不抛(降级不打断业务)', () => {
    const reporter = makeReporter(
      (async () => {
        throw new Error('net down');
      }) as unknown as typeof fetch,
      () => 'http://x/logs',
    );
    expect(() => reporter('warn', 'x', 'web')).not.toThrow();
  });

  it('web 默认端点 = location.origin/logs', () => {
    const saved = stash(['window', 'document']);
    try {
      setGlobal('window', { location: { origin: 'http://localhost:8090' } });
      setGlobal('document', {});
      expect(reportEndpoint()).toBe('http://localhost:8090/logs');
    } finally {
      restore(saved);
    }
  });

  it('RN 端点取 EXPO_PUBLIC_LOG_ENDPOINT;空/未设 → 不上报', () => {
    const saved = stash(['navigator']);
    const oldEndpoint = process.env.EXPO_PUBLIC_LOG_ENDPOINT;
    try {
      setGlobal('navigator', { product: 'ReactNative' });
      process.env.EXPO_PUBLIC_LOG_ENDPOINT = 'http://rn/logs';
      expect(reportEndpoint()).toBe('http://rn/logs');
      delete process.env.EXPO_PUBLIC_LOG_ENDPOINT;
      expect(reportEndpoint()).toBe('');
    } finally {
      if (oldEndpoint === undefined) delete process.env.EXPO_PUBLIC_LOG_ENDPOINT;
      else process.env.EXPO_PUBLIC_LOG_ENDPOINT = oldEndpoint;
      restore(saved);
    }
  });

  it('web 模式 log() 端到端:同源 /logs 上报(替换全局 fetch)', () => {
    const saved = stash(['window', 'document', 'fetch']);
    const calls: Array<{ url: string; init: RequestInit }> = [];
    try {
      setGlobal('window', { location: { origin: 'http://localhost:8081' } });
      setGlobal('document', {});
      setGlobal('fetch', (async (url: string, init?: RequestInit) => {
        calls.push({ url, init: init ?? {} });
        return { ok: true } as Response;
      }) as unknown as typeof fetch);
      log('warn', 'leak?');
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('http://localhost:8081/logs');
      const payload = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
      expect(payload).toMatchObject({ level: 'warn', message: 'leak?', platform: 'web' });
    } finally {
      restore(saved);
    }
  });
});

describe('RN 沙盒文件 transport(注入 fake file API)', () => {
  it('append 到 Paths.document/soa-logs.log,行格式含 platform:rn', () => {
    const { fs, store } = fakeFs();
    const write = makeRnFileTransport(fs, () => false);
    write('error', 'boom');
    write('info', 'two');
    const s = store.get(RN_LOG_FILE)!;
    expect(s.exists).toBe(true);
    expect(s.creates).toBe(1); // 首个写入创建文件
    expect(s.writes).toBe(2);
    const lines = s.content.split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \| ERROR \| \[soa\] boom \(platform:rn\)$/);
    expect(lines[1]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \| INFO \| \[soa\] two \(platform:rn\)$/);
  });

  it('≥5MB 轮转:旧文件 → soa-logs.log.1,新文件续写', () => {
    const { fs, store } = fakeFs();
    const write = makeRnFileTransport(fs, () => false);
    const oldFile = new fs.File('doc', RN_LOG_FILE);
    oldFile.write('old line\n');
    store.get(RN_LOG_FILE)!.content = 'x'.repeat(5 * 1024 * 1024); // 撑到 ≥5MB → 触发轮转
    write('error', 'after');
    const s = store.get(RN_LOG_FILE)!;
    expect(s.moves).toBe(1); // 轮转发生
    expect(store.get(`${RN_LOG_FILE}.1`)!.content).toBe('x'.repeat(5 * 1024 * 1024)); // 旧文件整体 → .1
    expect(s.creates).toBe(1); // 轮转后新文件 create
    expect(s.content).toContain('| ERROR | [soa] after (platform:rn)');
  });

  it('F03 二次轮转:上一代 .1 已存在 → overwrite 覆盖成功,日志仍续写', () => {
    const { fs, store } = fakeFs();
    const write = makeRnFileTransport(fs, () => false);
    const oldFile = new fs.File('doc', RN_LOG_FILE);
    oldFile.write('gen1\n');
    store.get(RN_LOG_FILE)!.content = 'g1'.repeat(5 * 1024 * 1024); // 撑到 ≥5MB → 首次轮转
    write('error', 'first');
    expect(store.get(`${RN_LOG_FILE}.1`)!.content).toBe('g1'.repeat(5 * 1024 * 1024)); // 首次轮转:无 .1 冲突

    // 首次轮转后主文件 exists=false(已移走);模拟再次写满:恢复 exists + 内容
    const gen2 = store.get(RN_LOG_FILE)!;
    gen2.exists = true;
    gen2.content = 'g2'.repeat(5 * 1024 * 1024);
    write('info', 'second');
    expect(store.get(`${RN_LOG_FILE}.1`)!.content).toBe('g2'.repeat(5 * 1024 * 1024)); // 旧 .1 被覆盖
    expect(store.get(RN_LOG_FILE)!.moves).toBe(2); // 两次轮转都成功
    expect(store.get(RN_LOG_FILE)!.content).toContain('| INFO | [soa] second (platform:rn)'); // 新文件续写
  });

  it('NODE_ENV=test → 不写文件(默认门控)', () => {
    const { fs, store } = fakeFs();
    const write = makeRnFileTransport(fs); // 默认 fileWriteDisabled:vitest NODE_ENV==='test'
    write('error', 'boom');
    expect(store.size).toBe(0); // 未触碰任何文件 API
  });

  it('SOA_LOG_FILE=0 → 不写文件;=1 → 写(环境门控)', () => {
    withEnv({ NODE_ENV: 'production', SOA_LOG_FILE: '0' }, () => {
      expect(fileWriteDisabled()).toBe(true);
    });
    withEnv({ NODE_ENV: 'production', SOA_LOG_FILE: '1' }, () => {
      expect(fileWriteDisabled()).toBe(false);
    });
    // vitest 默认 NODE_ENV=test → 关
    expect(fileWriteDisabled()).toBe(true);
  });

  it('formatLogLine 输出 <ts> | <LEVEL> | [soa] <msg> (platform:<p>)', () => {
    expect(formatLogLine(new Date(2026, 7, 11, 12, 0, 0), 'error', 'smoke', 'web')).toBe(
      '2026-08-11 12:00:00 | ERROR | [soa] smoke (platform:web)',
    );
  });

  it('RN 模式 log():无端点不上报,沙盒 import 失败静默降级(不抛)', async () => {
    const saved = stash(['navigator']);
    const oldEndpoint = process.env.EXPO_PUBLIC_LOG_ENDPOINT;
    try {
      setGlobal('navigator', { product: 'ReactNative' });
      delete process.env.EXPO_PUBLIC_LOG_ENDPOINT;
      expect(() => log('warn', 'rn-only')).not.toThrow();
      await new Promise((r) => setTimeout(r, 10)); // 让动态 import 失败 settle(被 catch 吞掉)
    } finally {
      if (oldEndpoint === undefined) delete process.env.EXPO_PUBLIC_LOG_ENDPOINT;
      else process.env.EXPO_PUBLIC_LOG_ENDPOINT = oldEndpoint;
      restore(saved);
    }
  });
});
