# Pixie Release Guide

> **Agent skill:** In this repo, use `/release` to invoke `.claude/skills/release/SKILL.md` and have the agent execute the release steps.

This document explains how to publish a new Pixie version so installed users can update through **Settings -> Check for Updates**.

---

## How Updates Work

Pixie uses the official Tauri v2 updater plugin for in-app updates:

1. When a user clicks **Check for Updates**, the app requests `latest.json` from the GitHub Release.
2. `latest.json` contains the latest version plus per-platform download URLs and signatures.
3. The app compares the `version` in `latest.json` with the installed app version:
   - **Higher**: show an available update, then download, verify, install, and restart after the user confirms.
   - **Same or lower**: show "up to date" and do not update.

The release process is therefore: **bump the version, push a tag, let CI build and publish a Release, and make sure `latest.json` points to the new version**.

> Warning: keep the updater endpoint in `tauri.conf.json` on `/releases/latest/download/latest.json`.
> Do not ship a fixed tag URL like `/releases/download/app-vX.Y.Z/latest.json` in the client config.
> A fixed URL can pin that released client to its own old manifest, making later versions look "up to date".

---

## Prerequisites

These are already set up and only need to be checked if the release pipeline breaks:

- [x] Tauri updater signing key: `~/.tauri/pixie.key` private key plus the pubkey in `tauri.conf.json`
- [x] GitHub Secrets: `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- [x] CI workflow: `.github/workflows/release.yml`, triggered by `app-v*` tags

---

## Standard Release Flow

Example: release `0.1.2` from `0.1.1`.

### 1. Bump Versions

Keep these files in sync:

| File | Field |
|---|---|
| `package.json` | `"version": "0.1.2"` |
| `src-tauri/Cargo.toml` | `version = "0.1.2"` |
| `src-tauri/tauri.conf.json` | `"version": "0.1.2"` |
| `src-tauri/Cargo.lock` | the `pixie` package entry |

> Warning: the new version must be **greater than** the latest published version. Otherwise the updater's `check()` call reports "up to date".

### 2. Commit and Push to Main

```bash
git add -A
git commit -m "release: v0.1.2"
git push origin main
```

### 3. Push the Release Tag

```bash
git tag app-v0.1.2
git push origin app-v0.1.2
```

> Warning: the tag must match `app-vX.Y.Z`. A plain `v0.1.2` tag will not trigger the release workflow.

### 4. Wait for CI

CI in `.github/workflows/release.yml` will:

- Build macOS arm64, macOS x86_64, Linux, and Windows.
- Sign updater artifacts with the Tauri updater key and generate `.sig` files.
- Merge `latest.json` with all platform entries.
- Create a GitHub Release, usually as a draft unless configured otherwise.

Watch progress at <https://github.com/pixie-agent/pixie/actions> or with `gh run watch`.

### 5. Publish the Draft Release

If CI creates a draft Release, publish it before users can see the update:

```bash
gh release edit app-v0.1.2 --draft=false
```

You can also publish it from the GitHub Release page.

### Done

Users on `0.1.1` should now see `0.1.2` when they click **Check for Updates**.

---

## Verify the Release

```bash
# Confirm the release is published and is the latest stable release.
gh api repos/pixie-agent/pixie/releases/latest \
  --jq '{tag: .tag_name, draft: .draft, prerelease: .prerelease}'

# Confirm latest.json points to the expected version.
gh release download app-v0.1.2 -p latest.json -O - | head -3
```

Expected result: `tag_name` is `app-v0.1.2`, `draft` is `false`, and `latest.json` has `"version": "0.1.2"`.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| CI did not start after pushing the tag | Wrong tag format | Use `app-vX.Y.Z` |
| CI finished but users cannot see the update | Release is still a draft | Run `gh release edit app-vX.Y.Z --draft=false` |
| Users see "up to date" when a newer version exists | Version was not bumped or version files are inconsistent | New version must be greater than the published version and all version files must match |
| A previously released version is stuck on itself | That version shipped a fixed tag updater endpoint | Replace that old Release's `latest.json` with the current latest manifest, and make sure new versions only use `/releases/latest/download/latest.json` |
| Users still cannot see the update immediately after publishing | GitHub CDN propagation delay | Wait a few minutes and retry |
| CI signing fails | Missing or mismatched signing secrets | Confirm `TAURI_SIGNING_PRIVATE_KEY` contains the contents of `~/.tauri/pixie.key` |
| One platform fails to build | Platform-specific build failure | Inspect logs with `gh run view <run-id> --log-failed` |

---

## Signing Key Management

- **Private key:** `~/.tauri/pixie.key`, ignored by git
- **Public key:** `plugins.updater.pubkey` in `tauri.conf.json`
- **GitHub Secret:** `TAURI_SIGNING_PRIVATE_KEY`, containing the private key file contents

> Back up the private key in a password manager or encrypted offline storage. If it is lost, already-installed apps can no longer update because future updater artifacts cannot be signed with the original key.

### Regenerate the Key

Only do this if the private key is lost or compromised:

```bash
pnpm tauri signer generate -w ~/.tauri/pixie.key --ci -f
# Then update the pubkey in tauri.conf.json from the generated .pub file.
# Also update the TAURI_SIGNING_PRIVATE_KEY GitHub Secret.
# Existing installs signed with the old key will not be able to update.
```

---

## macOS Code Signing

Pixie currently uses **ad-hoc signing** with `signingIdentity: "-"` because there is no Apple Developer account configured.

- On first launch, users may need to right-click the `.app` and choose **Open**. Double-clicking may be blocked by Gatekeeper.
- After an update replaces the `.app`, Gatekeeper may prompt again.

### Move to Developer ID Signing

When an Apple Developer account is available:

1. Add GitHub Secrets: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID`.
2. Remove `bundle.macOS.signingIdentity: "-"` from `tauri.conf.json`.
3. Leave the updater configuration unchanged.

---

## Local Update-Flow Test

Use this only when you want to verify the update chain without publishing a new release:

```bash
# 1. Temporarily set tauri.conf.json to a version lower than the published version, such as "0.1.0".
# 2. Build locally with the updater signing key.
TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/pixie.key)" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
pnpm tauri build

# 3. Run the packaged old-version app and use Settings -> Check for Updates.
#    It should find and install the published newer version.
# 4. Restore tauri.conf.json after testing.
```

---

## One-Command Release Sequence

```bash
V=0.1.2
# Manually update the version files first, then:
git add -A && git commit -m "release: v$V" && git push origin main
git tag "app-v$V" && git push origin "app-v$V"
# After CI finishes:
gh release edit "app-v$V" --draft=false
```
