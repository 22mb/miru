// Registers a DOM (happy-dom) on the global scope so frontend unit tests can build
// fixtures and exercise document-dependent helpers under `bun test`. Imported at the
// top of each frontend *.test.tsx — deliberately not a global bunfig preload, so the
// server tests (Bun, no DOM) keep running without a DOM injected under them.
//
// Cross-package leak: happy-dom's `GlobalRegistrator.register()` patches globalThis
// (fetch, Response, Request, Location, …) for the whole process, and bun test runs
// every file it is given in one process — so a server test sharing that process
// would see happy-dom's fetch shim instead of Bun's native one and fail with cryptic
// HTTP errors. The root `test` script runs `bun run --filter '*' test`, giving each
// workspace package its own process, so this DOM never reaches a package that
// didn't ask for it. Don't collapse that back into one `bun test` over every path.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!(globalThis as { happyDOM?: unknown }).happyDOM) {
  GlobalRegistrator.register();
}
