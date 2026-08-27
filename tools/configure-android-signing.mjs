#!/usr/bin/env node
/**
 * configure-android-signing.mjs — 在 CI 中按 GitHub Secrets 配置 Android release 签名。
 *
 * 环境变量（GitHub Secrets）：
 *   ANDROID_KEYSTORE_B64           keystore 文件的 base64 编码（必填，缺失则降级 debug 签名）
 *   ANDROID_KEYSTORE_PASSWORD      keystore 口令（storePassword）
 *   ANDROID_KEY_ALIAS              密钥别名（keyAlias）
 *   ANDROID_KEY_PASSWORD           私钥口令（keyPassword）
 *
 * 行为（cwd = 仓库根，expo prebuild 之后运行）：
 *   1. 校验 ANDROID_KEYSTORE_B64（base64 字符集/长度/填充 → 解码后 keystore 魔数）
 *      并解码 → 写 app/android/app/release.keystore（目录自动创建）
 *   2. 写 app/android/keystore.properties（storeFile=release.keystore + 三口令）
 *   3. 幂等补丁 app/android/app/build.gradle：注入 signingConfigs.release（读
 *      keystore.properties），并把 release buildType 的 signingConfig 从
 *      signingConfigs.debug 改为 signingConfigs.release；已注入则 no-op，
 *      重复运行零变化。
 *
 * 退出码：
 *   0  成功；或未配置 ANDROID_KEYSTORE_B64（debug 签名降级，不阻塞流水线）
 *   1  出错（base64 校验失败 / 解码结果非 keystore / 文件读写失败 / build.gradle
 *       无法补丁），原因打印到 stderr，只含 env 名不含值
 *
 * 用法：node tools/configure-android-signing.mjs
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const REPO_ROOT = process.cwd();
const ANDROID_DIR = path.join(REPO_ROOT, "app", "android");
const APP_DIR = path.join(ANDROID_DIR, "app");
const KEYSTORE_PATH = path.join(APP_DIR, "release.keystore");
const PROPERTIES_PATH = path.join(ANDROID_DIR, "keystore.properties");
const BUILD_GRADLE_PATH = path.join(APP_DIR, "build.gradle");

const KEYSTORE_B64 = process.env.ANDROID_KEYSTORE_B64;

// 注入到 signingConfigs 的 release 块（缩进与 RN 模板一致：signingConfigs 子级 8 空格）
const RELEASE_BLOCK = [
  "        release {",
  '            // 由 tools/configure-android-signing.mjs 注入：读取 keystore.properties',
  '            def keystorePropertiesFile = rootProject.file("keystore.properties")',
  "            def keystoreProperties = new Properties()",
  "            if (keystorePropertiesFile.exists()) {",
  "                keystoreProperties.load(new FileInputStream(keystorePropertiesFile))",
  "            }",
  "            storeFile file(keystoreProperties['storeFile'])",
  "            storePassword keystoreProperties['storePassword']",
  "            keyAlias keystoreProperties['keyAlias']",
  "            keyPassword keystoreProperties['keyPassword']",
  "        }",
].join("\n");

function fail(message) {
  console.error(`[configure-android-signing] 错误：${message}`);
  process.exit(1);
}

/** 单行花括号净增量（模板 build.gradle 无字符串内花括号，逐字符计数足够） */
function braceDelta(line) {
  let delta = 0;
  for (const ch of line) {
    if (ch === "{") delta += 1;
    else if (ch === "}") delta -= 1;
  }
  return delta;
}

/** 返回 lines[openIdx]（"xxx {"）匹配的闭合花括号行下标；找不到返回 -1 */
function blockBounds(lines, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < lines.length; i++) {
    depth += braceDelta(lines[i]);
    if (depth <= 0) return i;
  }
  return -1;
}

/** 在块内找直接子级（深度 1）匹配 re 的行下标；找不到返回 -1 */
function childLineIndex(lines, openIdx, endIdx, re) {
  let depth = 0;
  for (let i = openIdx + 1; i < endIdx; i++) {
    if (depth === 0 && re.test(lines[i])) return i;
    depth += braceDelta(lines[i]);
  }
  return -1;
}

/**
 * 幂等补丁 build.gradle：
 *   - signingConfigs 块存在 → 内部无 release 子块则注入；不存在 → 在 buildTypes 前新建
 *   - buildTypes.release 内 signingConfig signingConfigs.debug → signingConfigs.release
 * 返回补丁后的文本；无法补丁（无 buildTypes）返回 null；无变化返回原文本。
 */
function patchBuildGradle(gradle) {
  const lines = gradle.split("\n");
  let changed = false;

  const signingConfigsIdx = lines.findIndex((l) => /^\s*signingConfigs\s*\{/.test(l));
  const buildTypesIdx = lines.findIndex((l) => /^\s*buildTypes\s*\{/.test(l));
  if (buildTypesIdx === -1) return null;

  // --- 注入 signingConfigs.release ---
  if (signingConfigsIdx !== -1) {
    const scEnd = blockBounds(lines, signingConfigsIdx);
    const hasRelease =
      childLineIndex(lines, signingConfigsIdx, scEnd, /^\s*release\s*\{/) !== -1;
    if (!hasRelease) {
      lines.splice(signingConfigsIdx + 1, 0, ...RELEASE_BLOCK.split("\n"));
      changed = true;
    }
  } else {
    const indent = lines[buildTypesIdx].match(/^\s*/)[0];
    lines.splice(buildTypesIdx, 0, `${indent}signingConfigs {`, ...RELEASE_BLOCK.split("\n"), `${indent}}`);
    changed = true;
  }

  // --- release buildType 改挂 signingConfigs.release（仅在 release 块内替换） ---
  const btIdx = lines.findIndex((l) => /^\s*buildTypes\s*\{/.test(l));
  const btEnd = blockBounds(lines, btIdx);
  const releaseIdx = childLineIndex(lines, btIdx, btEnd, /^\s*release\s*\{/);
  if (releaseIdx !== -1) {
    const relEnd = blockBounds(lines, releaseIdx);
    for (let i = releaseIdx + 1; i < relEnd; i++) {
      if (/signingConfig\s+signingConfigs\.debug/.test(lines[i])) {
        lines[i] = lines[i].replace(/signingConfig\s+signingConfigs\.debug/, "signingConfig signingConfigs.release");
        changed = true;
        break;
      }
    }
  }

  return changed ? lines.join("\n") : gradle;
}

/** Java properties 值转义(F16):反斜杠/换行 + 非 Latin-1 字符 + 前导空白。
 *  keystore.properties 以 ISO-8859-1 落盘:[\u0080-\uFFFF] 直接写会 mojibake,
 *  须转 \uXXXX(Properties.load 原生解码,含代理对——两半各自转义即还原);
 *  行首空白会被 loader 丢弃,须反斜杠转义保真。顺序:先 \\ 再新增转义,
 *  避免二次处理自己产出的反斜杠。 */
function escapePropertyValue(value) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/[\u0080-\uFFFF]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`)
    .replace(/^[\t ]+/, (ws) => ws.replace(/[\t ]/g, (w) => `\\${w}`));
}

/**
 * base64 字符串严格校验；合法返回 null，否则返回错误说明（不含输入值本身）。
 *
 * Node 的 Buffer.from(s, 'base64') 是宽松模式：非法字符被忽略、错误填充只截断不抛错
 * —— 仅靠 try/catch + decode 无法识别垃圾输入（A4 死 try/catch 根因）。因此先按
 * 「字符集 / 4 字符一组 / 填充规则」拒绝，再以「解码 → 重编码」往返比对确认规范形式
 * （同时捕获非法补齐位，如 'AAB=' 这类非规范编码）。
 */
function base64ValidationError(s) {
  if (s.length === 0) return "去空白后为空（应提供 base64 编码的 keystore 字节）";
  if (s.length % 4 !== 0) return `长度 ${s.length} 不是 4 的倍数（base64 按 4 字符一组）`;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s)) {
    return "含非法字符或填充错误（'=' 仅允许在末尾且最多 2 个）";
  }
  if (Buffer.from(s, "base64").toString("base64") !== s) {
    return "非规范 base64（存在被宽松解码忽略的字符或错误补齐位）";
  }
  return null;
}

/**
 * keystore 文件头（魔数）识别；命中任一即视为 keystore：
 *   - JKS    0xFEEDFEED（JDK 8 默认，或显式 -storetype JKS）
 *   - JCEKS  0xCECECECE（显式 -storetype JCEKS）
 *   - PKCS12 ASN.1 SEQUENCE 0x30 + 长形式长度 0x82（keytool 自 JDK 9 起默认格式；
 *     含 RSA 密钥对的 keystore 尺寸远超 128 字节，DER 首长度字节必为长形式）
 * README 的 keytool -genkeypair 命令未固定 -storetype，三种皆为合法输入；既不误拒，
 * 也能拦下明显传错的文件（文本/图片/ZIP 等）。
 */
function looksLikeKeystore(buf) {
  if (buf.length < 8) return false;
  const magic = buf.readUInt32BE(0);
  if (magic === 0xfeedfeed || magic === 0xcececece) return true;
  return buf[0] === 0x30 && buf[1] === 0x82;
}

async function main() {
  if (!KEYSTORE_B64) {
    console.log(
      "[configure-android-signing] ANDROID_KEYSTORE_B64 未配置：跳过正式签名，" +
        "APK 使用 expo prebuild 默认的 debug 签名（可安装）。退出 0，不阻塞流水线。"
    );
    process.exit(0);
  }

  const required = ["ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    fail(`配置了 ANDROID_KEYSTORE_B64 但缺少 Secrets：${missing.join(", ")}`);
  }

  // 1) 校验并解码 keystore（先于任何写入，解码失败不产生残留文件）
  //    先剥离全部空白再校验：粘贴进 Shell/CI 时可能夹带换行或空格（README 约定
  //    `base64 -w0` 单行输出；此处对换行/Tab/空格一并容忍后按严格规则校验）。
  const keystoreB64 = KEYSTORE_B64.replace(/\s+/g, "");
  const b64Error = base64ValidationError(keystoreB64);
  if (b64Error) {
    fail(`ANDROID_KEYSTORE_B64（环境变量）不是合法 base64：${b64Error}`);
  }
  let keystore;
  try {
    keystore = Buffer.from(keystoreB64, "base64");
  } catch (e) {
    // Buffer.from 的 'base64' 编码本身不抛错（宽松模式，A4 死 try/catch 根因）；
    // 此 catch 仅为未来 Node 行为变化的兜底，真实错误已在上方校验处拦下。
    fail(`ANDROID_KEYSTORE_B64（环境变量）base64 解码失败：${e.message}`);
  }
  if (!looksLikeKeystore(keystore)) {
    fail(
      `ANDROID_KEYSTORE_B64 解码结果不是 keystore 文件（${keystore.length} 字节，` +
        "魔数不匹配：期望 JKS 0xFEEDFEED / JCEKS 0xCECECECE / PKCS12 0x30 0x82；" +
        "请确认上传的是 keytool -genkeypair 产出的 release.keystore 的 base64 编码）"
    );
  }

  // 2) 读取并补丁 build.gradle（补丁不可行则不写任何文件）
  let gradle;
  try {
    gradle = await readFile(BUILD_GRADLE_PATH, "utf8");
  } catch (e) {
    fail(`读取 ${BUILD_GRADLE_PATH} 失败：${e.message}（是否已运行 expo prebuild？）`);
  }
  const patched = patchBuildGradle(gradle);
  if (patched === null) {
    fail(`补丁 ${BUILD_GRADLE_PATH} 失败：未找到 buildTypes { 块，无法挂接 release 签名`);
  }

  // 3) 写 keystore（目录不存在则创建）
  try {
    await mkdir(APP_DIR, { recursive: true });
    await writeFile(KEYSTORE_PATH, keystore, { mode: 0o600 });
  } catch (e) {
    fail(`写入 ${KEYSTORE_PATH} 失败：${e.message}`);
  }

  // 4) 写 keystore.properties
  const properties = [
    "storeFile=release.keystore",
    `storePassword=${escapePropertyValue(process.env.ANDROID_KEYSTORE_PASSWORD)}`,
    `keyAlias=${escapePropertyValue(process.env.ANDROID_KEY_ALIAS)}`,
    `keyPassword=${escapePropertyValue(process.env.ANDROID_KEY_PASSWORD)}`,
    "",
  ].join("\n");
  try {
    await writeFile(PROPERTIES_PATH, properties, { mode: 0o600 });
  } catch (e) {
    fail(`写入 ${PROPERTIES_PATH} 失败：${e.message}`);
  }

  // 5) 写补丁后的 build.gradle（内容无变化则不写）
  if (patched !== gradle) {
    try {
      await writeFile(BUILD_GRADLE_PATH, patched);
    } catch (e) {
      fail(`写入 ${BUILD_GRADLE_PATH} 失败：${e.message}`);
    }
  }

  console.log(
    "[configure-android-signing] 完成：release 签名已配置（release.keystore / keystore.properties / build.gradle 补丁）"
  );
}

main();
