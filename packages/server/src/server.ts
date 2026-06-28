import miruJs from "./assets/miru.js" with { type: "text" };
import miruCss from "./assets/miru.css" with { type: "text" };
import { timingSafeEqual } from "node:crypto";
import { renderCommentBody } from "./render.ts";
import {
  CorruptedSidecarError,
  loadReview,
  saveReview,
  type Comment,
  type Reply,
} from "./store.ts";
import { CreateCommentBody, PatchCommentBody } from "@miru/contract";
import { shortId } from "./id.ts";

export interface ServeOptions {
  initialHtml: string;
  target: string;
  token: string;
  nonce: string;
  port: number;
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

  // Serialize load-modify-save so two concurrent writes can't clobber each other.
  let writeLock: Promise<unknown> = Promise.resolve();
  function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = writeLock.then(fn, fn);
    writeLock = run.catch(() => {});
    return run;
  }

  async function handleApi(req: Request, url: URL): Promise<Response> {
    // "Approve": record the human verdict and unblock the CLI (resolve after the response).
    if (req.method === "POST" && url.pathname === "/api/approve") {
      return withWriteLock(async () => {
        const review = await loadReview(opts.target);
        review.approved = true;
        await saveReview(opts.target, review);
        broadcast("comments");
        queueMicrotask(() => resolveFinish());
        return Response.json({ ok: true });
      });
    }

    // Reads: saveReview is atomic (write-then-rename), so loads need no lock.
    if (req.method === "GET" && url.pathname === "/api/comments") {
      return Response.json(await loadReview(opts.target));
    }

    if (req.method === "POST" && url.pathname === "/api/comments") {
      const parsed = CreateCommentBody.safeParse(await req.json().catch(() => null));
      if (!parsed.success)
        return Response.json(
          { error: "invalid body", issues: parsed.error.issues },
          { status: 400 },
        );
      const input = parsed.data;
      return withWriteLock(async () => {
        const review = await loadReview(opts.target);
        const comment: Comment = {
          id: shortId("c"),
          anchor: input.anchor,
          body: input.body,
          bodyHtml: renderCommentBody(input.body),
          suggestion: input.suggestion ?? null,
          status: input.draft ? "draft" : "sent",
          resolved: false,
          createdAt: new Date().toISOString(),
          pickedUpAt: null,
          replies: [],
        };
        review.comments.push(comment);
        if (!input.draft) review.approved = false; // new feedback dismisses approval
        await saveReview(opts.target, review);
        broadcast("comments");
        return Response.json(comment, { status: 201 });
      });
    }

    // "Submit review": promote all staged drafts to sent in one batch.
    if (req.method === "POST" && url.pathname === "/api/review/submit") {
      return withWriteLock(async () => {
        const review = await loadReview(opts.target);
        let submitted = 0;
        for (const c of review.comments) {
          let promoted = c.status === "draft";
          for (const r of c.replies) {
            if (r.draft) {
              r.draft = false;
              promoted = true;
            }
          }
          if (promoted) {
            // Both freshly-submitted drafts and follow-up replies re-notify the
            // agent: status flips to "sent" and the picked-up stamp clears so the
            // new round looks fresh.
            c.status = "sent";
            c.pickedUpAt = null;
            submitted++;
          }
        }
        if (submitted > 0) {
          review.approved = false; // new feedback dismisses approval
          await saveReview(opts.target, review);
          broadcast("comments");
        }
        return Response.json({ submitted });
      });
    }

    const m = url.pathname.match(/^\/api\/comments\/([\w-]+)$/);
    if (m) {
      const id = m[1];

      if (req.method === "PATCH") {
        const parsed = PatchCommentBody.safeParse(await req.json().catch(() => null));
        if (!parsed.success)
          return Response.json(
            { error: "invalid body", issues: parsed.error.issues },
            { status: 400 },
          );
        const patch = parsed.data;
        return withWriteLock(async () => {
          const review = await loadReview(opts.target);
          const comment = review.comments.find((c) => c.id === id);
          if (!comment) return Response.json({ error: "not found" }, { status: 404 });
          if (typeof patch.body === "string") {
            comment.body = patch.body;
            comment.bodyHtml = renderCommentBody(patch.body);
          }
          if (typeof patch.resolved === "boolean") comment.resolved = patch.resolved;
          if (patch.suggestion !== undefined) comment.suggestion = patch.suggestion;
          if (typeof patch.reply === "string") {
            const draft = patch.replyDraft === true;
            const reply: Reply = {
              id: shortId("r"),
              body: patch.reply,
              bodyHtml: renderCommentBody(patch.reply),
              createdAt: new Date().toISOString(),
              // Browser-originated replies are always the human reviewer; the agent
              // replies through the CLI (`miru comment --reply-to`), never here.
              author: "human",
              draft,
            };
            comment.replies.push(reply);
            // Only a *sent* reply re-notifies the agent. A staged ("Add to review")
            // reply sits in the comment until /api/review/submit promotes it; until
            // then the agent neither sees the reply nor has its status/pickedUpAt
            // changed.
            if (!draft) {
              comment.status = "sent";
              comment.pickedUpAt = null;
              review.approved = false;
            }
          }
          await saveReview(opts.target, review);
          broadcast("comments");
          return Response.json(comment);
        });
      }

      if (req.method === "DELETE") {
        return withWriteLock(async () => {
          const review = await loadReview(opts.target);
          const idx = review.comments.findIndex((c) => c.id === id);
          if (idx === -1) return Response.json({ error: "not found" }, { status: 404 });
          review.comments.splice(idx, 1);
          await saveReview(opts.target, review);
          broadcast("comments");
          return Response.json({ ok: true });
        });
      }
    }

    return Response.json({ error: "bad request" }, { status: 400 });
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

      if (url.pathname === "/") {
        return new Response(currentHtml, {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "content-security-policy": cspHeader,
            "x-content-type-options": "nosniff",
          },
        });
      }
      if (url.pathname === "/__miru__/miru.js") {
        return new Response(miruJs, {
          headers: { "content-type": "text/javascript; charset=utf-8" },
        });
      }
      if (url.pathname === "/__miru__/miru.css") {
        return new Response(miruCss, {
          headers: { "content-type": "text/css; charset=utf-8" },
        });
      }

      // Server-Sent Events for live updates. No token required (it only pushes
      // "reload"/"comments" hints, no data) but Host/Origin is still enforced above.
      if (url.pathname === "/api/events") {
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

      if (url.pathname.startsWith("/api/")) {
        if (!tokensEqual(req.headers.get("x-miru-token") ?? "", opts.token)) {
          return new Response("unauthorized", { status: 401 });
        }
        try {
          return await handleApi(req, url);
        } catch (err) {
          // A corrupted sidecar is a data-state problem, not a server bug: surface a
          // 422 with the path so the user fixes the file by hand instead of seeing a
          // bare 500. Anything else still propagates to Bun's default 500.
          if (err instanceof CorruptedSidecarError) {
            return Response.json(
              { error: "corrupted sidecar", path: err.path, detail: err.detail },
              { status: 422 },
            );
          }
          throw err;
        }
      }

      return new Response("not found", { status: 404 });
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
