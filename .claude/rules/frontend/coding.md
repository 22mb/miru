---
paths:
  - "packages/frontend/**/*.{ts,tsx,css}"
---

# frontend (packages/frontend) — coding rules (React browser UI)

Runs in the **browser**: bundled by `bun build` and embedded into the server binary as text. Type-checked by `packages/frontend/tsconfig.json` (lib `DOM` / `DOM.Iterable` + React types, plus `bun` types for `bun:test`).

- **No Bun, no `node:` imports, no `process`** in app code — server-only packages aren't in this package's `package.json`, so they won't resolve; the workspace boundary (isolated install) enforces it.
- **Shared types come from `@miru/contract`, as types only**: `import type { Comment } from "@miru/contract"`. It also exports zod schemas, but importing them as *values* pulls zod into the browser bundle — keep it `import type`.
- **React 19 function components + hooks** (`useState` / `useEffect` / `useCallback` / `useMemo`). One `createRoot` mounts into `#miru-root`.
- **All server calls go through `api()`** (`api.ts`) with the `x-miru-token` header. CSP allows `connect-src 'self'` only — never add an external fetch / CDN / font.
- **Imports**: explicit `.ts` / `.tsx` extensions; `import type` for types (`verbatimModuleSyntax`).
- **Keep the bundle lean** — it's already ~1MB (mostly React). Don't add UI / util libraries.
- **Ignore events inside the panel** when handling document selection / Alt-click (`closest("#miru-root")`).
- **Anchoring must stay restore-robust** (`anchor.ts` / `dom.ts`): text offsets via `TreeWalker` with exact → prefix/suffix re-search → quote-only fallback; elements via selector → role+accessible-name → tag-chain+text-hint. Mark unrestorable anchors `stale` — don't drop them.
- **Styling is plain CSS** in `miru.css`: BEM-ish names (`miru-card__body`), `--miru-*` custom properties, z-index only via `--miru-z-*`. No CSS-in-JS.

Tests: see the frontend testing rule.
