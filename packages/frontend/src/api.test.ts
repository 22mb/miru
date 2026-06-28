// API client coverage: that each helper sends the right method/path/JSON body and the
// per-launch x-miru-token header. fetch is replaced with a recorder; the token meta
// tag is injected in beforeEach (api.ts reads it per-request, so import order doesn't matter).
import "./register-dom.ts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { CreateCommentBody } from "@miru/contract";
import { api } from "./api.ts";

const TOKEN = "test-token-xyz";

type Call = { url: string; method: string; headers: Record<string, string>; body: string | null };
const calls: Call[] = [];
let nextResponse: () => Response = () =>
  new Response("null", { status: 200, headers: { "content-type": "application/json" } });

const origFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = (async (input: Request | string | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? init.body : null,
    });
    return nextResponse();
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = origFetch;
});

beforeEach(() => {
  document.head.innerHTML = `<meta name="miru-token" content="${TOKEN}">`;
});

afterEach(() => {
  calls.length = 0;
  document.head.innerHTML = "";
  nextResponse = () =>
    new Response("null", { status: 200, headers: { "content-type": "application/json" } });
});

function last(): Call {
  return calls[calls.length - 1]!;
}

describe("api", () => {
  test("every call carries the x-miru-token header and JSON content-type when posting", async () => {
    await api.listComments();
    expect(last().headers["x-miru-token"]).toBe(TOKEN);

    await api.createComment({} as CreateCommentBody);
    expect(last().headers["x-miru-token"]).toBe(TOKEN);
    expect(last().headers["content-type"]).toBe("application/json");
  });

  test("listComments: GET /api/comments, no body", async () => {
    nextResponse = () =>
      new Response(JSON.stringify({ version: 1, target: "x", approved: false, comments: [] }), {
        headers: { "content-type": "application/json" },
      });
    const review = await api.listComments();
    expect(last().method).toBe("GET");
    expect(last().url).toBe("/api/comments");
    expect(last().body).toBeNull();
    expect(review.comments).toEqual([]);
  });

  test("createComment: POST /api/comments with JSON-encoded body", async () => {
    const body: CreateCommentBody = {
      anchor: { type: "text", quote: "q", prefix: "", suffix: "", start: 0, end: 1 },
      body: "hi",
      suggestion: null,
      draft: false,
    };
    await api.createComment(body);
    expect(last().method).toBe("POST");
    expect(last().url).toBe("/api/comments");
    expect(JSON.parse(last().body!)).toEqual(body);
  });

  test("patchComment: PATCH /api/comments/:id with partial body", async () => {
    await api.patchComment("c1", { resolved: true });
    expect(last().method).toBe("PATCH");
    expect(last().url).toBe("/api/comments/c1");
    expect(JSON.parse(last().body!)).toEqual({ resolved: true });
  });

  test("deleteComment: DELETE /api/comments/:id, no body", async () => {
    await api.deleteComment("c1");
    expect(last().method).toBe("DELETE");
    expect(last().url).toBe("/api/comments/c1");
    expect(last().body).toBeNull();
  });

  test("submitReview / approve: POST with empty body", async () => {
    await api.submitReview();
    expect(last().method).toBe("POST");
    expect(last().url).toBe("/api/review/submit");
    expect(JSON.parse(last().body!)).toEqual({});

    await api.approve();
    expect(last().url).toBe("/api/approve");
  });

  test("non-2xx response throws with method, path and status", async () => {
    nextResponse = () => new Response("nope", { status: 500 });
    let err: unknown;
    try {
      await api.listComments();
    } catch (e) {
      err = e;
    }
    expect((err as Error).message).toBe("GET /api/comments -> 500");
  });
});
