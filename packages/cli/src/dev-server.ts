#!/usr/bin/env bun
// Frontend dev loop, run as `bun run dev:front [file] [--port N]`.
//
// cli.ts embeds the built frontend bundle at compile time (text imports of dist),
// which forces a `build:front` + restart to see any panel change. This entry is
// `miru review` run straight from source instead: the panel is bundled in-process
// with Bun.build (same bundler as production, ~30 ms, dev define + inline
// sourcemaps), packages/frontend/src is watched, and every change rebuilds the
// assets and reloads connected browsers over the review server's own SSE channel.
// No dist, no restart, no extra tooling — and the page ships with the real CSP,
// so dev behaves like the embedded binary. Approve does not exit here; the loop
// runs until killed.
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { parseArgs } from "node:util";
import {
  createServer,
  detectKind,
  injectUI,
  renderDocument,
  reviewPath,
  watchFile,
  wrapDocument,
  type WrappedDocument,
} from "@miru/server";

const FRONTEND_SRC = join(import.meta.dirname, "../../frontend/src");
const REPO = join(import.meta.dirname, "../../..");

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: "string", default: "4400" },
    "no-open": { type: "boolean", default: false },
  },
});

// Default target: a scratch copy of the rich HTML example, so the sidecar
// (<file>.miru.json) lands in tmp, not the repo. Pass a file to review a real
// document instead (its sidecar then persists next to it as usual).
let file: string;
const given = positionals[0];
if (given) {
  if (!existsSync(given)) {
    console.error(`miru-dev: file not found: ${given}`);
    process.exit(1);
  }
  file = given;
} else {
  file = join(mkdtempSync(join(tmpdir(), "miru-dev-")), "sample.html");
  copyFileSync(join(REPO, "examples/sample.html"), file);
}

// Mutated in place on every rebuild; the server reads them per request.
const assets = { js: "", css: "" };

async function buildAssets(): Promise<boolean> {
  // Everything inside the try: Bun.build throws on compile errors (an AggregateError
  // of BuildMessages — console.error renders them with code frames), and this runs
  // from the watch callback where an escaped rejection would take the whole dev
  // server down with it. A broken save must degrade to "last good bundle + error in
  // the terminal", never to a dead process.
  try {
    const result = await Bun.build({
      entrypoints: [join(FRONTEND_SRC, "index.tsx")],
      // Development define keeps React's dev warnings and StrictMode checks alive;
      // production embedding (`build:front`) stays the minified bun build.
      define: { "process.env.NODE_ENV": JSON.stringify("development") },
      sourcemap: "inline",
    });
    const bundle = result.outputs[0];
    if (!bundle) {
      console.error("miru-dev: build produced no output");
      return false;
    }
    assets.js = await bundle.text();
    assets.css = readFileSync(join(FRONTEND_SRC, "miru.css"), "utf8");
    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}

if (!(await buildAssets())) process.exit(1);

const token = randomBytes(24).toString("hex");
const nonce = randomBytes(16).toString("base64");

const render = (): WrappedDocument => {
  const kind = detectKind(file);
  const rendered = renderDocument(readFileSync(file, "utf8"), kind, "default");
  const wrapped = wrapDocument(rendered, kind, basename(file), "en");
  return { html: injectUI(wrapped.html, { token, nonce }), doc: wrapped.doc };
};

const initial = render();
const { server, setHtml, notifyDocChange, notifyReload, notifyComments } = createServer({
  port: Number(values.port),
  initialHtml: initial.html,
  initialDoc: initial.doc,
  target: file,
  token,
  nonce,
  assets,
});

// Rebuild on frontend source changes, serialized: changes that land mid-build get
// one trailing rebuild instead of a pile-up. Test files don't affect the bundle.
let building = false;
let pending = false;
async function rebuild(): Promise<void> {
  if (building) {
    pending = true;
    return;
  }
  building = true;
  do {
    pending = false;
    if (await buildAssets()) {
      notifyReload();
      console.error("miru-dev: frontend rebuilt — browser reloaded");
    } else {
      console.error(
        "miru-dev: build failed — still serving the last good bundle; fix and save again",
      );
    }
  } while (pending);
  building = false;
}
watchFile(FRONTEND_SRC, (changed) => {
  if (changed === undefined || /\.test\./.test(changed)) return;
  void rebuild();
});

// Default-fixture mode: the served file is a frozen scratch copy, so edits to the
// example source would otherwise never reach the browser — sync them over, and the
// doc watcher below picks the copy up and re-renders. This keeps the default document
// as live-editable as a real one without its sidecar landing in the repo.
if (!given) {
  const example = join(REPO, "examples/sample.html");
  watchFile(dirname(example), (changed) => {
    // Prefix match for the same rename-coalescing reason as the doc watcher below.
    if (changed?.startsWith(basename(example))) copyFileSync(example, file);
  });
}

// Same directory-watch wiring as cli.ts (prefix-matched, sidecar checked first) —
// see cli.ts for why the matching works this way.
const sourceName = basename(file);
const sidecarName = basename(reviewPath(file));
watchFile(dirname(file), (changed) => {
  if (changed === undefined) return;
  if (changed.startsWith(sidecarName)) {
    notifyComments();
  } else if (changed.startsWith(sourceName)) {
    try {
      const next = render();
      setHtml(next.html, next.doc);
      notifyDocChange();
      console.error(`miru-dev: ${file} changed — browser updated`);
    } catch (err) {
      console.error(`miru-dev: re-render failed: ${String(err)}`);
    }
  }
});

const url = `http://127.0.0.1:${server.port}/`;
console.error(`miru-dev: reviewing ${file}`);
console.error(`miru-dev: ${url} — edits under packages/frontend/src reload live`);
// Same spawn shape as cli.ts's openBrowser; kept local so this dev entry never
// becomes an import of the CLI script (which executes on import).
if (!values["no-open"]) {
  const platform = process.platform;
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const openArgs = platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    Bun.spawn([cmd, ...openArgs], { stdout: "ignore", stderr: "ignore" });
  } catch {
    // The server still runs even if the browser fails to open.
  }
}
