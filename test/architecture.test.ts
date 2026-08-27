// 架构静态断言(design.md 契约 3 的 7 条)—— 读源码文本,零运行时依赖。
// 目的:把"隐形约定"(08-16-modularity-audit 结论)变成可执行回归门,防 bundle
// 污染(node:/react-native/better-sqlite3 值 import)、防 meta 键名漂移、防
// process.env 直读扩散、防旧 app/lib/log 双入口回潮。
// 实现:node:fs 读文件 + 文本断言(test/ 在 Node 侧,node:fs 合法;同
// metaKeys.test.ts 的 fs 用法先例)。白名单只放行"当前合法用例",每条注释说明
// 理由;新增例外必须同时改这里并说明。
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ─── 文件收集 ───────────────────────────────────────────────────────────────
const SKIP_DIRS: Record<string, true> = {
  node_modules: true,
  dist: true,
  build: true,
  '.expo': true,
  android: true,
  ios: true,
};
function collectFiles(dir: string, exts: string[]): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name in SKIP_DIRS) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(full, exts));
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out.sort();
}

const SRC_TS = collectFiles('src', ['.ts']);
const APP_TS = collectFiles('app', ['.ts', '.tsx']);
const TOOLS_MTS = collectFiles('tools', ['.mts']);
const TEST_TS = collectFiles('test', ['.ts']);

// ─── 文本工具 ───────────────────────────────────────────────────────────────
interface StrippedLine {
  lineNo: number;
  text: string; // 已剥注释(保留字符串字面量——import specifier 是字符串,不能剥)
  raw: string; // 原始行(失败信息展示用)
}

/** 剥掉 // 行注释与块注释(跨行状态机;字符串字面量内的 // 与注释记号不误判;
 *  模板字符串 ${} 插值不解析——现状无 process.env 插值,属已知边界)。 */
function stripComments(file: string): StrippedLine[] {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const out: StrippedLine[] = [];
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let res = '';
    let quote: string | null = null;
    let j = 0;
    while (j < line.length) {
      const c = line[j];
      if (inBlock) {
        if (c === '*' && line[j + 1] === '/') {
          inBlock = false;
          j += 2;
        } else j++;
        continue;
      }
      if (quote !== null) {
        res += c;
        if (c === '\\') {
          res += line[j + 1] ?? '';
          j += 2;
          continue;
        }
        if (c === quote) quote = null;
        j++;
        continue;
      }
      if (c === '/' && line[j + 1] === '/') break; // 行注释 → 丢弃余下
      if (c === '/' && line[j + 1] === '*') {
        inBlock = true;
        j += 2;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        quote = c;
        res += c;
        j++;
        continue;
      }
      res += c;
      j++;
    }
    out.push({ lineNo: i + 1, text: res, raw: line });
  }
  return out;
}

function fmt(v: StrippedLine, file: string): string {
  return `${file}:${v.lineNo}: ${v.raw.trim()}`;
}

/** 扫描文件集合,断言每条违规(返回违规描述数组,空 = 通过)。 */
function scan(
  files: string[],
  test: (t: string, file: string) => boolean,
  skipFile?: (file: string) => boolean,
): string[] {
  const out: string[] = [];
  for (const file of files) {
    if (skipFile?.(file)) continue;
    for (const line of stripComments(file)) {
      if (test(line.text, file)) out.push(fmt(line, file));
    }
  }
  return out;
}

/** 静态白名单表(ts-set-map 规则:静态 string 键查找用 Record,不用 Set)。 */
type Whitelist = Record<string, true>;

// ─── 断言 1:src 无 node: 内置 import ────────────────────────────────────────
// 白名单 src/store-node.ts:Node-only 桌面后端适配器(仅 tools/desktop-probe.mts
// / 桌面主进程 import,不进 metro 图——metro 无 fs shim,静态即炸、动态同样解析
// 失败;设计契约 1 明文豁免)。其余 src 文件禁 node: 前缀(含动态 import)。
const NODE_WHITELIST: Whitelist = { 'src/store-node.ts': true };

describe('契约 1:src 无 node: 内置 import(store-node.ts 白名单)', () => {
  it('src/**/*.ts 禁静态/动态 node: import(metro 无 fs shim)', () => {
    const violations = scan(
      SRC_TS,
      (t) => /(?:from\s*|require\(\s*|import\(\s*)['"]node:/.test(t),
      (f) => f in NODE_WHITELIST,
    );
    expect(violations, `node: import 仅限 ${Object.keys(NODE_WHITELIST).join(', ')}(Node-only,不进 metro 图)`).toEqual([]);
  });
});

// ─── 断言 2:src 无 react-native import ─────────────────────────────────────
// 无白名单:src 是 web/RN/node 三端共享业务层,任何 react-native import 都会把
// RN 平台符号静态拉进 web/node 编译面(08-16 audit B 结论)。
describe('契约 2:src 无 react-native import(平台纯净)', () => {
  it('src/**/*.ts 禁 from/react-native', () => {
    const violations = scan(
      SRC_TS,
      (t) => /(?:from\s*|require\(\s*|import\(\s*)['"]react-native['"]/.test(t),
    );
    expect(violations, 'react-native import 只允许出现在 app/(RN 专属层)').toEqual([]);
  });
});

// ─── 断言 3:better-sqlite3 仅 type import ──────────────────────────────────
// 白名单:
// - src/store.ts:better-sqlite3 的**实现本体**(SQLite 仓储;Node-only,消费方
//   全部 import type { StoreLike },故 store.ts 永不进 metro 图——08-16 audit
//   实证"值 import 仅 4 处全在 Node 侧")。实现面必须有值 import,这是唯一例外。
// - tools/probe.mts + test/**:Node 侧探针/测试环境(设计契约 3 明文白名单;
//   值 import Store 拖 better-sqlite3 链,仅 Node 运行时可达)。
// 断言:src/ 与 app/ 无 better-sqlite3 / Store 值 import(必须 type-only)。
const BS3_DIRECT_WHITELIST: Whitelist = { 'src/store.ts': true, 'tools/probe.mts': true };
const STORE_VALUE_WHITELIST: Whitelist = { 'tools/probe.mts': true };

describe('契约 3:better-sqlite3 仅 type import(值 import 白名单 probe/test)', () => {
  it('better-sqlite3 直接值 import 仅限实现面 store.ts 与 Node 侧白名单', () => {
    const all = [...SRC_TS, ...APP_TS, ...TOOLS_MTS, ...TEST_TS];
    const violations = scan(
      all,
      (t) =>
        !/import\s+type\b/.test(t) && // type-only 擦除,合法
        /(?:from\s*|require\(\s*|import\(\s*)['"]better-sqlite3['"]/.test(t),
      (f) => f in BS3_DIRECT_WHITELIST || f.startsWith('test/'),
    );
    expect(violations, 'better-sqlite3 值 import 仅限 src/store.ts(实现本体)+ tools/probe.mts + test/*').toEqual([]);
  });

  it('src/app 无 Store 值 import(store.ts 消费方必须 type-only)', () => {
    const violations = scan(
      [...SRC_TS, ...APP_TS],
      (t) =>
        !/import\s+type\b/.test(t) &&
        (/(?:import\s+\{[^}]*\bStore\b[^}]*\}\s*from\s*['"][^'"]*store\.ts['"])/.test(t) ||
          /import\s+Store\s+from\s*['"][^'"]*store\.ts['"]/.test(t)),
      (f) => f in STORE_VALUE_WHITELIST || f.startsWith('test/'),
    );
    expect(violations, 'Store 值 import 会把 better-sqlite3 拖进 web/RN bundle——必须 import type { StoreLike }').toEqual([]);
  });
});

// ─── 断言 4:src 无 declare global 含 DOM 名 ─────────────────────────────────
// 仅检查 `declare global { ... }` 块内容:window/document/navigator/location 是
// 双 tsconfig(根 node-only vs app DOM lib)冲突面,禁止 global 增强;自定义名
// (如 __SOA_DEBUG)允许。模块级 `declare const window`(log.ts/webSearch.ts 的
// typeof 守卫探针)不是 global 增强、运行时守卫,属 spec 认可先例,不在断言面。
const DOM_GLOBALS = /\b(window|document|navigator|location)\b/;

describe('契约 4:src 无 declare global 含 DOM 全局名(允许自定义名)', () => {
  it('declare global 块内容不得含 window/document/navigator/location', () => {
    const violations: string[] = [];
    for (const file of SRC_TS) {
      const lines = stripComments(file);
      const text = lines.map((l) => l.text).join('\n');
      // 找每个 `declare global` 后的平衡花括号块
      const re = /declare\s+global\s*\{/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        let depth = 1;
        let i = m.index + m[0].length;
        while (i < text.length && depth > 0) {
          if (text[i] === '{') depth++;
          else if (text[i] === '}') depth--;
          i++;
        }
        const block = text.slice(m.index + m[0].length, i - 1);
        if (DOM_GLOBALS.test(block)) {
          const lineNo = text.slice(0, m.index).split('\n').length;
          violations.push(`${file}:${lineNo}: ${lines[lineNo - 1].raw.trim()}`);
        }
        re.lastIndex = i;
      }
    }
    expect(violations, 'declare global 内禁 DOM 名(双 tsconfig 冲突面);DOM 探针用模块级 declare const + typeof 守卫').toEqual([]);
  });
});

// ─── 断言 5:src+app 无 meta 键裸字面量 ─────────────────────────────────────
// 白名单:
// - src/metaKeys.ts:键名/模板的**唯一定义面**(08-16-audit-remediation 契约:
//   demo:f10 / f10:${ticker} / capital:${ticker} / name:${ticker} /
//   DEMO_TICKER 全部 const/模板化于此;换键名/换 demo 票只改一处)。整文件豁免
//   (注释也在解释这些键)。name:${ticker} 于 08-27-golive-cleanup-nits F36 并入
//   (quoteClient 曾裸写该模板,META_PATTERNS 原为 4 条不覆盖 → 审计漏网)。
// - app/data/demo.json:demo 数据集文件(ticker 数据本身,非代码字面量)。
// 断言:src/app 其余文件不得再裸写这些跨会话持久化键(键漂移 → 旧数据读不到)。
const META_WHITELIST: Whitelist = { 'src/metaKeys.ts': true, 'app/data/demo.json': true };
const META_PATTERNS = [/demo:f10/, /f10:\$\{/, /capital:\$\{/, /name:\$\{/, /600036/];

describe('契约 5:src+app 无 meta 键裸字面量(metaKeys.ts 定义面 + demo.json 白名单)', () => {
  it('src/app 其余文件禁裸写 demo:f10 / f10:${ / capital:${ / name:${ / 600036', () => {
    const files = [...SRC_TS, ...APP_TS, 'app/data/demo.json'].filter((f) => fs.existsSync(f));
    const violations = scan(
      files,
      (t) => META_PATTERNS.some((p) => p.test(t)),
      (f) => f in META_WHITELIST,
    );
    expect(violations, 'meta 键与 demo ticker 一律经 src/metaKeys.ts 引用(键名单源)').toEqual([]);
  });
});

// ─── 断言 6:process.env 零写入;读取仅 src/env.ts + EXPO_PUBLIC 直读 ────────
// 白名单:
// - src/env.ts:envValue 守卫单点(契约 2,自 log.ts 提升;typeof process 守卫,
//   web 无 process 返回 undefined)。src 下非 EXPO_PUBLIC 读取一律经它。
// - process.env.EXPO_PUBLIC_* 直接成员访问:任意文件豁免(babel-preset-expo
//   只静态内联**直接成员访问**,别名读取逃逸 → release 运行时缺失;现行九处:
//   settings.ts loadSettings / webSearch.defaultSearcher / deviceCollect.
//   DEVICE_TDX_HOSTS / 08-28 S6 客户端 token 接线:webCollect.collectViaProxy /
//   webYahooCollect.collectYahooViaProxy / webSearch.makeProxySearcher /
//   llm.createLlm / log.makeReporter / settings.checkLlmReachability
//   (EXPO_PUBLIC_SOA_ACCESS_TOKEN)——env.ts 头注释同述)。其余任意读取 = 违规。
// - 扫描面 = src/**/*.ts + app/**/*.{ts,tsx}(metro 图可达代码)。app/*.mjs 与
//   app/lib/*.cjs(server.mjs / logs-server.cjs 等)是 Node-only 服务端基建,
//   不入 metro 图,读 PORT/HOST/SOA_LOG_DIR 属合法 Node 配置,不在断言面。
const ENV_SINGLE_POINT: Whitelist = { 'src/env.ts': true };

describe('契约 6:process.env 零写入;读取仅 src/env.ts + EXPO_PUBLIC 直读白名单', () => {
  it('process.env 赋值/delete 零处(src+app TS/TSX)', () => {
    const violations = scan(
      [...SRC_TS, ...APP_TS],
      (t) => /process\.env(\[[^\]]*\]|\.[A-Za-z_$][\w$]*)?\s*=(?!=)/.test(t) || /delete\s+process\.env/.test(t),
    );
    expect(violations, 'process.env 写入零容忍(配置经 setCapabilitySwitches/envValue 显式通道)').toEqual([]);
  });

  it('process.env 读取仅 src/env.ts 与 EXPO_PUBLIC_* 直接成员访问', () => {
    const violations = scan(
      [...SRC_TS, ...APP_TS],
      (t) => {
        // 跳过写入行(上面断言已单独覆盖;避免同一条目双报)
        if (/process\.env(\[[^\]]*\]|\.[A-Za-z_$][\w$]*)?\s*=(?!=)/.test(t) || /delete\s+process\.env/.test(t)) return false;
        // 逐 occurrence 判断:EXPO_PUBLIC_* 直接成员访问(Metro 内联白名单)剔除后,
        // 仍有 process.env 残留 → 违规(同行使两条读取时也能各自判定)。
        const withoutExpo = t.replace(/process\.env\.EXPO_PUBLIC_[A-Za-z0-9_]+/g, '');
        return /process\.env/.test(withoutExpo);
      },
      (f) => f in ENV_SINGLE_POINT,
    );
    expect(violations, 'process.env 读取收敛到 src/env.ts envValue 单点(EXPO_PUBLIC_* 直接成员访问除外)').toEqual([]);
  });
});

// ─── 断言 7:app 无 app/lib/log 双入口残留 ───────────────────────────────────
// 无白名单:app/lib/log.ts 旧 shim(重导出 src/log.ts)已删,useAnalysis 等已
// 直连 src/log.ts(useAnalysis.ts:41 实证)。禁相对路径回归(任意 ../ 深度)。
describe('契约 7:app 无 lib/log 相对 import 残留(双日志入口已收敛)', () => {
  it('app/**/*.{ts,tsx} 禁 from \'../lib/log\' / from \'./lib/log\'(含更深相对路径)', () => {
    const violations = scan(
      APP_TS,
      (t) => /from\s*['"]((\.\.\/)+|\.\/)lib\/log['"]/.test(t),
    );
    expect(violations, '日志入口统一 src/log.ts;app/lib/log 旧 shim 已删除,禁回潮').toEqual([]);
  });
});
