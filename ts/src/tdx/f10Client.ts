// F10 公司资料客户端 —— 移植自 pytdx GetCompanyInfoCategory / GetCompanyInfoContent
// node-tdx-market 已内置 CommandType.CompanyCategory(719) / CompanyContent(720)
// 协议布局见 research/m0-d4-f10.md
import { CommandType, TdxClient, inferExchange } from 'node-tdx-market';

/** F10 market 参数(pytdx 契约:0=深 1=沪);inferExchange SZ=0/SH=1 直接对齐。
 *  探针早期硬编码 1(沪)只对 6xxxxx 正确,深市 002027/300xxx 需 0。 */
export function f10MarketFor(ticker: string): number {
  return inferExchange(ticker) as number;
}

export interface F10Category {
  name: string;
  filename: string;
  start: number;
  length: number;
}

function stripGbk(buf: Uint8Array): string {
  const z = buf.indexOf(0);
  const s = z === -1 ? buf : buf.subarray(0, z);
  return new TextDecoder('gbk').decode(s);
}

export function parseCategoryResponse(body: Buffer): F10Category[] {
  if (body.length < 2) return [];
  const num = body.readUInt16LE(0);
  const rows: F10Category[] = [];
  let pos = 2;
  for (let i = 0; i < num && pos + 152 <= body.length; i++) {
    const name = stripGbk(body.subarray(pos, pos + 64));
    const filename = stripGbk(body.subarray(pos + 64, pos + 144));
    const start = body.readUInt32LE(pos + 144);
    const length = body.readUInt32LE(pos + 148);
    pos += 152;
    rows.push({ name, filename, start, length });
  }
  return rows;
}

export function parseContentResponse(body: Buffer): string {
  const length = body.readUInt16LE(10);
  return new TextDecoder('gbk').decode(body.subarray(12, 12 + length));
}

export async function getCompanyInfoCategory(
  client: TdxClient,
  market: number,
  code: string,
): Promise<F10Category[]> {
  const data = Buffer.alloc(12);
  data.writeUInt16LE(market, 0);
  data.write(code, 2, 6, 'ascii');
  const resp = await client.sendCommand({ type: CommandType.CompanyCategory, data });
  return parseCategoryResponse(resp.data);
}

export async function getCompanyInfoContent(
  client: TdxClient,
  market: number,
  code: string,
  filename: string,
  start: number,
  length: number,
): Promise<string> {
  const data = Buffer.alloc(102);
  data.writeUInt16LE(market, 0);
  data.write(code, 2, 6, 'ascii');
  data.write(filename.padEnd(80, '\0'), 10, 80, 'ascii');
  data.writeUInt32LE(start, 90);
  data.writeUInt32LE(length, 94);
  const resp = await client.sendCommand({ type: CommandType.CompanyContent, data });
  return parseContentResponse(resp.data);
}
