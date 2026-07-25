# CLAUDE.md

Working notes for AI agents. Setup, build commands, and package layout live in
[CONTRIBUTING.md](CONTRIBUTING.md); per-package coding and testing conventions live in
[`.claude/rules/`](.claude/rules) (path-scoped). This file covers what those don't:
the workflow around the code.

## Language

- Everything that lands in the repo — commits, PRs, code, comments, docs — is **English**.
- README and CONTRIBUTING have `.ja.md` counterparts. Editing one side means updating both.

## Build & verify loop

- The frontend is **embedded into the server binary**. UI changes are invisible until you
  rebuild (`bun run build:front` when running via `bun run dev`, `bun run build` for the
  `./miru` binary) **and restart the server**.
- For panel iteration, `bun run dev:front` runs the review server from source and
  rebuilds the panel with in-process `Bun.build` on every `packages/frontend/src`
  change — the browser auto-reloads, no build:front needed (see CONTRIBUTING).
  Dev-only: final verification still goes through the embedded bundle via the
  rebuild → restart loop above.
- After any UI change: rebuild → restart the running `miru review` server → verify in the
  browser (e.g. `bun run dev review examples/sample.md` + an agent-browser screenshot)
  **before reporting done**. "The code is edited" is not done.
- Never start `miru review` twice for the same file — the second bind fails. Restarting
  means killing the old process first, then relaunching.
- The Stop hook lint/typechecks the files you edited but **does not run tests** — run
  `bun run test` yourself before finishing (one package only:
  `bun run --filter '@miru/server' test`). Use the script, not a bare `bun test` over
  several packages: `test` fans out per package so each gets its own process, which is
  what keeps the frontend's happy-dom globals out of the server tests.
- A new package with tests needs its own `"test": "bun test"` script — `--filter` skips
  packages that don't have one, silently (`bun test` exits 1 when it matches no files).

## Release

- Version is CalVer (`YYYY.M.D[.n]`), single-sourced in the root `package.json`; bump
  with `bun run bump`. Merging the bump to `main` is what triggers the release workflow.
- The Homebrew tap (`22mb/homebrew-miru`) is a **separate repo**. After a release, run its
  "Bump formula" workflow from the Actions tab — it rewrites the formula, verifies it with
  `brew audit`/`install`/`test`, and opens the PR. Nothing here pushes to the tap, so the
  tap needs no credentials of ours and this repo needs none of its.

## Scope & philosophy

- The scope is deliberately narrow (see README "Scope"). **Removing a feature is a valid
  fix** — when a feature is questionable, propose removal or deferral, not elaboration.
- No new runtime dependencies or UI libraries; plain CSS. Details are in the rules.
