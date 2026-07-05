---
paths:
  - "packages/contract/*.ts"
---

# contract (packages/contract) — coding rules (shared wire / persisted shapes)

The single source of truth for every shape that crosses the wire or lands in a `.miru.json` sidecar: zod schemas, their `z.infer` types, and the pure domain helpers that operate on them. Code lives in `index.ts` at the package root — there is no `src/`.

- **Schema first**: new shapes are zod schemas with a same-named `z.infer` type export (`export const Comment` / `export type Comment`) — never bare `interface`s for wire / persisted data.
- **Two consumers, two constraints**: the server imports schemas as *values* (validation); the frontend imports **types only**, which lets the bundler erase this module (and zod) from the browser bundle. Don't add anything the frontend would need as a runtime value.
- **Bound every field**: strings get `.max(...)` (reuse `PROSE_MAX` / `SNIPPET_MAX` / `LABEL_MAX` …), numbers get `.int().min(0).max(...)`. Unbounded fields are a DoS amplifier — the caps exist because a security review found their absence.
- **Sidecar evolution policy** (documented at `CURRENT_VERSION`): additive fields take a `.default(...)` so old sidecars keep parsing, no version bump; breaking changes bump `CURRENT_VERSION` and add a migration branch in `store.loadReview`.
- **Domain helpers stay pure** — take values, return values, no I/O, no Bun APIs. That's what lets the server and the CLI share them and keeps them trivially testable.

Tests: `bun test`, colocated `index.test.ts` — every schema accepts a valid body and rejects malformed input (this is the server's validation boundary); helpers get plain unit tests.
