# S4 — Android Keystore & Signing Secret Rotation Checklist (pre-release, no code)

**When**: once, BEFORE the first real release (any version published to a store /
distributed AAB). After the first release, rotate only on compromise or on a
per-release cadence you commit to.

**Why (S4 evidence)**: the full Android keystore + store/key passwords live
plaintext in root `.env` (lines 10–17, gitignored but sitting on the release
machine), and the same values double as the GitHub Actions signing secrets.
Anyone with the repo checkout on that machine (or a leaked `.env`) can sign
forged APKs that match the official identity.

**Current wiring (verified at HEAD 5069fde)**:

| Surface | Location | Values |
|---|---|---|
| Local env | root `.env` (gitignored) | `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`soa-release`), `ANDROID_KEY_PASSWORD` |
| CI signing | GitHub Actions secrets (`release.yml:144-145` → `tools/configure-android-signing.mjs`) | same 4 names |
| Local release builder | `app/scripts/build-release-clean.sh` sources `~/.soa-android-env.sh` | same 4 names |
| Generated artifacts | `app/android/app/release.keystore`, `app/android/keystore.properties` (created by configure script / prebuild) | keystore + 3 passwords |

The keystore password and the key password are identical today
(`ANDROID_KEYSTORE_PASSWORD == ANDROID_KEY_PASSWORD`). Rotation should give
them distinct values.

---

## 1. Generate a new keystore on the release machine

Run on the machine that owns the release build (NOT in CI):

```bash
keytool -genkeypair -v \
  -keystore release-v2.keystore \
  -alias soa-release \
  -keyalg RSA -keysize 4096 -validity 10950 \
  -storepass '<NEW_STORE_PASSWORD>' \
  -keypass '<NEW_KEY_PASSWORD>' \
  -dname "CN=SOA Release, OU=Release, O=StockOperatorAgent, L=Unknown, ST=Unknown, C=CN"
```

- Choose a NEW random store password and a DIFFERENT new random key password
  (≥ 32 chars, generate with `openssl rand -base64 32` or a password manager).
- 10 950 days ≈ 30 years; adjust validity to your release horizon.
- Keep `release-v2.keystore` in a private location (encrypted storage / keychain
  entry), never in the repo tree.

> ⚠️ Android upgrade-in-place caveat: app signatures identify the publisher.
> If this app has ALREADY been distributed with the old key, a rotated key
> prevents silent updates — existing installs must uninstall/reinstall. If a
> release already exists, prefer keeping the key and rotating only the
> passwords/secrets; full keystore rotation is for pre-first-release or
> compromise scenarios.

## 2. Encode + verify the new keystore

```bash
base64 -w0 release-v2.keystore > /tmp/keystore.b64
# shape check before propagation (configure-android-signing.mjs validates the
# base64 charset/length/padding and the keystore magic on decode):
wc -c /tmp/keystore.b64
head -c 32 /tmp/keystore.b64   # must be base64 charset only
```

Optional local sanity: run `node tools/configure-android-signing.mjs` against a
scratch copy with `ANDROID_KEYSTORE_B64` set — it must exit 0 and produce
`app/android/app/release.keystore` + `app/android/keystore.properties`.

## 3. Propagate — local `.env` (root, gitignored)

Replace lines 10–17 of root `.env`:

```dotenv
ANDROID_KEYSTORE_B64=<new base64, single line>
ANDROID_KEYSTORE_PASSWORD=<NEW_STORE_PASSWORD>
ANDROID_KEY_ALIAS=soa-release
ANDROID_KEY_PASSWORD=<NEW_KEY_PASSWORD>
```

Do NOT commit `.env` (already gitignored — re-verify with
`git check-ignore .env` before any commit).

## 4. Propagate — release machine keychain / env file

Local release builder reads `~/.soa-android-env.sh` (sourced by
`app/scripts/build-release-clean.sh`). Update the same 4 variables there:

```bash
# ~/.soa-android-env.sh — keep 600 perms, outside the repo
chmod 600 ~/.soa-android-env.sh
```

For a true keychain move: store the keystore + passwords in the OS keychain
(macOS `security add-generic-password`, Linux `secret-tool store`, or a
password manager) and have the build script fetch them instead of sourcing a
file — `.env` keeps only non-signing keys afterwards. This is the S4
"keychain instead of .env" end state; the minimal rotation below still leaves
the values in `.env`, so schedule the keychain move as the follow-up step.

## 5. Propagate — GitHub Actions secrets (4 values)

Repo → Settings → Secrets and variables → Actions, update each of:

- `ANDROID_KEYSTORE_B64` — paste the new single-line base64
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS` (unchanged if alias stays `soa-release`)
- `ANDROID_KEY_PASSWORD`

Do this BEFORE triggering the release workflow — `release.yml` fails hard or
silently falls back to debug signing (configure script exit 0 + debug
signingConfig) if `ANDROID_KEYSTORE_B64` is missing. Confirm the updated
secrets by running the workflow once with a `workflow_dispatch` trigger and
checking the "Configure Android release signing" step log.

## 6. Verification — signed build

Local:

```bash
app/scripts/build-release-clean.sh
# must end with:
#   release APK: android/app/build/outputs/apk/release/app-release.apk
#   OK: APK bundle contains none of the .env values
# then verify the signature:
keytool -printcert -jarfile android/app/build/outputs/apk/release/app-release.apk \
  | grep -E 'Owner|SHA256'
# owner must match the new dname; SHA256 must differ from the old keystore's
```

Compare with the OLD certificate fingerprint (captured before rotation) to
prove the APK is signed by the NEW key:

```bash
# before rotation (already done?):
keytool -printcert -jarfile <old-release.apk> | grep SHA256 > /tmp/old-fingerprint.txt
# after rotation:
keytool -printcert -jarfile <new-release.apk> | grep SHA256 > /tmp/new-fingerprint.txt
diff /tmp/old-fingerprint.txt /tmp/new-fingerprint.txt   # must differ
```

CI:

- Push a tag / dispatch `release.yml`; the job must reach the AAB artifact
  step (i.e. NOT the debug-signing fallback path) and the produced AAB must
  print the same new certificate.

## 7. Rollback

Everything is revertible per surface; the ordering below stops a bad rotation
from blocking a release:

1. **Secrets only** (password leak / CI failure): restore the old values in
   `.env`, `~/.soa-android-env.sh`, and the 4 GH secrets. No build artifact
   changes needed — the old keystore file is still valid.
2. **Keystore file rotation gone wrong** (keystore corrupt / passphrase lost):
   re-run step 1 with `release-v1` — keep the old keystore backup until the
   new certificate has been verified end-to-end (local + CI). Keep old values
   in all three surfaces until verification passes.
3. **Never delete the old keystore**: even after the new one verifies, keep
   the old file + its passwords in encrypted cold storage — needed for
   re-signing existing artifacts or recovering a lost rotation.

## 8. Follow-ups (adjacent, other buckets)

- F16 (mediums): `tools/configure-android-signing.mjs` property escaping —
  non-Latin-1 → `\uXXXX` + leading-whitespace escaping; review before/after
  rotation since `keystore.properties` is rewritten each run.
- R6 note: CI does not read `.env` — the GH secrets are the single CI source;
  keep `.env` and GH secrets in sync manually (this checklist) or move both to
  a secrets manager.
