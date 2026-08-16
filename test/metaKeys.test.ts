// metaKeys 单测 —— 键模板工厂 + demo ticker 单点 + caps 默认值一致性。
// 钉死 wire 格式(demo:f10 / f10:<ticker> / capital:<ticker> / '600036'):
// meta 键是跨会话持久化的读写字面量,键名漂移 → 旧数据读不到;
// caps 默认值两处(settings 面板面与 billionsTools env/兜底面)必须同源同值。
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { capitalKey, DEMO_F10_KEY, DEMO_TICKER, f10Key } from '../src/metaKeys.ts';
import { BILLIONS_DEFAULT_MAX } from '../src/billionsTools.ts';
import { defaultSettings } from '../app/lib/settings.ts';

describe('metaKeys 键模板工厂', () => {
  it('f10Key:每股 F10 meta 键 = f10:<ticker>', () => {
    expect(f10Key('600036')).toBe('f10:600036');
    expect(f10Key('002027')).toBe('f10:002027');
  });

  it('capitalKey:每股股本结构 meta 键 = capital:<ticker>', () => {
    expect(capitalKey('600036')).toBe('capital:600036');
    expect(capitalKey('002027')).toBe('capital:002027');
  });

  it('DEMO_F10_KEY 钉死 wire 格式 demo:f10(跨会话键名不可漂移)', () => {
    expect(DEMO_F10_KEY).toBe('demo:f10');
  });
});

describe('DEMO_TICKER 单点', () => {
  it('与 app/data/demo.json 的 ticker 一致(换 demo 票须同步两处)', () => {
    const demo = JSON.parse(fs.readFileSync('app/data/demo.json', 'utf8')) as { ticker: string };
    expect(DEMO_TICKER).toBe(demo.ticker);
  });
});

describe('caps 默认值单一来源', () => {
  it('settings DEFAULT_CAPS 与 billionsTools BILLIONS_DEFAULT_MAX 同源同值', () => {
    const caps = defaultSettings().caps;
    expect(caps).toEqual({
      searchMax: BILLIONS_DEFAULT_MAX.SEARCH,
      twitterMax: BILLIONS_DEFAULT_MAX.TWITTER,
      fetchMax: BILLIONS_DEFAULT_MAX.FETCH,
    });
  });

  it('业务契约钉死:search 3 / twitter 2 / fetch 3(env BILLIONS_{CAP}_MAX_CALLS 默认面)', () => {
    expect(BILLIONS_DEFAULT_MAX).toEqual({ SEARCH: 3, TWITTER: 2, FETCH: 3 });
  });
});
