// FinnhubClient 单测（fake fetch 注入；house style 无 mock 框架）。
// 覆盖：无 key 零网络 null / 正常透传（URL symbol+token）/ 429 归一化抛错 /
// 网络异常归一化。
import { describe, expect, it } from 'vitest';
import { FinnhubClient, FinnhubApiError } from '../src/finnhub/finnhubClient.ts';

const PROFILE = {
  country: 'US',
  currency: 'USD',
  exchange: 'NASDAQ',
  ipo: '1980-12-12',
  marketCapitalization: 3_400_000,
  name: 'Apple Inc',
  shareOutstanding: 15_300_000_000,
  ticker: 'AAPL',
  weburl: 'https://www.apple.com/',
  logo: 'https://static.finnhub.io/logo/87cb30d8-80df-11ea-8951-00000000092a.png',
  finnhubIndustry: 'Technology',
};

describe('FinnhubClient.companyProfile2', () => {
  it('无 key → 返回 null 且零网络', async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      throw new Error('不应发起请求');
    }) as unknown as typeof fetch;
    const client = new FinnhubClient(null, fetchImpl);
    await expect(client.companyProfile2('AAPL')).resolves.toBeNull();
    expect(called).toBe(false);
  });

  it('正常透传：URL 含 symbol 与 token，返回原始 JSON（含 finnhubIndustry）', async () => {
    let url = '';
    const fetchImpl = (async (u: string) => {
      url = u;
      return new Response(JSON.stringify(PROFILE), { status: 200 });
    }) as unknown as typeof fetch;
    const out = await new FinnhubClient('secret-token', fetchImpl).companyProfile2('AAPL');
    expect(out).toEqual(PROFILE);
    expect(url).toBe('https://finnhub.io/api/v1/stock/profile2?symbol=AAPL&token=secret-token');
  });

  it('429 → FinnhubApiError（code 取 body error，status_code=429），不重试', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: 'Limit Reach' }), { status: 429 });
    }) as unknown as typeof fetch;
    const err = new FinnhubClient('k', fetchImpl).companyProfile2('AAPL');
    await expect(err).rejects.toBeInstanceOf(FinnhubApiError);
    await expect(err).rejects.toMatchObject({ name: 'FinnhubApiError', code: 'Limit Reach', status_code: 429 });
    expect(calls).toBe(1);
  });

  it('非 2xx 非 JSON body → FinnhubApiError（code=null）', async () => {
    const fetchImpl = (async () => new Response('<html>oops</html>', { status: 502 })) as unknown as typeof fetch;
    await expect(new FinnhubClient('k', fetchImpl).companyProfile2('AAPL')).rejects.toMatchObject({
      name: 'FinnhubApiError',
      code: null,
      status_code: 502,
    });
  });

  it('网络异常 → FinnhubApiError（code=null, status_code=null）', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('net down');
    }) as unknown as typeof fetch;
    await expect(new FinnhubClient('k', fetchImpl).companyProfile2('AAPL')).rejects.toMatchObject({
      name: 'FinnhubApiError',
      code: null,
      status_code: null,
    });
  });
});
