// xdxr 除权除息命令移植（移植自 pytdx GetXdXrInfo，data 段 + 响应解析）
import { TdxClient, CommandType } from 'node-tdx-market';

export interface XdxrEvent {
  market: number;
  code: string;
  year: number;
  month: number;
  day: number;
  category: number;
  name: string;
  // category==1 除权除息
  fenhong: number | null; // 每10股派现（元）
  peigujia: number | null; // 配股价（元/股）
  songzhuangu: number | null; // 每10股送转
  peigu: number | null; // 每10股配股
  // category 11/12 扩缩股
  suogu: number | null;
  // category 13/14
  fenshu: number | null;
  xingquanjia: number | null;
}

const XDXR_CATEGORY_NAMES: Record<number, string> = {
  1: '除权除息', 2: '送配股上市', 3: '非流通股上市', 4: '未知股本变动',
  5: '股本变化', 6: '增发新股', 7: '股份回购', 8: '增发新股上市',
  9: '转配股上市', 10: '可转债上市', 11: '扩缩股', 12: '非流通股缩股',
  13: '送认购权证', 14: '送认沽权证',
};

export function parseXdxrResponse(body: Buffer): XdxrEvent[] {
  if (body.length < 11) return [];
  let pos = 9;
  const num = body.readUInt16LE(pos);
  pos += 2;
  const rows: XdxrEvent[] = [];
  for (let i = 0; i < num && pos + 29 <= body.length; i++) {
    const market = body[pos];
    const code = body.toString('ascii', pos + 1, pos + 7).replace(/\0/g, '');
    pos += 7;
    pos += 1; // skip
    const zipday = body.readUInt32LE(pos);
    pos += 4;
    const year = Math.floor(zipday / 10000);
    const month = Math.floor((zipday % 10000) / 100);
    const day = zipday % 100;
    const category = body[pos];
    pos += 1;
    const base: XdxrEvent = {
      market, code, year, month, day, category,
      name: XDXR_CATEGORY_NAMES[category] ?? String(category),
      fenhong: null, peigujia: null, songzhuangu: null, peigu: null,
      suogu: null, fenshu: null, xingquanjia: null,
    };
    if (category === 1) {
      base.fenhong = body.readFloatLE(pos);
      base.peigujia = body.readFloatLE(pos + 4);
      base.songzhuangu = body.readFloatLE(pos + 8);
      base.peigu = body.readFloatLE(pos + 12);
    } else if (category === 11 || category === 12) {
      base.suogu = body.readFloatLE(pos + 8);
    } else if (category === 13 || category === 14) {
      base.xingquanjia = body.readFloatLE(pos);
      base.fenshu = body.readFloatLE(pos + 8);
    }
    // else: 股本变化 4×u32（get_volume 近似，qfq 不消费，M1 处理）
    pos += 16;
    rows.push(base);
  }
  return rows;
}

// 继承 TdxClient，利用公开的 sendCommand 发 Gbbq 命令
export async function getXdxrInfo(
  client: TdxClient, market: number, code: string,
): Promise<XdxrEvent[]> {
  // data 段 = count(u16) + market(u8) + code(6) —— 对齐 pytdx pkg 命令号后的负载
  // （M0 实测：缺 count 服务器返回 0 条，见 research/m0-d3-xdxr-qfq.md）
  const data = Buffer.alloc(9);
  data.writeUInt16LE(1, 0);
  data.writeUInt8(market, 2);
  data.write(code, 3, 6, 'ascii');
  const resp = await (client as unknown as {
    sendCommand(o: { type: number; data: Buffer }): Promise<{ data: Buffer }>;
  }).sendCommand({ type: CommandType.Gbbq, data });
  return parseXdxrResponse(resp.data);
}
