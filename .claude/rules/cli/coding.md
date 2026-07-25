---
paths:
  - "packages/cli/**/*.ts"
---

# cli (packages/cli) — coding rules (the `miru` entrypoint)

Runtime is **Bun**, no DOM — same conventions as the server package: explicit `.ts` extensions, `import type` for type-only imports, `noUncheckedIndexedAccess` is on (guard `positionals[n]` and regex matches).

- **stdout is machine output, stderr is for humans.** `miru next` and the other JSON-emitting commands print their payload to **stdout** and the human↔AI loop parses it; everything else — progress, usage, errors — goes to `console.error` with the `miru: ` prefix. Never `console.log` anything but the intended payload.
- **Assets are embedded at compile time** via `import ... with { type: "text" }` (the frontend bundle from `packages/frontend/dist`, the skill's SKILL.md) and `with { type: "json" }` (the root package.json for `--version`). Don't switch these to runtime disk reads — they must survive `bun build --compile`.
- Running from source needs the frontend bundle to exist: `bun run build:front` first (`bun run dev` does this for you).
- **Don't weaken the security defaults from the CLI side**: loopback bind, per-launch `randomBytes` token, `--unsafe-raw` as the only sanitization escape hatch, the symlink guard in `miru install`. A new flag must not silently widen exposure.
- Spawn external programs with `Bun.spawn`'s array form (no shell) — see `openBrowser`.
- User errors: `console.error("miru: ...")` + non-zero exit, matching the existing messages.

Tests: `bun test`, colocated `*.test.ts`; style per the server testing rule. This package has none yet — the first one also needs a `"test": "bun test"` script in `packages/cli/package.json`, or the root `bun run test` fan-out will skip it.
