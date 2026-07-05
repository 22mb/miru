import { timingSafeEqual } from "node:crypto";
import { renderCommentBody } from "./render.ts";
import {
  CorruptedSidecarError,
  FutureSidecarError,
  loadReview,
  updateReview,
  type Comment,
  type Reply,
  type ReviewFile,
} from "./store.ts";
import {
  addReply,
  approve,
  buildComment,
  CreateCommentBody,
  dismissApproval,
  PatchCommentBody,
  promoteDrafts,
  type HydratedComment,
  type HydratedReply,
  type HydratedReviewFile,
} from "@miru/contract";
import { shortId } from "./id.ts";

// Attach a fresh sanitized bodyHtml to the persisted shape before it leaves the
// server. Not persisted so a hostile committed sidecar can't smuggle markup in — the
// browser only ever sees renderCommentBody's output.
function hydrateReply(r: Reply): HydratedReply {
  return { ...r, bodyHtml: renderCommentBody(r.body) };
}
function hydrateComment(c: Comment): HydratedComment {
  return { ...c, bodyHtml: renderCommentBody(c.body), replies: c.replies.map(hydrateReply) };
}
function hydrateReview(r: ReviewFile): HydratedReviewFile {
  return { ...r, comments: r.comments.map(hydrateComment) };
}

export interface ServeOptions {
  initialHtml: string;
  target: string;
  token: string;
  nonce: string;
  port: number;
  // Pre-bundled frontend assets served at /__miru__/miru.js and /__miru__/miru.css.
  // The CLI text-imports the built files and hands them in — server code stays free of
  // any dependency on the frontend build graph so `bun test packages/server` runs
  // without needing the frontend to be built first.
  assets: { js: string; css: string };
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

// Parse the hostname out of a Host/Origin value, correctly handling the
// "[::1]:port" bracketed form that a naive split(":") would mangle.
function hostnameOf(value: string): string | null {
  try {
    return new URL(`http://${value}`).hostname;
  } catch {
    return null;
  }
}

// Reject requests whose Host/Origin is not localhost (CSRF / DNS-rebinding guard).
export function isLocalRequest(req: Request): boolean {
  const host = hostnameOf(req.headers.get("host") ?? "");
  if (host === null || !LOCAL_HOSTS.has(host)) return false;
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      if (!LOCAL_HOSTS.has(new URL(origin).hostname)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function csp(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    // NOTE: a nonce in style-src makes browsers ignore 'unsafe-inline', which would
    // block the inline `style` attributes used for positioning and in rendered docs.
    // Allow the stylesheet via 'self' and keep 'unsafe-inline' for those attributes.
    "style-src 'self' 'unsafe-inline'",
    // No remote origins: block external img fetches so an untrusted document can't
    // phone home (tracking pixel via <img> or CSS background:url()). Inline data: only.
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    // default-src 'none' does NOT fall through to frame-ancestors (CSP spec) — set
    // explicitly to block clickjacking on the Approve button via cross-origin iframe.
    "frame-ancestors 'none'",
  ].join("; ");
}

// Constant-time token comparison. The length check leaks the fact that we expect a
// 48-hex token, which is public info; the per-byte compare for equal-length inputs is
// what matters.
function tokensEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const enc = new TextEncoder();
  return timingSafeEqual(enc.encode(a), enc.encode(b));
}

export function createServer(opts: ServeOptions) {
  let currentHtml = opts.initialHtml;
  const { promise: finished, resolve: resolveFinish } = Promise.withResolvers<void>();

  // Nonce is fixed for the server's lifetime; build the header once.
  const cspHeader = csp(opts.nonce);

  const encoder = new TextEncoder();
  const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();

  function broadcast(event: string): void {
    const chunk = encoder.encode(`data: ${event}\n\n`);
    for (const client of sseClients) {
      try {
        client.enqueue(chunk);
      } catch {
        // Client is gone; it will be removed on stream cancel.
      }
    }
  }

  // ---------- individual route handlers ----------

  function servePage(): Response {
    return new Response(currentHtml, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": cspHeader,
        "x-content-type-options": "nosniff",
      },
    });
  }
  function serveJs(): Response {
    return new Response(opts.assets.js, {
      headers: { "content-type": "text/javascript; charset=utf-8" },
    });
  }
  function serveCss(): Response {
    return new Response(opts.assets.css, {
      headers: { "content-type": "text/css; charset=utf-8" },
    });
  }
  function serveEvents(): Response {
    let client: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        client = controller;
        sseClients.add(controller);
        controller.enqueue(encoder.encode(": connected\n\n"));
      },
      cancel() {
        sseClients.delete(client);
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  }

  async function handleApprove(): Promise<Response> {
    await updateReview(opts.target, (r) => ({ review: approve(r), result: undefined }));
    broadcast("comments");
    queueMicrotask(() => resolveFinish());
    return Response.json({ ok: true });
  }

  async function handleListComments(): Promise<Response> {
    // Reads: saveReview is atomic (write-then-rename), so loads need no lock.
    return Response.json(hydrateReview(await loadReview(opts.target)));
  }

  async function handleCreateComment(req: Request): Promise<Response> {
    const parsed = CreateCommentBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return Response.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    const input = parsed.data;
    const comment = await updateReview(opts.target, (loaded) => {
      const c = buildComment(
        {
          anchor: input.anchor,
          body: input.body,
          suggestion: input.suggestion ?? null,
          draft: input.draft,
        },
        shortId("c"),
        new Date().toISOString(),
      );
      const withComment = { ...loaded, comments: [...loaded.comments, c] };
      const review = input.draft ? withComment : dismissApproval(withComment);
      return { review, result: c };
    });
    broadcast("comments");
    return Response.json(hydrateComment(comment), { status: 201 });
  }

  async function handleSubmitReview(): Promise<Response> {
    // Promote all staged drafts to sent in one batch.
    const submitted = await updateReview(opts.target, (loaded) => {
      const { review: promoted, submitted } = promoteDrafts(loaded);
      return {
        review: submitted > 0 ? dismissApproval(promoted) : promoted,
        result: submitted,
      };
    });
    if (submitted > 0) broadcast("comments");
    return Response.json({ submitted });
  }

  async function handlePatchComment(req: Request, id: string): Promise<Response> {
    const parsed = PatchCommentBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return Response.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    const patch = parsed.data;
    const patched = await updateReview(opts.target, (loaded) => {
      const idx = loaded.comments.findIndex((c) => c.id === id);
      if (idx === -1) return { review: loaded, result: null };
      let comment = loaded.comments[idx]!;
      if (typeof patch.body === "string") comment = { ...comment, body: patch.body };
      if (typeof patch.resolved === "boolean") comment = { ...comment, resolved: patch.resolved };
      if (patch.suggestion !== undefined) comment = { ...comment, suggestion: patch.suggestion };
      // A non-draft human reply re-opens the round (addReply) *and* dismisses
      // approval at review scope. A staged (draft) reply changes nothing at either
      // scope until /api/review/submit promotes it.
      let approvalDismissed = false;
      if (typeof patch.reply === "string") {
        const draft = patch.replyDraft === true;
        comment = addReply(
          comment,
          // Browser-originated replies are always the human reviewer; the agent
          // replies through the CLI (`miru comment --reply-to`), never here.
          { id: shortId("r"), body: patch.reply, author: "human", draft },
          new Date().toISOString(),
        );
        if (!draft) approvalDismissed = true;
      }
      const withPatch: typeof loaded = {
        ...loaded,
        comments: loaded.comments.map((c, i) => (i === idx ? comment : c)),
      };
      const review = approvalDismissed ? dismissApproval(withPatch) : withPatch;
      return { review, result: comment };
    });
    if (patched === null) return Response.json({ error: "not found" }, { status: 404 });
    broadcast("comments");
    return Response.json(hydrateComment(patched));
  }

  async function handleDeleteComment(id: string): Promise<Response> {
    const deleted = await updateReview(opts.target, (loaded) => {
      const idx = loaded.comments.findIndex((c) => c.id === id);
      if (idx === -1) return { review: loaded, result: false };
      return {
        review: { ...loaded, comments: loaded.comments.filter((c) => c.id !== id) },
        result: true,
      };
    });
    if (!deleted) return Response.json({ error: "not found" }, { status: 404 });
    broadcast("comments");
    return Response.json({ ok: true });
  }

  // ---------- declarative route table ----------
  // Every route makes its auth requirement explicit — `public` skips the token gate,
  // `token` enforces it. Grep-visible exemptions (SSE, static assets, the panel HTML)
  // replace the previous "if you fall past the /api/ auth block, you're public" trick.
  // Match-order in the array is the tie-breaker only for overlapping patterns; the
  // current set has none.
  type RouteMatch = RegExpMatchArray | null;
  interface Route {
    method: string;
    pattern: string | RegExp;
    auth: "public" | "token";
    handler: (req: Request, match: RouteMatch) => Response | Promise<Response>;
  }
  const COMMENT_ID_PATH = /^\/api\/comments\/([\w-]+)$/;
  const routes: Route[] = [
    { method: "GET", pattern: "/", auth: "public", handler: () => servePage() },
    { method: "GET", pattern: "/__miru__/miru.js", auth: "public", handler: () => serveJs() },
    { method: "GET", pattern: "/__miru__/miru.css", auth: "public", handler: () => serveCss() },
    // SSE only pushes "reload"/"comments" hints (no data) — Host/Origin is still enforced.
    { method: "GET", pattern: "/api/events", auth: "public", handler: () => serveEvents() },
    { method: "POST", pattern: "/api/approve", auth: "token", handler: () => handleApprove() },
    { method: "GET", pattern: "/api/comments", auth: "token", handler: () => handleListComments() },
    {
      method: "POST",
      pattern: "/api/comments",
      auth: "token",
      handler: (req) => handleCreateComment(req),
    },
    {
      method: "POST",
      pattern: "/api/review/submit",
      auth: "token",
      handler: () => handleSubmitReview(),
    },
    {
      method: "PATCH",
      pattern: COMMENT_ID_PATH,
      auth: "token",
      handler: (req, m) => handlePatchComment(req, m![1]!),
    },
    {
      method: "DELETE",
      pattern: COMMENT_ID_PATH,
      auth: "token",
      handler: (_, m) => handleDeleteComment(m![1]!),
    },
  ];

  function matchRoute(req: Request, url: URL): { route: Route; match: RouteMatch } | null {
    for (const route of routes) {
      if (route.method !== req.method) continue;
      if (typeof route.pattern === "string") {
        if (route.pattern === url.pathname) return { route, match: null };
      } else {
        const m = url.pathname.match(route.pattern);
        if (m) return { route, match: m };
      }
    }
    return null;
  }

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: opts.port,
    // Disable the 10s default idle timeout: the SSE stream (/api/events) is long-lived
    // and mostly silent, so the default would drop it every 10s and lose live updates
    // that fire in the reconnect gap.
    idleTimeout: 0,
    // 1 MiB is ~15x the largest legitimate POST (a single comment with full-cap
    // body + suggestion + anchor) and an order of magnitude below Bun's default,
    // which would otherwise let a single ~128 MB POST stall the event loop in
    // sanitize-html and bloat the sidecar.
    maxRequestBodySize: 1_048_576,
    async fetch(req) {
      const url = new URL(req.url);
      if (!isLocalRequest(req)) return new Response("forbidden", { status: 403 });
      const matched = matchRoute(req, url);
      if (!matched) return new Response("not found", { status: 404 });
      const { route, match } = matched;
      if (route.auth === "token" && !tokensEqual(req.headers.get("x-miru-token") ?? "", opts.token))
        return new Response("unauthorized", { status: 401 });
      try {
        return await route.handler(req, match);
      } catch (err) {
        // Sidecar data-state problems (corruption / newer schema) aren't server bugs:
        // surface them as 422 with a distinguishable error field so the user fixes the
        // file — or upgrades miru — instead of seeing a bare 500. Anything else still
        // propagates to Bun's default 500.
        if (err instanceof CorruptedSidecarError) {
          return Response.json(
            { error: "corrupted sidecar", path: err.path, detail: err.detail },
            { status: 422 },
          );
        }
        if (err instanceof FutureSidecarError) {
          return Response.json(
            { error: "future sidecar", path: err.path, fileVersion: err.fileVersion },
            { status: 422 },
          );
        }
        throw err;
      }
    },
  });

  return {
    server,
    finished,
    /** Replace the served document HTML (used on file change). */
    setHtml(html: string) {
      currentHtml = html;
    },
    /** Tell connected browsers to reload (used on file change). */
    notifyReload() {
      broadcast("reload");
    },
    /** Tell connected browsers to refetch comments (used when the sidecar JSON is
     *  modified out-of-band — e.g. `miru comment` writes directly to disk). */
    notifyComments() {
      broadcast("comments");
    },
  };
}
