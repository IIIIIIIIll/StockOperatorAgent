#!/usr/bin/env bash
# 本地发布工具:仅开发者本机使用;CI(release.yml)不调用本脚本——runner 无
# .env,签名由 Secrets 注入,产物命名/上传由工作流负责。本脚本用于本机安全出包。
#
# 发布构建(安全版):产出的 release APK 不含任何 API key。
#
# 为什么需要这个脚本(2026-08-15 排查结论):
# 1. @expo/env 在构建时把 app/.env 的 EXPO_PUBLIC_LLM_* 内联进 JS bundle
#    (babel 静态内联),任何拿到 APK 的人都能提取真实 key。
# 2. metro 的 transform/serialize 缓存在系统临时目录 /tmp/metro-cache,
#    缓存键不含 env 值 —— 即使清空 .env 重建,旧的内联结果(含 key)
#    仍会被复用(表现为 bundle sha1 恒不变)。
# 3. gradle 的 --rerun-tasks/--no-build-cache 只控制任务级缓存,管不到
#    metro 缓存;必须显式删 /tmp/metro-cache。
#
# 因此发布构建流程 = 清空 .env 构建(构建结束恢复)+ 清 metro 缓存。
# key 改由用户在 App 设置面板填写(设置持久化已实现)。
set -euo pipefail
cd "$(dirname "$0")/.."
source ~/.soa-android-env.sh

# CR-05:android/ 是 expo prebuild 产物。版本必须与 app.json 对齐,否则产物
# versionName/versionCode 与分发文件名、Play 上传记录三者错位(本地链路曾停在
# 0.1.5/1 而 app.json 已是 0.1.9)。缺字段/不一致一律失败,不静默出包。
VERSION=$(python3 -c "import json; print(json.load(open('app.json'))['expo']['version'])")
VERSION_CODE=$(python3 -c "import json; d=json.load(open('app.json'))['expo']; print(d.get('android',{}).get('versionCode', ''))")
GRADLE_FILE=android/app/build.gradle
if [ ! -f "$GRADLE_FILE" ]; then
  echo "FAIL: 缺 $GRADLE_FILE;先运行 npx expo prebuild --platform android --no-install" >&2
  exit 1
fi
GRADLE_NAME=$(sed -n 's/.*versionName "\([^"]*\)".*/\1/p' "$GRADLE_FILE" | head -1)
GRADLE_CODE=$(sed -n 's/.*versionCode \([0-9][0-9]*\).*/\1/p' "$GRADLE_FILE" | head -1)
if [ -z "$VERSION_CODE" ] || [ "$GRADLE_NAME" != "$VERSION" ] || [ "$GRADLE_CODE" != "$VERSION_CODE" ]; then
  echo "FAIL: android 版本与 app.json 不一致(app.json=$VERSION/$VERSION_CODE, gradle=$GRADLE_NAME/$GRADLE_CODE)" >&2
  echo "      先运行 npx expo prebuild --platform android --no-install 再发布" >&2
  exit 1
fi

BACKUP_DIR=$(mktemp -d /tmp/soa-env-backup.XXXXXX)
chmod 700 "$BACKUP_DIR"
cp .env "$BACKUP_DIR/env"
restore() {
  if [ -f "$BACKUP_DIR/env" ]; then cp "$BACKUP_DIR/env" .env; fi
  rm -rf "$BACKUP_DIR"
}
# CR-55:INT/TERM/HUP 也走还原(仅 EXIT 时被 kill 会留下空 .env + 明文备份)
trap restore EXIT INT TERM HUP

: > .env
rm -rf /tmp/metro-cache /tmp/metro-file-map-* 2>/dev/null || true
cd android
./gradlew :app:assembleRelease --rerun-tasks --no-build-cache
cd ..
restore
trap - EXIT

# 验证:APK bundle 不含 app/.env 中的任何键值
python3 - <<'PY'
import zipfile, sys
z = zipfile.ZipFile('android/app/build/outputs/apk/release/app-release.apk')
b = z.read('assets/index.android.bundle')
leaked = []
SENSITIVE = ('KEY', 'SECRET', 'TOKEN', 'PASSWORD')
for line in open('.env', encoding='utf-8'):
    line = line.strip()
    if not line or line.startswith('#') or '=' not in line:
        continue
    k, _, v = line.partition('=')
    v = v.strip()
    # 只检查敏感键(API KEY/SECRET/TOKEN/PASSWORD);MODEL/BASE_URL/开关值
    # 是公开配置,模型名等字符串在 bundle 中正常出现,不构成泄漏。
    if not v or not any(s in k.upper() for s in SENSITIVE):
        continue
    if v.encode('utf-8') in b or v.encode('utf-16-le') in b:
        leaked.append(k)
if leaked:
    print('FAIL: key(s) found in APK:', ', '.join(leaked))
    sys.exit(1)
print('OK: APK bundle contains none of the .env values')
PY

echo "release APK: android/app/build/outputs/apk/release/app-release.apk"

# 分发副本:友好文件名(带版本号),放 dist/(gitignored)
mkdir -p dist
cp android/app/build/outputs/apk/release/app-release.apk "dist/做个好人AI股票分析系统-v${VERSION}.apk"
echo "dist APK:    dist/做个好人AI股票分析系统-v${VERSION}.apk"
