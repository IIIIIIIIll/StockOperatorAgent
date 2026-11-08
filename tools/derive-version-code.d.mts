// 供 vitest(ts/test/version-code.test.ts)类型引用;运行时由 Node 直接加载 .mjs。
/** X.Y.Z → major*10000 + minor*100 + patch(0.1.10 → 110);非法格式抛错。 */
export declare function deriveVersionCode(version: string): number;
