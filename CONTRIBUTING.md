<p align="center">
  <b>English</b> · <a href="CONTRIBUTING.ja.md">日本語</a>
</p>

# Contributing to miru

Thanks for taking the time to contribute. miru is a small, local-only tool with a deliberately
narrow [scope](README.md#scope) — rendered review of md / HTML documents. Changes that pull it
toward generation, sharing, or code-diff review are out of scope; everything else is welcome.

## Setup

miru runs on [Bun](https://bun.sh) (CI pins **1.3.14**) — no other runtime is needed.

```sh
bun install        # also wires up the git hooks via lefthook (prepare script)
```

The repo is a Bun workspace with four packages:

- **`packages/contract`** — zod schemas + `z.infer` types. The single source of truth for every
  wire / persisted shape, shared by server and frontend.
- **`packages/server`** — the Bun review server + domain helpers (render / inject / store / watch),
  consumed by the CLI.
- **`packages/cli`** — the `miru` CLI (`miru review` / `next` / `comment` / …), built on `@miru/server`.
- **`packages/frontend`** — the React UI, bundled and embedded into the `miru` binary.

## Development

```sh
bun run dev review examples/sample.md   # run the CLI from source
bun run build:front                     # packages/frontend/src → packages/frontend/dist/miru.{js,css}
bun run build                           # compile the single binary ./miru (assets embedded)
```

The frontend bundle is embedded into the CLI at build time (text imports of
`packages/frontend/dist`), so rebuild it (`build:front`) after frontend changes before testing
the binary or `miru review`.

## Before you open a PR

CI runs these four checks on every PR — run them locally first:

```sh
bun run typecheck      # tsc -b
bun run lint           # oxlint
bun run fmt:check      # oxfmt --check  (the pre-commit hook formats staged files for you)
bun test
```

Keep PRs focused, and make sure CI is green. New tests should live next to the unit as
`*.test.ts` / `*.test.tsx`.

## Conventions

Per-package coding and testing conventions live in [`.claude/rules/`](.claude/rules) (path-scoped,
also fed to AI agents). Two invariants worth calling out up front:

- **The contract is the source of truth.** Add new wire / persisted shapes as zod schemas in
  `@miru/contract`, not as bare interfaces, and validate request bodies with `safeParse` (400 on
  failure) — never hand-parse.
- **Don't weaken the security boundary.** miru binds `127.0.0.1` only, gates `/api/*` on a
  per-launch token, validates Host / Origin, ships a strict CSP, and sanitizes all rendered HTML
  server-side. `--unsafe-raw` is the only sanitization escape hatch.
