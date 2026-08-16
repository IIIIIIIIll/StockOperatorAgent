// 显式开关配置单测 —— 08-16-config-injection 契约 2:
// fromEnv 旧 DISABLED 语义逐位等价反推、setCapabilitySwitches 注入覆盖、
// getCapabilitySwitches 懒初始化、每开关 false/true 两态消费点、
// TDX_MCP_ENABLED 覆盖层优先级(env 覆盖 > config > env 默认)。
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  fromEnv,
  getCapabilitySwitches,
  setCapabilitySwitches,
  type CapabilitySwitches,
} from '../src/switches.ts';
import { mcpDisabled } from '../src/mcp.ts';
import { webSearchEnabled } from '../src/webSearch.ts';
import { billionsEnabled, informationAnalystEnabled } from '../src/committee.ts';
import { makeBillionsTools } from '../src/billionsTools.ts';
import { defaultSettings, switchesToCapabilities } from '../app/lib/settings.ts';

const ALL_TRUE: CapabilitySwitches = {
  tdxMcp: true, webSearch: true, billions: true,
  findb: true, search: true, twitter: true, fetch: true, analyst: true,
};

const DISABLED_KEYS = [
  'TDX_MCP_DISABLED', 'WEB_SEARCH_DISABLED', 'BILLIONS_DISABLED',
  'BILLIONS_FINDB_DISABLED', 'BILLIONS_SEARCH_DISABLED', 'BILLIONS_TWITTER_DISABLED',
  'BILLIONS_FETCH_DISABLED', 'BILLIONS_ANALYST_DISABLED', 'TDX_MCP_ENABLED',
] as const;

const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of DISABLED_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of DISABLED_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  // 配置面回 env 反推(防跨用例残留;显式注入用例各自先 setCapabilitySwitches)
  setCapabilitySwitches(fromEnv());
});

describe('getCapabilitySwitches 懒初始化(未注入 → fromEnv)', () => {
  // 本 describe 排首位:模块加载后 current === null,首次读取走 fromEnv 路径。
  it('未注入时首次读取从 env 反推;注入后返回注入值', () => {
    process.env.WEB_SEARCH_DISABLED = '1';
    expect(getCapabilitySwitches().webSearch).toBe(false); // current === null → fromEnv
    setCapabilitySwitches({ ...ALL_TRUE, webSearch: true });
    expect(getCapabilitySwitches().webSearch).toBe(true); // 注入覆盖 env 默认
  });
});

describe('fromEnv:旧 DISABLED 语义反推(与旧 envDisabledBool 逐位等价)', () => {
  it('全键缺省 → 全开(等价面板全开)', () => {
    expect(fromEnv()).toEqual(ALL_TRUE);
    // 默认等价:env 反推 == 面板默认开关(switchesToCapabilities 直映)
    expect(fromEnv()).toEqual(switchesToCapabilities(defaultSettings().switches));
  });

  it.each(['', '0', 'false', 'no'])('键值 %j → enabled(显式假值不禁用)', (v) => {
    for (const k of DISABLED_KEYS) process.env[k] = v;
    expect(fromEnv()).toEqual(ALL_TRUE);
  });

  it.each(['1', 'true', 'yes', 'TRUE', '任意串'])('键值 %j → disabled', (v) => {
    for (const k of DISABLED_KEYS) process.env[k] = v;
    expect(fromEnv()).toEqual({
      tdxMcp: false, webSearch: false, billions: false,
      findb: false, search: false, twitter: false, fetch: false, analyst: false,
    });
  });

  it('逐键独立:单键关其余开(键名 ↔ 字段映射)', () => {
    const cases: Array<[string, keyof CapabilitySwitches]> = [
      ['TDX_MCP_DISABLED', 'tdxMcp'],
      ['WEB_SEARCH_DISABLED', 'webSearch'],
      ['BILLIONS_DISABLED', 'billions'],
      ['BILLIONS_FINDB_DISABLED', 'findb'],
      ['BILLIONS_SEARCH_DISABLED', 'search'],
      ['BILLIONS_TWITTER_DISABLED', 'twitter'],
      ['BILLIONS_FETCH_DISABLED', 'fetch'],
      ['BILLIONS_ANALYST_DISABLED', 'analyst'],
    ];
    for (const [key, field] of cases) {
      process.env[key] = '1';
      const s = fromEnv();
      expect(s[field], `${key} → ${field} 应为关`).toBe(false);
      for (const [otherKey, otherField] of cases) {
        if (otherKey !== key) expect(s[otherField], `${otherKey} 不受 ${key} 影响`).toBe(true);
      }
      delete process.env[key];
    }
  });
});

describe('setCapabilitySwitches 注入覆盖 env 默认', () => {
  it('注入后 getCapabilitySwitches 返回注入值(不读 env)', () => {
    process.env.TDX_MCP_DISABLED = '1';
    process.env.WEB_SEARCH_DISABLED = '1';
    setCapabilitySwitches(ALL_TRUE);
    const s = getCapabilitySwitches();
    expect(s.tdxMcp).toBe(true);
    expect(s.webSearch).toBe(true);
  });

  it('注入全关 → 全关;再注入全开 → 全开(可重复覆盖)', () => {
    setCapabilitySwitches({ ...ALL_TRUE, tdxMcp: false, webSearch: false });
    expect(getCapabilitySwitches().tdxMcp).toBe(false);
    setCapabilitySwitches(ALL_TRUE);
    expect(getCapabilitySwitches().webSearch).toBe(true);
  });
});

describe('消费点两态(每开关 false/true)', () => {
  // tdxMcp → mcpDisabled(TDX_MCP_ENABLED 未设,覆盖层不介入)
  it('tdxMcp:false → mcpDisabled true;true → false', () => {
    setCapabilitySwitches({ ...ALL_TRUE, tdxMcp: false });
    expect(mcpDisabled()).toBe(true);
    setCapabilitySwitches(ALL_TRUE);
    expect(mcpDisabled()).toBe(false);
  });

  // webSearch → webSearchEnabled(committee 装配与分析师预抓共用)
  it('webSearch:false → webSearchEnabled false;true → true', () => {
    setCapabilitySwitches({ ...ALL_TRUE, webSearch: false });
    expect(webSearchEnabled()).toBe(false);
    setCapabilitySwitches(ALL_TRUE);
    expect(webSearchEnabled()).toBe(true);
  });

  // billions 主闸 → 亿信全能力关(有 key 也不绑定工具)
  it('billions:false → 亿信能力全关;true → 开', () => {
    setCapabilitySwitches({ ...ALL_TRUE, billions: false });
    expect(billionsEnabled('SEARCH')).toBe(false);
    expect(billionsEnabled('FINDB')).toBe(false);
    expect(makeBillionsTools({ apiKey: 'k' })).toEqual([]);
    setCapabilitySwitches(ALL_TRUE);
    expect(billionsEnabled('SEARCH')).toBe(true);
  });

  // findb → billionsEnabled('FINDB')(runner 采集段门控)
  it('findb:false/true → billionsEnabled(FINDB)', () => {
    setCapabilitySwitches({ ...ALL_TRUE, findb: false });
    expect(billionsEnabled('FINDB')).toBe(false);
    setCapabilitySwitches(ALL_TRUE);
    expect(billionsEnabled('FINDB')).toBe(true);
  });

  // search / twitter / fetch → makeBillionsTools 绑定面
  it('search:false → 无 search 工具;true → 三件套', () => {
    setCapabilitySwitches({ ...ALL_TRUE, search: false });
    expect(makeBillionsTools({ apiKey: 'k' }).map((t) => t.name))
      .toEqual(['billions_twitter', 'billions_fetch']);
    setCapabilitySwitches(ALL_TRUE);
    expect(makeBillionsTools({ apiKey: 'k' }).map((t) => t.name))
      .toEqual(['billions_search', 'billions_twitter', 'billions_fetch']);
  });

  it('twitter:false → 无 twitter 工具;true → 三件套', () => {
    setCapabilitySwitches({ ...ALL_TRUE, twitter: false });
    expect(makeBillionsTools({ apiKey: 'k' }).map((t) => t.name))
      .toEqual(['billions_search', 'billions_fetch']);
    setCapabilitySwitches(ALL_TRUE);
    expect(makeBillionsTools({ apiKey: 'k' })).toHaveLength(3);
  });

  it('fetch:false → 无 fetch 工具;true → 三件套', () => {
    setCapabilitySwitches({ ...ALL_TRUE, fetch: false });
    expect(makeBillionsTools({ apiKey: 'k' }).map((t) => t.name))
      .toEqual(['billions_search', 'billions_twitter']);
    setCapabilitySwitches(ALL_TRUE);
    expect(makeBillionsTools({ apiKey: 'k' })).toHaveLength(3);
  });

  // analyst → informationAnalystEnabled(委员会信息面分析师注册谓词)
  it('analyst:false → 分析师关;true → 开(其余全开)', () => {
    setCapabilitySwitches({ ...ALL_TRUE, analyst: false });
    expect(informationAnalystEnabled()).toBe(false);
    setCapabilitySwitches(ALL_TRUE);
    expect(informationAnalystEnabled()).toBe(true);
  });
});

describe('TDX_MCP_ENABLED 覆盖层优先级(env 覆盖 > config > env 默认)', () => {
  it('ENABLED=true 覆盖 config 关 → 不禁用', () => {
    process.env.TDX_MCP_ENABLED = '1';
    setCapabilitySwitches({ ...ALL_TRUE, tdxMcp: false });
    expect(mcpDisabled()).toBe(false);
  });

  it.each(['0', 'false', 'no', ''])('ENABLED=%j 覆盖 config 开 → 禁用', (v) => {
    process.env.TDX_MCP_ENABLED = v;
    setCapabilitySwitches(ALL_TRUE);
    expect(mcpDisabled()).toBe(true);
  });

  it('无 ENABLED → config 生效(本层无覆盖)', () => {
    setCapabilitySwitches({ ...ALL_TRUE, tdxMcp: false });
    expect(mcpDisabled()).toBe(true);
    setCapabilitySwitches(ALL_TRUE);
    expect(mcpDisabled()).toBe(false);
  });
});
