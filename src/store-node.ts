// Node 桌面后端接线 —— FileStore 的 node:fs 适配器 + 设置文件适配器(Node-only)
// ⚠️ node:fs 静态 import 禁令边界:本文件是仓库内唯一允许静态 import node:fs 的
// 业务文件 —— 它**不进 metro 图**(仅 tools/desktop-probe.mts / 桌面主进程
// import;metro 无 fs shim,凡经 app 可达的文件禁静态/动态 import node:fs,适配器
// 只能经注入面传入 —— 见 app/lib/settingsStore.ts 的 _fs 参数与 FileStore 的
// (baseDir, fs) 注入面)。
// 路径拼接语义复用 store-file.ts(joinPath:baseDir 尾斜杠兼容;FileStore 传给
// 适配器的 readFile/writeFile 已是拼好的完整路径,listDir 只枚举 baseDir)。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  readFile as fsReadFile,
  readdir,
  rename as fsRename,
  unlink as fsUnlink,
  writeFile as fsWriteFile,
} from 'node:fs/promises';
import { FileStore, type FileFsAdapter } from './store-file.ts';

// tmp 序号:进程内单调递增 + pid 区分实例,保证 tmp 名不与任何已有文件相撞。
let tmpWriteSeq = 0;

/** FileStore 的 node:fs 适配器(FileFsAdapter 面;同 store-file.test.ts 注入先例)。
 *  readFile 缺文件返回 null(FileStore hydrate 对 null 兜底);writeFile 走同目录
 *  tmp + fsRename 原子替换(评审 08-23 F1:直写曾留下半截 JSON,hydrate 一炸全库),
 *  tmp 名以 .tmp.<pid>.<seq> 结尾 —— 不以 .json 结尾,hydrate 扫描天然跳过残留。 */
export function nodeFsAdapter(baseDir: string): FileFsAdapter {
  return {
    async readFile(path) {
      try {
        return await fsReadFile(path, 'utf8');
      } catch (err) {
        // F12:仅 ENOENT(文件不存在)视为「缺文件」→ null;其余 fs 错误(权限
        // EACCES/目录 EISDIR 等)上抛 —— 裸 catch→null 会把「读不了」伪装成
        // 「没有」:hydrate 得到近空镜像,后续整文件重写近空覆盖丢数据。
        // 上抛由 FileStore.hydrate 逐文件 catch 兜底(记 logError 并跳过该文件)。
        if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
        throw err;
      }
    },
    async writeFile(path, data) {
      const tmp = `${path}.tmp.${process.pid}.${tmpWriteSeq++}`;
      try {
        await fsWriteFile(tmp, data, 'utf8');
        await fsRename(tmp, path);
      } catch (err) {
        await fsUnlink(tmp).catch(() => {}); // 尽力清残留;原错误上抛,由写队列统一记录
        throw err;
      }
    },
    async listDir() {
      return readdir(baseDir);
    },
  };
}

/** 桌面 FileStore 工厂:baseDir 下建 node:fs 后端(目录自动创建,对齐
 *  store-file.ts expo 分支 root.create({ intermediates: true, idempotent: true }))。 */
export function createNodeFileStore(baseDir: string): FileStore {
  mkdirSync(baseDir, { recursive: true });
  return new FileStore(baseDir, nodeFsAdapter(baseDir));
}

// ─── 设置存储适配器(expo File 面 ↔ node:fs 面薄包装)───────────────────────
// 形状对齐 app/lib/settingsStore.ts 的 RnFileLike/RnFileSystem(结构类型,经
// _fs 注入面传入;本文件不 import app 层 —— src 不反向依赖 app 约定)。
export interface NodeSettingsFileLike {
  readonly exists: boolean;
  create(): void;
  write(contents: string): void;
  textSync(): string;
}

export interface NodeSettingsFileSystem {
  File: new (...uris: unknown[]) => NodeSettingsFileLike;
  Paths: { document: unknown };
}

/** settingsStore 的 node:fs 文件后端(同步面:load/save 是同步契约)。
 *  new File(...uris) 拼接路径(同 settings-store.test.ts fake 语义);
 *  baseDir 自动创建,写入失败由 settingsStore 静默兜底(不抛出)。 */
export function nodeSettingsFileSystem(baseDir: string): NodeSettingsFileSystem {
  mkdirSync(baseDir, { recursive: true });
  class NodeSettingsFile implements NodeSettingsFileLike {
    readonly path: string;
    constructor(...uris: unknown[]) {
      this.path = uris.map(String).join('/');
    }
    get exists(): boolean {
      return existsSync(this.path);
    }
    create(): void {
      writeFileSync(this.path, '');
    }
    write(contents: string): void {
      writeFileSync(this.path, contents);
    }
    textSync(): string {
      return readFileSync(this.path, 'utf8');
    }
  }
  return { File: NodeSettingsFile, Paths: { document: baseDir } };
}
