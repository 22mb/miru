---
paths:
  - "packages/server/**/*.ts"
---

# server (packages/server) — coding rules (Bun server + CLI)

Runtime is **Bun**, not Node. Type-checked by `packages/server/tsconfig.json` (lib `ESNext` + `bun` types, **no DOM**).

- **Use Bun APIs**: `Bun.serve`, `Bun.file`, `Bun.write`, `Bun.markdown`, `Bun.spawn`. For stdlib, use `node:`-prefixed imports (`node:fs`, `node:path`, `node:crypto`, `node:os`, `node:util`).
- **No DOM**: `document` / `window` are type errors here. `Response` / `Request` / `ReadableStream` / `TextEncoder` come from Bun globals.
- **No React / frontend deps** — they aren't in this package's `package.json`, so `import "react"` won't resolve; the workspace boundary (isolated install) enforces it. Don't add a lint ban-list.
- **Imports**: explicit `.ts` extensions (`./store.ts`); `import type` / `export type` for type-only imports (`verbatimModuleSyntax`).
- **`noUncheckedIndexedAccess` is on**: indexed access is `T | undefined` — guard it (`positionals[1]`, regex `m[1]`).
- **The API contract is `@miru/contract`** (`packages/contract`): zod schemas + `z.infer` types are the single source of truth shared with the frontend. Validate every request body with `Schema.safeParse(...)` and return 400 on failure — never hand-parse. Add new wire / persisted shapes as zod schemas there, not as bare `interface`s.
- **stdout is machine output, stderr is for humans**: `miru review` prints the final JSON to **stdout**; all logs / diagnostics go to `console.error`. Never `console.log` anything but the intended payload — the human↔AI loop parses stdout.
- **Persistence is atomic**: `saveReview` writes a temp file then renames. Serialize load-modify-save through the server's `withWriteLock` so concurrent writes can't clobber.
- **Security invariants — do not weaken**: bind `127.0.0.1` only; require the per-launch `x-miru-token` on `/api/*` (SSE excepted); validate Host / Origin (`isLocalRequest`); strict CSP with a per-load nonce; sanitize all rendered HTML server-side (`sanitize-html`). `--unsafe-raw` is the only sanitization escape hatch.
- **IDs** via the `shortId(prefix)` helper.
- **Comments explain why, not what** — match the terse style already in these files.

Tests: see the server testing rule — `bun test`, colocated `*.test.ts`.
