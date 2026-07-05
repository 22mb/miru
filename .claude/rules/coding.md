---
paths:
  - "packages/**/*.{ts,tsx}"
  - "scripts/**/*.ts"
---

# workspace-wide coding rules — functional style

The codebase leans functional. Not dogma — the working shape is:

- **Pure functions over classes.** Domain logic is functions that take values and return new values (`addReply`, `promoteDrafts`, `agentView` in the contract). The only classes are `Error` subclasses (`CorruptedSidecarError`, `FutureSidecarError`) — keep it that way.
- **Don't mutate inputs.** Updates are spreads / `map` / `filter` producing new objects; return the input unchanged when nothing changed (`promoteDrafts` hands back untouched comments as-is so callers can skip a save). Local `let` counters and flags inside a function are fine — the rule is that no mutation escapes the function.
- **Push I/O to the edges.** `store` / `server` / `cli` read, write, and serve; the logic they call stays pure and takes/returns plain values. New features keep this split: pure core, thin I/O shell — the pure part is what gets unit-tested.
- **Model variants as discriminated unions** (`Anchor = z.discriminatedUnion("type", …)`) and narrow on the tag — not class hierarchies, not boolean-flag combinations.
- On the React side this shows up as function components + hooks and derived-not-duplicated state (see the frontend rule).
