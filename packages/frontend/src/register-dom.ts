// Registers a DOM (happy-dom) on the global scope so frontend unit tests can build
// fixtures and exercise document-dependent helpers under `bun test`. Imported at the
// top of each frontend *.test.tsx — deliberately not a global bunfig preload, so the
// server tests (Bun, no DOM) keep running without a DOM injected under them. The
// `test` script in package.json passes `--isolate`, which puts each test file in its
// own process so happy-dom's patched globals never leak across files.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!(globalThis as { happyDOM?: unknown }).happyDOM) {
  GlobalRegistrator.register();
}
