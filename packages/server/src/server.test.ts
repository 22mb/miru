import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, isLocalRequest, type ServeOptions } from "./server.ts";

function makeReq(headers: Record<string, string>): Request {
  return new Request("http://127.0.0.1/", { headers });
}

describe("isLocalRequest", () => {
  test.each([
    ["127.0.0.1", true],
    ["127.0.0.1:8080", true],
    ["localhost", true],
    ["localhost:3000", true],
    ["[::1]", true],
    ["[::1]:8080", true],
  ] as const)("Host %s → allowed", (host, expected) => {
    expect(isLocalRequest(makeReq({ host }))).toBe(expected);
  });

  test.each([
    ["example.com", false],
    ["127.0.0.1.evil.com", false],
    ["evil.com:127.0.0.1", false],
    ["", false],
    ["::1", false], // unbracketed IPv6 — URL parser cannot resolve hostname unambiguously
  ] as const)("Host %s → rejected", (host, expected) => {
    expect(isLocalRequest(makeReq({ host }))).toBe(expected);
  });

  test("Origin from non-local origin is rejected even when Host is local", () => {
    expect(isLocalRequest(makeReq({ host: "127.0.0.1:8080", origin: "https://evil.com" }))).toBe(
      false,
    );
  });

  test("Origin from local origin is allowed", () => {
    expect(
      isLocalRequest(makeReq({ host: "127.0.0.1:8080", origin: "http://localhost:8080" })),
    ).toBe(true);
  });

  test("malformed Origin is rejected", () => {
    expect(isLocalRequest(makeReq({ host: "127.0.0.1:8080", origin: "::::" }))).toBe(false);
  });
});

describe("createServer — auth & routing", () => {
  let dir: string;
  let target: string;
  let opts: ServeOptions;
  let s: ReturnType<typeof createServer>;
  let base: string;
  const TOKEN = "sekrit";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "miru-server-"));
    target = join(dir, "doc.md");
    opts = {
      initialHtml: "<!doctype html><html><body>doc</body></html>",
      initialDoc: "<p>doc</p>",
      target,
      token: TOKEN,
      nonce: "n0nce",
      port: 0, // OS picks an ephemeral port
      // Asset contents are irrelevant here; the /__miru__/miru.js/.css routes exist
      // but no test asserts on their bodies.
      assets: { js: "", css: "" },
    };
    s = createServer(opts);
    const url = s.server.url;
    if (!url) throw new Error("server did not bind");
    base = url.toString().replace(/\/$/, "");
  });

  afterEach(async () => {
    s.server.stop(true);
    await rm(dir, { recursive: true, force: true });
  });

  // Bun.serve auto-sets a correct Host header for fetch() to "127.0.0.1:<port>", so
  // isLocalRequest is exercised end-to-end and we only inject the token explicitly.
  const auth = { "x-miru-token": TOKEN };

  test("non-local Host header is 403", async () => {
    const res = await fetch(`${base}/`, { headers: { host: "evil.example" } });
    expect(res.status).toBe(403);
  });

  test("GET / returns the served HTML with CSP and nosniff", async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("nonce-n0nce");
    // Clickjacking guard — default-src 'none' does not cover frame-ancestors.
    expect(csp).toContain("frame-ancestors 'none'");
    // Media parity with img: local/data only, so sanitized <video>/<audio> can play.
    expect(csp).toContain("media-src 'self' data:");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("/api/* without token → 401", async () => {
    const res = await fetch(`${base}/api/comments`);
    expect(res.status).toBe(401);
  });

  test("/api/* with wrong token → 401", async () => {
    const res = await fetch(`${base}/api/comments`, { headers: { "x-miru-token": "wrong" } });
    expect(res.status).toBe(401);
  });

  test("/api/* with correct token → 200", async () => {
    const res = await fetch(`${base}/api/comments`, { headers: auth });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ version: 1, target, approved: false, comments: [] });
  });

  test("GET /api/doc serves the current body, and setHtml replaces it", async () => {
    const first = await fetch(`${base}/api/doc`, { headers: auth });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ html: "<p>doc</p>" });
    s.setHtml("<!doctype html><html><body>next</body></html>", "<p>next</p>");
    const second = await fetch(`${base}/api/doc`, { headers: auth });
    expect(await second.json()).toEqual({ html: "<p>next</p>" });
  });

  test("GET /api/doc is 404 once the page has no swappable body", async () => {
    s.setHtml("<!doctype html><html><body>raw</body></html>", null);
    const res = await fetch(`${base}/api/doc`, { headers: auth });
    expect(res.status).toBe(404);
  });

  test("notifyDocChange pushes `doc`, or `reload` when there is nothing to swap", async () => {
    const res = await fetch(`${base}/api/events`);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const nextChunk = async () => decoder.decode((await reader.read()).value);
    expect(await nextChunk()).toContain(": connected");
    s.notifyDocChange();
    expect(await nextChunk()).toContain("data: doc");
    s.setHtml("<!doctype html><html><body>raw</body></html>", null);
    s.notifyDocChange();
    expect(await nextChunk()).toContain("data: reload");
    await reader.cancel();
  });

  test("unknown path → 404", async () => {
    const res = await fetch(`${base}/missing`);
    expect(res.status).toBe(404);
  });

  test("malformed POST body → 400 with zod issues", async () => {
    const res = await fetch(`${base}/api/comments`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid body");
  });

  test("POST /api/approve sets approved=true and resolves finished", async () => {
    const res = await fetch(`${base}/api/approve`, { method: "POST", headers: auth });
    expect(res.status).toBe(200);
    await s.finished; // resolves on the microtask after the response

    const get = await fetch(`${base}/api/comments`, { headers: auth });
    const review = (await get.json()) as { approved: boolean };
    expect(review.approved).toBe(true);
  });

  test("PATCH reply on an existing comment dismisses approval (regression: was missing)", async () => {
    const create = await fetch(`${base}/api/comments`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        anchor: { type: "text", quote: "q", prefix: "p", suffix: "s", start: 0, end: 1 },
        body: "first",
      }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as { id: string };

    await fetch(`${base}/api/approve`, { method: "POST", headers: auth });

    const patch = await fetch(`${base}/api/comments/${created.id}`, {
      method: "PATCH",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ reply: "more feedback" }),
    });
    expect(patch.status).toBe(200);

    const get = await fetch(`${base}/api/comments`, { headers: auth });
    const review = (await get.json()) as { approved: boolean; comments: { status: string }[] };
    expect(review.approved).toBe(false);
    expect(review.comments[0]?.status).toBe("sent");
  });

  test("PATCH/DELETE unknown id → 404", async () => {
    const patch = await fetch(`${base}/api/comments/c_nope`, {
      method: "PATCH",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ resolved: true }),
    });
    expect(patch.status).toBe(404);

    const del = await fetch(`${base}/api/comments/c_nope`, { method: "DELETE", headers: auth });
    expect(del.status).toBe(404);
  });

  test("corrupted sidecar → 422 with path + detail (no bare 500)", async () => {
    await writeFile(`${target}.miru.json`, "{not json");
    const res = await fetch(`${base}/api/comments`, { headers: auth });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; path: string; detail: string };
    expect(body.error).toBe("corrupted sidecar");
    expect(body.path).toBe(`${target}.miru.json`);
    expect(body.detail).toContain("invalid JSON");
  });

  test("sidecar written by a newer miru → 422 with 'future sidecar' error field", async () => {
    await writeFile(
      `${target}.miru.json`,
      JSON.stringify({ version: 999, target, approved: false, comments: [] }),
    );
    const res = await fetch(`${base}/api/comments`, { headers: auth });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; path: string; fileVersion: number };
    expect(body.error).toBe("future sidecar");
    expect(body.path).toBe(`${target}.miru.json`);
    expect(body.fileVersion).toBe(999);
  });

  test("wire responses hydrate bodyHtml on comments and replies (F-1)", async () => {
    const create = await fetch(`${base}/api/comments`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        anchor: { type: "text", quote: "q", prefix: "p", suffix: "s", start: 0, end: 1 },
        body: "hello",
      }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as { id: string; bodyHtml: string };
    // POST response is hydrated — the browser reads bodyHtml directly.
    expect(created.bodyHtml).toContain("hello");

    const patch = await fetch(`${base}/api/comments/${created.id}`, {
      method: "PATCH",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ reply: "**bold reply**" }),
    });
    expect(patch.status).toBe(200);
    const patched = (await patch.json()) as {
      bodyHtml: string;
      replies: { bodyHtml: string }[];
    };
    // PATCH response is hydrated (comment + every reply).
    expect(patched.bodyHtml).toContain("hello");
    expect(patched.replies[0]?.bodyHtml).toContain("<strong>bold reply</strong>");

    const get = await fetch(`${base}/api/comments`, { headers: auth });
    const list = (await get.json()) as {
      comments: { bodyHtml: string; replies: { bodyHtml: string }[] }[];
    };
    // GET review is hydrated end-to-end.
    expect(list.comments[0]?.bodyHtml).toContain("hello");
    expect(list.comments[0]?.replies[0]?.bodyHtml).toContain("<strong>bold reply</strong>");
  });

  test("persisted sidecar carries no bodyHtml (F-1: single source of truth is `body`)", async () => {
    await fetch(`${base}/api/comments`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        anchor: { type: "text", quote: "q", prefix: "p", suffix: "s", start: 0, end: 1 },
        body: "hi",
      }),
    });
    const raw = JSON.parse(await Bun.file(`${target}.miru.json`).text()) as {
      comments: { bodyHtml?: string }[];
    };
    expect(raw.comments[0]?.bodyHtml).toBeUndefined();
  });
});
