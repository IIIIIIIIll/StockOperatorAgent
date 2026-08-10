// 日期展示归一化:TDX 采集为 YYYYMMDD(无横线),展示/图表(lightweight-charts
// 业务日)需 YYYY-MM-DD;demo 数据已是带横线格式。两种格式幂等处理。
export function fmtDate(d: string): string {
  return /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d;
}
