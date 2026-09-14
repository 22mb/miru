---
paths:
  - "packages/cli/**/*.ts"
---

# cli (packages/cli) — coding rules (the `miru` entrypoint)

Runtime is **Bun**, no DOM — same conventions as the server package: explicit `.ts` extensions, `import type` for type-only imports, `noUncheckedIndexedAccess` is on (guard `positionals[n]` and regex matches).

- **stdout is machine output, stderr is for humans.** `miru next` and the other JSON-emitting commands print their payload to **stdout** and the human↔AI loop parses it; everything else — progress, usage on a bad invocation, errors — goes to `console.error` with the `miru: ` prefix; `--help` / `--version` output is a payload (stdout, exit 0). Never `console.log` anything but the intended payload.
- **Assets are embedded at compile time** via `import ... with { type: "text" }` (the frontend bundle from `packages/frontend/dist`, the skill's SKILL.md) and `with { type: "json" }` (the root package.json for `--version`). Don't switch these to runtime disk reads — they must survive `bun build --compile`.
- Running from source needs the frontend bundle to exist: `bun run build:front` first (`bun run dev` does this for you, and so does this package's `test` script, because `cli.test.ts` spawns `cli.ts`; `bun run build` removes the bundle again).
- **The panel build lives here too**: `build-front.ts` (what `bun run build:front` runs) and `react-compiler.ts` (the `Bun.build` plugin that runs the React Compiler via `oxc-transform-react`, a devDependency of this package; `dev-server.ts` shares it). Both are build-time only and must never be imported by `cli.ts`: the compile step bundles its import graph, and the native binding must stay out of the binary.
- **Don't weaken the security defaults from the CLI side**: loopback bind, per-launch `randomBytes` token, `--unsafe-raw` as the only sanitization escape hatch, the symlink guard in `miru install`. A new flag must not silently widen exposure.
- Spawn external programs with `Bun.spawn`'s array form (no shell) — see `openBrowser`.
- User errors: `console.error("miru: ...")` + non-zero exit, matching the existing messages.
- **Command logic lives in `commands.ts`**, importable without executing the entry script (`cli.ts` runs on import and must never be imported back). New command behavior goes there as value-in/value-out functions — inject I/O seams (like the review loader) as parameters; `cli.ts` keeps arg parsing, printing, `process.exit`, and the long-running `review` orchestration.

Tests: `bun test`, colocated `*.test.ts` (see `commands.test.ts`); style per the server testing rule.
