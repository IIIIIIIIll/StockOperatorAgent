// Node 桌面后端接线 —— FileStore 的 node:fs 适配器 + 设置文件适配器(Node-only)
// ⚠️ node:fs 静态 import 禁令边界:本文件是仓库内唯一允许静态 import node:fs 的
// 业务文件 —— 它**不进 metro 图**(仅 tools/desktop-probe.mts / 桌面主进程
// import;metro 无 fs shim,凡经 app 可达的文件禁静态/动态 import node:fs,适配器
// 只能经注入面传入 —— 见 app/lib/settingsStore.ts 的 _fs 参数与 FileStore 的
// (baseDir, fs) 注入面)。
// 路径拼接语义复用 store-file.ts(joinPath:baseDir 尾斜杠兼容;FileStore 传给
// 适配器的 readFile/writeFile 已是拼好的完整路径,listDir 只枚举 baseDir)。
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import {
  open as fsOpen,
  readFile as fsReadFile,
  readdir,
  rename as fsRename,
  unlink as fsUnlink,
} from 'node:fs/promises';
import { dirname } from 'node:path';
import { FileStore, type FileFsAdapter } from './store-file.ts';

// tmp 序号:进程内单调递增 + pid 区分实例,保证 tmp 名不与任何已有文件相撞。
let tmpWriteSeq = 0;

/** 原子写够用的 fs 面(可注入 —— 单测据此断言 fsync 真的发生在 rename 之前)。
 *  只需 open/rename/unlink 三个原语:打开句柄才能 sync,只拿路径无法刷页缓存。 */
export interface AtomicWriteFs {
  open(path: string, flags: 'w' | 'r'): Promise<{
    writeFile(data: string, encoding: 'utf8'): Promise<void>;
    sync(): Promise<void>;
    close(): Promise<void>;
  }>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

/** node:fs/promises 的原语包装(默认实现)。 */
const nodeAtomicFs: AtomicWriteFs = {
  open: (path, flags) => fsOpen(path, flags),
  rename: (from, to) => fsRename(from, to),
  unlink: (path) => fsUnlink(path),
};

/** rename 只改目录项,不改文件内容 —— 内容页还在缓存里就断电,目录对了但文件是空的。
 *  先 fsync 文件(fd)再 rename,最后 fsync 父目录把这次 rename 本身也刷下去。 */
async function fsyncDirAsync(dir: string, atomicFs: AtomicWriteFs): Promise<void> {
  try {
    const handle = await atomicFs.open(dir, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Windows 与部分网络文件系统拒绝对目录 open/sync(EISDIR/EPERM/EINVAL) ——
    // 平台差异不该让写入失败;能做的已经做了。
  }
}

/** 同步版的目录 fsync(设置文件走同步契约)。 */
function fsyncDirSync(dir: string): void {
  try {
    const fd = openSync(dir, 'r');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    // 同上:平台不支持时静默降级
  }
}

/** FileStore 的 node:fs 适配器(FileFsAdapter 面;同 store-file.test.ts 注入先例)。
 *  readFile 缺文件返回 null(FileStore hydrate 对 null 兜底);writeFile 走同目录
 *  tmp + fsync + fsRename 原子替换(评审 08-23 F1:直写曾留下半截 JSON,hydrate
 *  一炸全库;评审 2026-11-19:只 rename 不 fsync 是「进程崩溃级」原子,断电后
 *  tmp 的内容可能还是空页),
 *  tmp 名以 .tmp.<pid>.<seq> 结尾 —— 不以 .json 结尾,hydrate 扫描天然跳过残留。
 *  atomicFs 仅测试注入(默认 node:fs/promises)。 */
export function nodeFsAdapter(
  baseDir: string,
  atomicFs: AtomicWriteFs = nodeAtomicFs,
): FileFsAdapter {
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
        // 顺序是契约:① 写 tmp → ② fsync(tmp) 把内容刷到盘 → ③ rename →
        // ④ fsync(父目录) 把目录项刷到盘。缺 ② 断电后 rename 成功但文件是空页;
        // 缺 ④ 断电后 rename 本身可能没落盘,读到旧文件。
        const handle = await atomicFs.open(tmp, 'w');
        try {
          await handle.writeFile(data, 'utf8');
          await handle.sync();
        } finally {
          await handle.close();
        }
        await atomicFs.rename(tmp, path);
        await fsyncDirAsync(dirname(path), atomicFs);
      } catch (err) {
        await atomicFs.unlink(tmp).catch(() => {}); // 尽力清残留;原错误上抛,由写队列统一记录
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
  /** expo SDK 57+/node 适配器同名:tmp → 目标的原子替换(可选)。 */
  moveSync?(destination: NodeSettingsFileLike, options?: { overwrite?: boolean }): void;
}

export interface NodeSettingsFileSystem {
  File: new (...uris: unknown[]) => NodeSettingsFileLike;
  Paths: { document: unknown };
}

// ─── 设置落盘加密（AES-256-GCM 信封）─────────────────────────────────────
// 设置文件含 LLM/亿信/LangSmith API Key。O久实现(评审 2026-11-19 P1「明文落盘」)
// 直接写 JSON:文件权限 0600 只护「同机器其他用户」,护不住云同步/备份/丢掉硬盘。
// 这里只做密码学,key 由桌面主进程经 OS 安全存储(safeStorage → Keychain/
// DPAPI/libsecret)托管理并下发(见 desktop/main.mjs)。拿不到 key 时调用方退回
// 明文 —— 不自造密钥(自造 = 把锁和钥匙放同一个文件)。

const SETTINGS_ENC_MAGIC = 'aes-256-gcm';
const SETTINGS_ENC_VERSION = 1;

interface SettingsEnvelope {
  soa_enc: string;
  v: number;
  iv: string;
  tag: string;
  data: string;
}

/** 旧明文文件没有 soa_enc 字段 —— 读到就当明文,下次保存自动升级为信封。 */
function isSettingsEnvelope(text: string): boolean {
  return text.trimStart().startsWith('{') && text.includes('"soa_enc"');
}

/** 明文 JSON → 信封字符串(iv 每次随机;GCM 自带完整性校验)。 */
export function encryptSettingsText(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const envelope: SettingsEnvelope = {
    soa_enc: SETTINGS_ENC_MAGIC,
    v: SETTINGS_ENC_VERSION,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
  return JSON.stringify(envelope);
}

/** 信封字符串 → 明文 JSON;旧明文原样返回;篡改/错 key → 抛(GCM tag 不匹配)。 */
export function decryptSettingsText(raw: string, key: Buffer): string {
  if (!isSettingsEnvelope(raw)) return raw; // 旧明文文件:原样返回
  const envelope = JSON.parse(raw) as SettingsEnvelope;
  if (envelope.soa_enc !== SETTINGS_ENC_MAGIC || envelope.v !== SETTINGS_ENC_VERSION) {
    throw new Error(`未知的设置加密信封: ${envelope.soa_enc} v${envelope.v}`);
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.data, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** 加密变体:文件形状/权限/原子写与 nodeSettingsFileSystem 完全一致,只是
 *  write 落 GCM 信封、textSync 解密。替代旧明文写入点:
 *  desktop/child.mjs 的 saveSettings / 启动读取。
 *  key 必须 32 字节(AES-256);长度错说明主进程下发链路坏了 —— 立即抛,
 *  不静默降级成明文。 */
export function encryptedSettingsFileSystem(
  baseDir: string,
  key: Buffer,
): NodeSettingsFileSystem {
  if (key.length !== 32) {
    throw new Error(`设置加密 key 必须 32 字节(AES-256),实际 ${key.length}`);
  }
  const inner = nodeSettingsFileSystem(baseDir);
  class EncryptedSettingsFile implements NodeSettingsFileLike {
    private readonly file: NodeSettingsFileLike;
    constructor(...uris: unknown[]) {
      this.file = new inner.File(...uris);
    }
    get exists(): boolean {
      return this.file.exists;
    }
    create(): void {
      this.file.create();
    }
    write(contents: string): void {
      this.file.write(encryptSettingsText(contents, key));
    }
    textSync(): string {
      return decryptSettingsText(this.file.textSync(), key);
    }
    moveSync(destination: NodeSettingsFileLike, options?: { overwrite?: boolean }): void {
      const target = destination instanceof EncryptedSettingsFile ? destination.file : destination;
      this.file.moveSync?.(target, options);
    }
  }
  return { File: EncryptedSettingsFile, Paths: inner.Paths };
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
      writeFileSync(this.path, '', { mode: 0o600 });
    }
    write(contents: string): void {
      // CR-30:tmp + rename 原子替换(与 store-node 的 FileStore 适配器同手法),
      // 避免崩溃留下半截设置 JSON(下次启动静默回默认,含 API key)。
      // P2(评审 2026-11-21):这个文件里存的是明文 LLM/亿信/LangSmith Key,
      // 旧实现不给 mode → 落到 0644,同机器上任何用户都能读。显式 0600,
      // 并对已存在的文件补一次 chmod(rename 不会修正旧文件的权限)。
      // P2(评审 2026-11-19):rename 前必须 fsync(文件+父目录),否则断电后
      // 「原子替换」只对进程崩溃成立。
      const tmp = `${this.path}.tmp`;
      const fd = openSync(tmp, 'w', 0o600);
      try {
        writeSync(fd, contents, null, 'utf8');
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(tmp, this.path);
      fsyncDirSync(dirname(this.path));
      try {
        chmodSync(this.path, 0o600);
      } catch {
        // Windows/受限母盘不支持 chmod —— 权限已由上行的 mode 尽力而为,
        // 失败不阻断写入(否则 Windows 上设置完全存不下)
      }
    }
    moveSync(destination: NodeSettingsFileLike, options?: { overwrite?: boolean }): void {
      const dest = (destination as { path?: string }).path;
      if (!dest) throw new Error('NodeSettingsFile.moveSync: 目标缺少 path');
      if (!options?.overwrite && existsSync(dest)) {
        throw new Error(`NodeSettingsFile.moveSync: 目标已存在:${dest}`);
      }
      renameSync(this.path, dest);
      fsyncDirSync(dirname(dest));
    }
    textSync(): string {
      return readFileSync(this.path, 'utf8');
    }
  }
  return { File: NodeSettingsFile, Paths: { document: baseDir } };
}
