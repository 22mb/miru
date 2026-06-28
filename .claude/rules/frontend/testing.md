---
paths:
  - "packages/frontend/**/*.test.{ts,tsx}"
---

# frontend (packages/frontend) — testing rules

Runner is **`bun test`** with a DOM. Register happy-dom at the **top of each test**
(`import "./register-dom.ts"`), not via a global preload, so it never leaks into the server
package's tests. Colocate as `*.test.tsx`. Component tests use **`@testing-library/react` +
`@testing-library/user-event`** (both devDeps — not in the browser bundle).

The bullets below encode the `eslint-plugin-testing-library` / `jest-dom` conventions and the
testing-library docs; rule names are cited so the intent is traceable. They are conventions
here — oxlint doesn't run those plugins by default — so apply them by hand.

## What to test

- **Prefer extracting pure functions and testing those.** The anchor / offset helpers in `anchor.ts` / `dom.ts` are the highest-value targets: `offsetOf`, `rangeFromOffsets`, `buildTextAnchor` / `resolveText`, `buildElementAnchor` / `resolveElement`. Build a small DOM fixture (`fixtures.ts`) and assert each restore path: exact offset, prefix/suffix re-search, quote-only, and `stale` when nothing matches.
- **Keep component tests light** (`components.tsx`): assert handler wiring (activate / reply / resolve / remove fire) and that `stale` / `resolved` / suggestion states render — don't deep-render the whole tree or test React internals. Stub `fetch` / `api()`; never reach the network.

## Queries

- **Query by accessibility, in priority order** (testing-library query priority): `getByRole` (with a `name`) → `getByLabelText` → `getByPlaceholderText` → `getByText` → `getByDisplayValue` → `getByAltText` → `getByTitle` → `getByTestId` (last resort). Reach for `getByRole(role, { name })` first — it asserts the element is in the accessibility tree, the way a user perceives it.
- **`container.querySelector` / raw DOM traversal is a last resort** (`no-container`, `no-node-access`). Use it only for things with no accessible handle: a styling-state class (`is-resolved`), verifying `dangerouslySetInnerHTML` passthrough via `innerHTML`, or a deliberately non-semantic clickable container (`.miru-card`). If you reach for it to check user-visible text, switch to `getByText` / `getByRole`.
- **Pick the right query variant** (`prefer-presence-queries`, `prefer-find-by`): `getBy*` for something that must already be present (throws with a helpful diff), `queryBy*` **only** to assert absence (`expect(queryBy…).toBeNull()`), `findBy*` (awaited) for something that appears asynchronously. Never `waitFor` + `getBy` — use `await findBy*`.
- **Scope with `within(node)`** when the same role/name appears more than once (e.g. the "Reply" toggle button and the reply form's "Reply" submit) — query within the form rather than disambiguating by class.

## Interactions

- **Drive interactions with `user-event`, not `fireEvent`** (`prefer-user-event`): it simulates real interactions (visibility / disabled checks, full event sequences). That fidelity is what makes React controlled-input `onChange` fire under happy-dom, so typed flows (composing a comment / reply) are covered here, not deferred to a browser pass.
- **`const user = userEvent.setup()` inside each test, before render; `await` every interaction** (`await-async-events`). The docs explicitly discourage calling `userEvent.setup()` or `render()` in `before` / `after` hooks — keep both per-test (`no-render-in-lifecycle`).

## Assertions & hygiene

- Assert with `bun:test`'s `expect`. (jest-dom matchers — `toBeInTheDocument`, `toBeDisabled`, `toHaveTextContent`, `toHaveClass` — read better and back the `eslint-plugin-jest-dom` rules, but need `@testing-library/jest-dom` registered; not currently a dep.)
- **No leftover debug output** (`no-debugging-utils`): drop `screen.debug()` / `logRoles` before committing.
- **Import test utilities from `@testing-library/react`, never `@testing-library/dom` directly** (`no-dom-import`).

## bun-test specifics (deliberate deviations from the lint defaults)

- **Don't use the global `screen`** (deviates from `prefer-screen-queries`): it binds to `document.body` when `@testing-library/dom` loads — which happens before per-file happy-dom registration — so it throws. Use the queries returned by `render()` (or `within(node)`), which bind at call time.
- **Register `afterEach(cleanup)` manually** (deviates from `no-manual-cleanup`): testing-library's auto-cleanup isn't wired under `bun test`, so unmount explicitly to keep tests isolated.

## Hermetic and fast

- Construct the minimal DOM the test needs; never load a real document or reach the server.
