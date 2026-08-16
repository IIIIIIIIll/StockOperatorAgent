// 供 vitest(ts/test/log-server.test.ts)类型引用;运行时由 Node 直接加载 .cjs
// (实现见 logs-server.cjs,metro/server 双份入口共享)。
declare const logsServer: {
  handleLogs(
    req: AsyncIterable<Uint8Array>,
    res: { writeHead(status: number, headers?: Record<string, string>): void; end(body?: unknown): void },
  ): Promise<void>;
  logFilePath(): string;
  setLogDir(dir: string): void;
  formatTs(ts?: unknown): string;
  sanitizeLine(s: string): string;
  appendLogLine(line: string): void;
  MAX_LOG_BYTES: number;
  MAX_MESSAGE_BYTES: number;
  MAX_BODY_BYTES: number;
};
export = logsServer;
