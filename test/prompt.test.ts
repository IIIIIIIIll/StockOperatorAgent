import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import * as prompt from '../src/prompt.ts';

const fixture = JSON.parse(fs.readFileSync('test/fixtures/prompts.json', 'utf8')) as Record<
  string,
  string
>;

describe('prompt verbatim port (AC6)', () => {
  for (const [key, expected] of Object.entries(fixture)) {
    it(`${key} matches Python prompt.py exactly`, () => {
      expect((prompt as Record<string, unknown>)[key], key).toBe(expected);
    });
  }
});

describe('marketPromptRules（S4 市场提示词规则）', () => {
  it('cn:market_cycle 与改造前逐字节一致,market_rules 空串(拼接零差异)', () => {
    expect(prompt.marketPromptRules('cn')).toEqual({
      market_cycle: '考虑中国市场的特殊周期性',
      market_rules: '',
    });
  });

  it('hk:market_cycle/market_rules 文案', () => {
    expect(prompt.marketPromptRules('hk')).toEqual({
      market_cycle: '考虑港股市场的特殊周期性（T+0 结算、无涨跌停限制、港币计价）',
      market_rules: '本次分析对象为港股。注意：港股实行 T+0 交收、无日涨跌幅限制、交易时段 9:30-12:00/13:00-16:00；财报以半年报+年报为主；报价货币为港币。',
    });
  });

  it('us:market_cycle/market_rules 文案', () => {
    expect(prompt.marketPromptRules('us')).toEqual({
      market_cycle: '考虑美股市场的特殊周期性（T+0 结算、无涨跌停限制、美元计价、盘前盘后交易与财报季效应）',
      market_rules: '本次分析对象为美股。注意：美股实行 T+0 交收、无日涨跌幅限制、存在盘前盘后交易；财报为季度制；报价货币为美元；注意拆股/合股与 ADR 对价格序列的影响。',
    });
  });
});
