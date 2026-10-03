# Releasing Lilo

Short version: bump, write the changelog, tag, wait, check the draft, publish.
Nothing reaches users until you press **Publish** on the draft release.

## One-time setup

### 1. Updater signing key (separate from Apple's)

Every update is signed so a hijacked download can never be installed. Run this once, on your Mac.
The private key never goes in the repo.

```sh
pnpm tauri signer generate -w ~/.tauri/lilo-updater.key
```

It asks for a password (use one, store it in your password manager). It writes:

- `~/.tauri/lilo-updater.key`: the **private** key. Back it up. If you lose it, installed copies of
  Lilo can never be updated again (users must reinstall by hand).
- `~/.tauri/lilo-updater.key.pub`: the public key.

Commit the public key (the whole file content, one line) over the placeholder:

```sh
cp ~/.tauri/lilo-updater.key.pub app/src-tauri/updater.pub
```

Then set the two secrets (the second one is the password you typed):

```sh
gh secret set TAURI_SIGNING_PRIVATE_KEY --repo Kadwood/lilo < ~/.tauri/lilo-updater.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo Kadwood/lilo
```

The Rust side embeds `updater.pub` (`app/src-tauri/src/updates.rs`). While it still holds
`REPLACE_WITH_UPDATER_PUBLIC_KEY`, builds skip update checks and a tag release refuses to run.
Changing the key later strands every installed copy, so treat it as permanent.

### 2. Apple secrets (already set)

`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_TEAM_ID`,
`APPLE_API_KEY` (key id), `APPLE_API_ISSUER`, `APPLE_API_KEY_P8_BASE64`. The workflow imports the
certificate into a temporary keychain, writes the `.p8` to a temp file for `APPLE_API_KEY_PATH`, and
deletes both at the end.

### 3. Dry run (do this before the first real release)

Actions > **Release** > **Run workflow** on the branch. This builds all three platforms and keeps the
files as workflow artifacts only. No tag, no release. Download the Mac artifact and run the checks in
"Verify notarization" below.

## Releasing a version

1. **Bump.** On an up-to-date `main` (or a release branch):
   ```sh
   node scripts/bump-version.mjs 1.0.1
   ```
   It sets the version in the root and `editor`/`engine` `package.json`, `Cargo.toml`, `Cargo.lock`
   and `tauri.conf.json`, and turns the "Unreleased" notes in `CHANGELOG.md` into a dated `1.0.1`
   section. If there were no notes it writes a `TODO` line.
2. **Write the changelog.** Edit the `## [1.0.1]` section in `CHANGELOG.md`: short bullets a user
   would care about. It becomes the GitHub release notes. The release fails while `TODO` remains.
3. **Commit and merge** to `main` (CI checks all the versions match).
4. **Tag** that commit and push the tag:
   ```sh
   git tag v1.0.1
   git push origin v1.0.1
   ```
   The tag must be `v` + the exact version.
5. **Wait** (about 25 to 45 minutes; Apple's notary is the slow part). Watch Actions > Release.
6. **Review the draft**: Releases page, the new draft. Check it has the DMG, setup `.exe`,
   `.AppImage`, `.deb`, `SHA256SUMS`, the `.app.tar.gz` / `.sig` files and `latest.json`, and the notes
   read well. Download the DMG and run the notarization checks below.
7. **Publish.** Edit the draft, make sure "Set as the latest release" is ticked, **Publish**.
   Installed copies see the update the next time they check (launch, at most daily).

Versions with a dash (`1.1.0-beta.1`) are published as pre-releases and are never offered as updates.

## Verify notarization

On a Mac, with the downloaded DMG:

```sh
spctl -a -vv -t open --context context:primary-signature Lilo_1.0.1_universal.dmg
# expect: accepted, source=Notarized Developer ID
xcrun stapler validate Lilo_1.0.1_universal.dmg
# expect: The validate action worked!

hdiutil attach Lilo_1.0.1_universal.dmg          # then, on the mounted app:
spctl -a -vv /Volumes/Lilo/Lilo.app
# expect: accepted, source=Notarized Developer ID
xcrun stapler validate /Volumes/Lilo/Lilo.app
codesign -dvv /Volumes/Lilo/Lilo.app 2>&1 | grep -E "Authority|flags"
# expect: Authority=Developer ID Application: Jins Kaduthodil (7CTKDV6KVS), flags include runtime
```

The workflow runs the same checks on the CI-built files and fails the job if any fails.

## Rollback

- **Before publishing**: delete the draft release (and the tag, `git push origin :refs/tags/v1.0.1`).
  Nobody saw anything.
- **After publishing, a bad version**: the quickest fix is to **un-publish** it (edit the release,
  "Set as a pre-release" or revert to draft). `releases/latest/download/latest.json` then points at
  the previous published release, so no new updates go out. Copies that already updated stay on the
  bad version.
- **Then ship 1.0.2** with the fix (same steps). The updater only moves forward: it never installs an
  older version, so a "rollback" for users is always a newer version number.
- A bad `latest.json` alone (not the app): edit it on the release and re-upload. Format at
  <https://v2.tauri.app/plugin/updater/#static-json-file>.

## How it works (for the curious)

- `.github/workflows/release.yml`: `verify` (versions, changelog, key) then a build matrix (macOS
  universal DMG, Windows NSIS, Linux AppImage + deb), then `release` (tags only) which writes
  `SHA256SUMS`, builds `latest.json` with `scripts/make-latest-json.mjs`, and creates the draft in one go.
- Updater bundles are only produced when `TAURI_SIGNING_PRIVATE_KEY` exists. They are switched on
  from CI (`TAURI_CONFIG`), not in `tauri.conf.json`, so building from source doesn't need our key.
- The Mac DMG layout and hibiscus background are `app/src-tauri/dmg/`. Known Tauri limitation: on CI
  runners the Finder step that places icons and draws the background may be skipped
  (<https://github.com/tauri-apps/tauri/issues/1731>); the DMG still contains Lilo and an
  Applications link.
- Windows installers are **not code-signed**, so SmartScreen warns on first run (README explains).
  Signing needs a certificate; Azure Trusted Signing or a code-signing cert would plug into
  `bundle.windows` later.
- Minimum macOS is 13 (Ventura): Lilo's text recognition and the web view features it uses are fine
  there, and it keeps older Intel Macs (2017 iMacs top out at 13) working. Raise
  `bundle.macOS.minimumSystemVersion` if 13 ever causes support trouble.
- No App Sandbox, empty hardened-runtime entitlements (`app/src-tauri/Entitlements.plist` says why).

Docs: [signing](https://v2.tauri.app/distribute/sign/macos/), [updater](https://v2.tauri.app/plugin/updater/),
[DMG](https://v2.tauri.app/distribute/dmg/).
