// startGuards 单测(B6:输入校验抽出后文案可逐字钉住)。
// 这些文案是 UI/PRD 契约 —— 之前的回归方式是"改了文案没人发现,直到用户截图"。
import { describe, expect, it } from 'vitest';
import {
  BJ_UNSUPPORTED_MESSAGE,
  FORMAT_MESSAGES,
  checkStartInput,
} from '../app/lib/startGuards.ts';

describe('checkStartInput', () => {
  it('北交所拦截(4/8 开头 6 位):文案逐字 + 不改市场', () => {
    for (const code of ['430047', '830799', '  400001  ']) {
      const r = checkStartInput(code, 'cn');
      expect(r).toEqual({ ok: false, message: BJ_UNSUPPORTED_MESSAGE, market: null });
    }
  });

  it('同样 6 位数字在港股/美股市场不落北交所文案(归各自格式校验)', () => {
    const hk = checkStartInput('430047', 'hk');
    expect(hk.ok).toBe(false);
    if (!hk.ok) expect(hk.message).toBe(FORMAT_MESSAGES.hk);
  });

  it('沪深 A 股:6 位通过,非 6 位报格式错', () => {
    expect(checkStartInput('600036', 'cn')).toEqual({ ok: true, ticker: '600036', market: 'cn' });
    const bad = checkStartInput('6000', 'cn');
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.message).toBe(FORMAT_MESSAGES.cn);
      expect(bad.market).toBe('cn'); // 徽标要跟着文案走
    }
  });

  it('港股:1-5 位 → 归一化为 4 位官方码', () => {
    expect(checkStartInput('700', 'hk')).toEqual({ ok: true, ticker: '0700.HK', market: 'hk' });
  });

  it('美股:字母开头大小写归一', () => {
    const r = checkStartInput('aapl', 'us');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.ticker).toBe('AAPL');
  });

  it('美股非法(数字开头)报美式文案', () => {
    const r = checkStartInput('600036', 'us');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe(FORMAT_MESSAGES.us);
  });
});
