---
paths:
  - "packages/server/**/*.test.ts"
---

# server (packages/server) — testing rules

Runner is **`bun test`** (built-in, Jest-like `describe` / `test` / `expect`). Colocate as `*.test.ts` next to the unit (e.g. `packages/server/src/export.test.ts`).

- **Cover pure logic and the security boundary first** — highest value:
  - `render.ts` — markdown→HTML, and that sanitization strips `<script>` / `on*=` / `<iframe>` (security-critical); `--unsafe-raw` bypasses it.
  - `@miru/contract` — each zod schema accepts a valid body and rejects malformed input (the server's validation boundary).
  - `store.ts` — `loadReview` / `saveReview` round-trip, the missing-file default, and that the write is atomic.
  - `server.ts` helpers — `isLocalRequest` (Host / Origin matrix: localhost passes, others 403) and the `x-miru-token` gate.
- **Filesystem tests use a tmp dir and clean up.** `store` writes `<file>.miru.json` beside the target — never write inside the repo; use an OS tmp path and remove it after.
- **Hermetic and fast**: no network, no real browser, no spawning the server unless the test is specifically about that. The tool is local-only.
- **Assert contracts, not internals**: don't snapshot large HTML blobs — assert the specific guarantee (tag removed, field present, status code).
