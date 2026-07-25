#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import {
  CorruptedSidecarError,
  createServer,
  detectKind,
  FutureSidecarError,
  injectUI,
  loadReview as rawLoadReview,
  renderDocument,
  reviewPath,
  shortId,
  updateReview,
  watchFile,
  wrapIfFragment,
  type ReviewFile,
  type SanitizeTier,
} from "@miru/server";
import { applyCommentUpdate, awaitAgentTurn, commentsOutput, installSkill } from "./commands.ts";
import skillMd from "./skill/SKILL.md" with { type: "text" };
// The frontend bundle produced by `bun run build:front`. Text-imported here so the
// server itself has no reference to the frontend build output — its tests can run
// without a prior build. `bun build --compile` inlines the bytes into the binary.
// oxlint-disable-next-line import/no-relative-parent-imports
import miruJs from "../../frontend/dist/miru.js" with { type: "text" };
// oxlint-disable-next-line import/no-relative-parent-imports
import miruCss from "../../frontend/dist/miru.css" with { type: "text" };
// The version is single-sourced in the repo-root package.json — workspace manifests
// carry no `version` — so `--version` reads it from there. `bun build --compile`
// inlines this JSON import into the binary, baking the build-time CalVer in.
// oxlint-disable-next-line import/no-relative-parent-imports
import pkg from "../../../package.json" with { type: "json" };

const USAGE = `usage:
  miru review <file.md|.html> [--port N] [--no-open] [--strict|--unsafe-raw] [--lang L]
      Review in the browser. Stays up; pressing "Approve" prints {approved, comments}
      as JSON to stdout and exits.
  miru comments <file> [--json]
      Show unresolved comments (no server needed).
  miru comment <file> --reply-to <id> <body>
      Reply to a comment (no server needed).
  miru comment <file> --resolve <id>
      Mark a comment resolved (no server needed).
  miru next <file>
      Block until comments await the agent, then print them as JSON (the agent loop:
      next -> fix -> reply, repeating). Returns immediately if some already await.
  miru install [claude-code]
      Install the miru skill into ~/.claude/skills/miru/SKILL.md.
  miru --version | -v
      Print the embedded build version and exit.`;

function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    Bun.spawn([cmd, ...args], { stdout: "ignore", stderr: "ignore" });
  } catch {
    // The server still runs even if the browser fails to open.
  }
}

function requireFile(file: string | undefined): string {
  if (!file || !existsSync(file)) {
    console.error(`miru: file not found: ${file ?? "(none)"}`);
    process.exit(1);
  }
  return file;
}

// Surface sidecar data-state problems as a clean message and exit rather than
// crashing with a stack trace. A corrupted file needs manual repair; a
// newer-than-us file means the binary is stale and needs upgrading.
async function loadReview(file: string): Promise<ReviewFile> {
  try {
    return await rawLoadReview(file);
  } catch (err) {
    if (err instanceof CorruptedSidecarError) {
      console.error(`miru: ${err.message}`);
      console.error("miru: fix the JSON file by hand and retry");
      process.exit(2);
    }
    if (err instanceof FutureSidecarError) {
      console.error(`miru: ${err.message}`);
      process.exit(2);
    }
    throw err;
  }
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: "string", default: "0" },
    "no-open": { type: "boolean", default: false },
    "unsafe-raw": { type: "boolean", default: false },
    strict: { type: "boolean", default: false },
    lang: { type: "string", default: "en" },
    json: { type: "boolean", default: false },
    "reply-to": { type: "string" },
    resolve: { type: "string" },
    version: { type: "boolean", short: "v", default: false },
  },
});

// `miru --version` / `miru -v` prints the embedded build version and exits. The
// value is the CalVer string baked into the root package.json by the bump script,
// so it matches the GitHub release tag the binary was built from.
if (values.version) {
  console.log(pkg.version);
  process.exit(0);
}

const command = positionals[0];

// ---------- headless: comments ----------
if (command === "comments") {
  const file = requireFile(positionals[1]);
  const review = await loadReview(file);
  console.log(commentsOutput(review, values.json));
  process.exit(0);
}

// ---------- install: drop the bundled skill into an agent's skills dir ----------
if (command === "install") {
  const agent = positionals[1] ?? "claude-code";
  if (agent !== "claude-code") {
    console.error(`miru: unsupported agent: ${agent} (supported: claude-code)`);
    process.exit(1);
  }
  const result = installSkill(join(homedir(), ".claude", "skills", "miru"), skillMd);
  if (!result.ok) {
    console.error(`miru: ${result.error}`);
    process.exit(1);
  }
  console.error(`miru: installed skill -> ${result.dest}`);
  process.exit(0);
}

// ---------- headless: comment (reply / resolve) ----------
if (command === "comment") {
  const file = requireFile(positionals[1]);
  const targetId = values["reply-to"] ?? values.resolve;
  if (!targetId) {
    console.error("miru: --reply-to <id> <body> or --resolve <id> is required");
    process.exit(1);
  }
  // Validate reply-body up front so we don't take the file lock just to reject.
  const replyBody = values["reply-to"] ? positionals[2] : undefined;
  if (values["reply-to"] && !replyBody) {
    console.error("miru: reply body required: miru comment <file> --reply-to <id> <body>");
    process.exit(1);
  }
  const update = { targetId, replyBody, resolve: Boolean(values.resolve) };
  const updatedId = await updateReview(file, (loaded) =>
    applyCommentUpdate(loaded, update, shortId("r"), new Date().toISOString()),
  );
  if (updatedId === null) {
    console.error(`miru: comment not found: ${targetId}`);
    process.exit(1);
  }
  console.log(`updated ${updatedId}`);
  process.exit(0);
}

// ---------- headless: next (block until comments await the agent, or it's approved) ----------
if (command === "next") {
  const file = requireFile(positionals[1]);
  // The exit-on-corruption loadReview wrapper goes in as the loader, so a sidecar
  // that turns bad mid-wait still surfaces as a clean message, not a stack trace.
  const s = await awaitAgentTurn(file, loadReview);
  console.log(JSON.stringify(s, null, 2));
  process.exit(0);
}

// ---------- interactive: review (blocking, one round) ----------
if (command !== "review") {
  console.error(USAGE);
  process.exit(1);
}
const file = requireFile(positionals[1]);

if (values.strict && values["unsafe-raw"]) {
  console.error("miru: --strict and --unsafe-raw are mutually exclusive");
  process.exit(1);
}
// default = presentation-permissive (executable bits still closed), --strict =
// typography-only (the old default), --unsafe-raw = no sanitization at all.
const tier: SanitizeTier = values["unsafe-raw"] ? "raw" : values.strict ? "strict" : "default";

const token = randomBytes(24).toString("hex");
const nonce = randomBytes(16).toString("base64");

// Render the current file contents into injected HTML. Called again on each file change.
const renderHtml = (): string => {
  const content = readFileSync(file, "utf8");
  const kind = detectKind(file);
  const rendered = renderDocument(content, kind, tier);
  return injectUI(wrapIfFragment(rendered, kind, basename(file), values.lang), { token, nonce });
};

const { server, finished, setHtml, notifyReload, notifyComments } = createServer({
  port: Number(values.port),
  initialHtml: renderHtml(),
  target: file,
  token,
  nonce,
  assets: { js: miruJs, css: miruCss },
});

// Live update: one directory watcher dispatches to source-vs-sidecar changes by
// filename. We watch the directory (not the files themselves) because (a) macOS
// fs.watch on a specific file false-fires for sibling renames in the same dir
// — without filtering, every sidecar write would re-broadcast "reload" and the
// browser would full-reload on every comment, and (b) the sidecar may not exist
// at startup and saveReview's atomic write-then-rename swaps its inode anyway.
//
// Both matches are prefix-based: macOS coalesces rapid rename sequences and only
// reports the FIRST event, so any `write(tmp) -> rename(tmp, target)` surfaces
// with `filename = <target>.tmp.<pid>.<uuid>` (or a similar suffix), never the
// final name. This applies to both saveReview (the sidecar) and editor / Edit-
// tool writes (the source). Order matters: sidecarName is a prefix-superset of
// sourceName (the sidecar lives at `<source>.miru.json`), so any sidecar tmp
// would also match sourceName — check sidecar first.
const sourceName = basename(file);
const sidecarName = basename(reviewPath(file));
const stopWatch = watchFile(dirname(file), (changed) => {
  if (changed === undefined) return;
  if (changed.startsWith(sidecarName)) {
    // The in-process POST routes already broadcast on their own; this catches
    // out-of-band edits (`miru comment` writes the sidecar directly). Double
    // broadcasts on a normal POST are harmless — the second one just refetches
    // the same data.
    notifyComments();
  } else if (changed.startsWith(sourceName)) {
    try {
      setHtml(renderHtml());
      notifyReload();
      console.error(`miru: ${file} changed — browser reloaded`);
    } catch (err) {
      console.error(`miru: re-render failed: ${String(err)}`);
    }
  }
});

const url = `http://127.0.0.1:${server.port}/`;
// Startup logs go to stderr; stdout is reserved for the final JSON.
console.error(`miru: reviewing ${file}`);
console.error(`miru: ${url}`);
console.error('miru: comment in the browser, then press "Approve"');
if (!values["no-open"]) openBrowser(url);

// Block until "Approve" is pressed (= the end of this round).
await finished;
stopWatch();

const review = await loadReview(file);
// Emit the verdict + unresolved comments as JSON on stdout → the AI agent reads/replies/fixes.
// Same projection as `miru comments --json` (commentsOutput json mode) by construction.
console.log(commentsOutput(review, true));

server.stop();
process.exit(0);
