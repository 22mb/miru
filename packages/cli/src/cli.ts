#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import {
  CorruptedSidecarError,
  createServer,
  detectKind,
  injectUI,
  loadReview as rawLoadReview,
  renderCommentBody,
  renderDocument,
  reviewPath,
  saveReview,
  shortId,
  watchFile,
  wrapIfFragment,
  type ReviewFile,
} from "@miru/server";
import { awaitingAgent, openForAgent, type Comment, type Reply } from "@miru/contract";
import skillMd from "./skill/SKILL.md" with { type: "text" };
// The CLI's own manifest — pulled in so `--version` prints the build-time CalVer
// the bump script wrote. The parent-directory hop is the only way to reach it
// without duplicating the field into src/, since package.json must stay at the
// workspace root for `bun build --compile` to resolve.
// oxlint-disable-next-line import/no-relative-parent-imports
import pkg from "../package.json" with { type: "json" };

const USAGE = `usage:
  miru review <file.md|.html> [--port N] [--no-open] [--unsafe-raw] [--lang L]
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

// Surface a corrupted sidecar as a clean message and exit, rather than crashing with
// a stack trace. The user fixes the JSON by hand and retries.
async function loadReview(file: string): Promise<ReviewFile> {
  try {
    return await rawLoadReview(file);
  } catch (err) {
    if (err instanceof CorruptedSidecarError) {
      console.error(`miru: ${err.message}`);
      console.error("miru: fix the JSON file by hand and retry");
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
    lang: { type: "string", default: "en" },
    json: { type: "boolean", default: false },
    "reply-to": { type: "string" },
    resolve: { type: "string" },
    version: { type: "boolean", short: "v", default: false },
  },
});

// `miru --version` / `miru -v` prints the embedded build version and exits. The
// value is the CalVer string baked into packages/cli/package.json by the bump
// script, so it matches the GitHub release tag the binary was built from.
if (values.version) {
  console.log(pkg.version);
  process.exit(0);
}

const command = positionals[0];

// ---------- headless: comments ----------
if (command === "comments") {
  const file = requireFile(positionals[1]);
  const review = await loadReview(file);
  const unresolved = review.comments.filter(openForAgent);
  if (values.json) {
    console.log(JSON.stringify({ approved: review.approved, comments: unresolved }, null, 2));
  } else if (unresolved.length === 0) {
    console.log("No unresolved comments.");
  } else {
    for (const c of unresolved) {
      const loc = c.anchor.type === "text" ? `"${c.anchor.quote}"` : c.anchor.selector;
      const sug = c.suggestion ? `\n  suggestion: ${c.suggestion.replacement}` : "";
      console.log(`- [${c.id}] (${c.anchor.type}) ${loc}\n  ${c.body}${sug}`);
    }
  }
  process.exit(0);
}

// ---------- install: drop the bundled skill into an agent's skills dir ----------
if (command === "install") {
  const agent = positionals[1] ?? "claude-code";
  if (agent !== "claude-code") {
    console.error(`miru: unsupported agent: ${agent} (supported: claude-code)`);
    process.exit(1);
  }
  const dir = join(homedir(), ".claude", "skills", "miru");
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, "SKILL.md");
  // Refuse to write through a symlink at the destination — defends against a planted
  // symlink redirecting the write to (e.g.) ~/.bashrc.
  if (existsSync(dest) && lstatSync(dest).isSymbolicLink()) {
    console.error(`miru: refusing to write through a symlink at ${dest}`);
    process.exit(1);
  }
  writeFileSync(dest, skillMd);
  console.error(`miru: installed skill -> ${dest}`);
  process.exit(0);
}

// ---------- headless: comment (reply / resolve) ----------
if (command === "comment") {
  const file = requireFile(positionals[1]);
  const review = await loadReview(file);
  const targetId = values["reply-to"] ?? values.resolve;
  if (!targetId) {
    console.error("miru: --reply-to <id> <body> or --resolve <id> is required");
    process.exit(1);
  }
  const comment = review.comments.find((c) => c.id === targetId);
  if (!comment) {
    console.error(`miru: comment not found: ${targetId}`);
    process.exit(1);
  }
  if (values["reply-to"]) {
    const body = positionals[2];
    if (!body) {
      console.error("miru: reply body required: miru comment <file> --reply-to <id> <body>");
      process.exit(1);
    }
    const reply: Reply = {
      id: shortId("r"),
      body,
      bodyHtml: renderCommentBody(body),
      createdAt: new Date().toISOString(),
      // `miru comment --reply-to` is how the agent loop posts back; the browser
      // never goes through this path, so the author is always the agent here.
      author: "agent",
      // Agent replies are never staged — they are always immediate.
      draft: false,
    };
    comment.replies.push(reply);
    // The agent has responded → mark answered so `miru next` won't hand it back.
    comment.status = "answered";
  }
  if (values.resolve) comment.resolved = true;
  await saveReview(file, review);
  console.log(`updated ${comment.id}`);
  process.exit(0);
}

// ---------- headless: next (block until comments await the agent, or it's approved) ----------
if (command === "next") {
  const file = requireFile(positionals[1]);
  const snapshot = async () => {
    const r = await loadReview(file);
    // Strip staged ("Add to review") replies — the human is still composing them and
    // /api/review/submit hasn't promoted them yet, so the agent shouldn't react.
    return {
      approved: r.approved,
      comments: r.comments
        .filter(awaitingAgent)
        .map((c) => ({ ...c, replies: c.replies.filter((reply) => !reply.draft) })),
    };
  };
  let s = await snapshot();
  if (!s.approved && s.comments.length === 0) {
    // Watch the directory (not the sidecar itself: saveReview's atomic rename swaps the
    // inode) and re-check until something awaits the agent or the human approves.
    s = await new Promise<typeof s>((resolve) => {
      const stop = watchFile(dirname(file), async () => {
        const next = await snapshot();
        if (next.approved || next.comments.length > 0) {
          stop();
          resolve(next);
        }
      });
    });
  }
  // Stamp picked-up comments so the panel can show "agent is reviewing". Reuse the
  // full review (not the filtered snapshot) so unrelated comments stay intact.
  // Each `miru next` refreshes the timestamp; the value is descriptive, not strictly
  // semantic — a stale stamp on a crashed agent looks like "still reviewing", which
  // the human can interpret with a relative-time hint in the UI.
  if (s.comments.length > 0) {
    const ids = new Set(s.comments.map((c) => c.id));
    const now = new Date().toISOString();
    const review = await loadReview(file);
    let touched = false;
    for (const c of review.comments) {
      if (ids.has(c.id)) {
        c.pickedUpAt = now;
        touched = true;
      }
    }
    if (touched) await saveReview(file, review);
  }
  console.log(JSON.stringify(s, null, 2));
  process.exit(0);
}

// ---------- interactive: review (blocking, one round) ----------
if (command !== "review") {
  console.error(USAGE);
  process.exit(1);
}
const file = requireFile(positionals[1]);

const token = randomBytes(24).toString("hex");
const nonce = randomBytes(16).toString("base64");

// Render the current file contents into injected HTML. Called again on each file change.
const renderHtml = (): string => {
  const content = readFileSync(file, "utf8");
  const kind = detectKind(file);
  const rendered = renderDocument(content, kind, { unsafeRaw: values["unsafe-raw"] });
  return injectUI(wrapIfFragment(rendered, kind, basename(file), values.lang), { token, nonce });
};

const { server, finished, setHtml, notifyReload, notifyComments } = createServer({
  port: Number(values.port),
  initialHtml: renderHtml(),
  target: file,
  token,
  nonce,
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
const unresolved: Comment[] = review.comments.filter(openForAgent);
// Emit the verdict + unresolved comments as JSON on stdout → the AI agent reads/replies/fixes.
console.log(JSON.stringify({ approved: review.approved, comments: unresolved }, null, 2));

server.stop();
process.exit(0);
