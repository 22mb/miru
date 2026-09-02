<p align="center">
  <b>English</b> · <a href="CONTRIBUTING.ja.md">日本語</a>
</p>

# Contributing to miru

Thanks for taking the time to contribute. miru is a small, local-only tool with a deliberately
narrow [scope](README.md#scope) — rendered review of md / HTML documents. Changes that pull it
toward generation, sharing, or code-diff review are out of scope; everything else is welcome.

## Setup

miru runs on [Bun](https://bun.sh) (CI pins **1.4.0**) — no other runtime is needed.

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

### Frontend dev loop

The panel is injected into a server-rendered document, so frontend work runs against a real
review server — one command runs both, straight from source:

```sh
bun run dev:front                     # scratch copy of examples/sample.html → http://127.0.0.1:4400
bun run dev:front path/to/doc.md      # review a specific document (its sidecar persists as usual)
```

`packages/cli/src/dev-server.ts` bundles the panel in-process with `Bun.build` (dev define,
inline sourcemaps) and rebuilds on every change under `packages/frontend/src`; connected
browsers reload over the server's own SSE channel. No `build:front`, no embedded assets, no
extra tooling — and the page ships with the production CSP, so dev behaves like the binary.
Flags (after `--`): `--port N` (default 4400), `--no-open`. Final verification still goes
through the embedded bundle (`build:front` + restart).

## Before you open a PR

CI runs these four checks on every PR — run them locally first:

```sh
bun run typecheck      # tsc -b
bun run lint           # oxlint
bun run fmt:check      # oxfmt --check  (the pre-commit hook formats staged files for you)
bun run test           # bun run --filter '*' test  (per-package processes: frontend's happy-dom stays out of the server tests)
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
  server-side (the default tier passes presentation — CSS / SVG / media — and strips executable
  bits; `--strict` is typography-only). `--unsafe-raw` is the only sanitization escape hatch.
