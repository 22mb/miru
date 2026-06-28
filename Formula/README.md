# Homebrew distribution (`miru`)

`miru` is distributed via Homebrew as a **single executable binary** uploaded to
GitHub Releases (built with `bun build --compile`, so the Bun runtime is bundled
in). It is distributed through a **custom tap**, not the official homebrew-core.

For users:

```sh
brew install 22mb/miru/miru
# Written out in full:
#   brew tap 22mb/miru        # = github.com/22mb/homebrew-miru
#   brew install miru
```

In `brew install 22mb/miru/miru`, the `22mb/miru` part is the **tap name**; the
actual repository is `github.com/22mb/homebrew-miru` (Homebrew prepends
`homebrew-` to the tap name).

## What this directory (`miru/Formula/`) is for

`miru/Formula/miru.rb` is the **canonical source** of the formula. What `brew`
actually reads is a copy in the separate `22mb/homebrew-miru` repository, which
the release CI keeps in sync (see below). Keeping it in the main repository lets
formula changes be reviewed alongside the changes to `miru` itself.

## How to set up the tap repository (`22mb/homebrew-miru`)

1. **The repository name must be `homebrew-miru`** (`brew tap 22mb/miru`
   resolves to this name).
2. Put the formula at `Formula/miru.rb` in the repository (`Formula/` is
   Homebrew's standard search path).
   - Minimal setup: just `homebrew-miru/Formula/miru.rb` is enough.
3. Copy this `miru/Formula/miru.rb` as-is and make the initial commit.
4. Verify it works:

   ```sh
   brew tap 22mb/miru
   brew install miru
   brew test miru
   brew audit --strict --online 22mb/miru/miru   # pre-publish check
   ```

## Automatic bump policy via the release CI

A push of a CalVer (`YYYY.M.D`, e.g. `2026.6.27`) tag triggers a release. The
formula's `version`, the tag in each `url`, and each `sha256` are **rewritten
automatically by the CI** (the `sha256 "REPLACE_WITH_SHA256"` in this file is a
placeholder before the bump).

Steps at the end of the release workflow (overview):

1. Attach the four binaries (`miru-macos-arm64` / `miru-macos-x64` /
   `miru-linux-arm64` / `miru-linux-x64`) to the GitHub Release.
2. Compute the SHA256 of each asset (e.g. `shasum -a 256 miru-macos-arm64`).
3. Replace the following in `Formula/miru.rb` with the new values:
   - `version "..."` with this release's CalVer
   - the four `sha256 "..."` with each asset's real hash
   - `#{version}` in the `url`s **needs no editing** since it interpolates
     `version` (the release tag equals `version`, with no `v` prefix).
4. Commit / push the updated `Formula/miru.rb` to the tap repository
   `22mb/homebrew-miru`.

Implementation notes:

- The replacement can be done with `sed` or a `bump-formula-pr`-style script.
  The simplest approach is a single job that, once the Release is ready, fetches
  the four assets with `gh release download` → runs `shasum` → applies the `sed`
  replacements to the formula → pushes to the tap repository.
- The official `brew bump-formula-pr` works too, but for updating multiple urls
  (split by OS/arch) in one go, a hand-rolled `sed` replacement is simpler.
- Pushing to the tap requires write access to `22mb/homebrew-miru` (a PAT or a
  deploy key).

## How the split works (formula side)

Using `on_macos` / `on_linux` and `Hardware::CPU.arm?`, it branches into the
four OS × arch combinations, each with its corresponding asset URL, sha256, and
`install` (`bin.install "<asset>" => "miru"`). Only the branch matching the
running platform is evaluated.
