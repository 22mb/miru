// Server API client. All calls carry the per-launch token; CSP allows connect-src
// 'self' only, so every request stays same-origin and local.
import type { Comment, CreateCommentBody, PatchCommentBody, ReviewFile } from "@miru/contract";

// Injected into <head> by the server (src/inject.ts); validated on every /api/* call.
// Read per-request rather than at module-load time so tests can mount a meta tag in
// the DOM before exercising the client without caring about import order.
function token(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="miru-token"]')?.content ?? "";
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { "content-type": "application/json", "x-miru-token": token() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

// Typed endpoint wrappers — keep all request shapes in one place so call sites can't
// drift from the contract package.
export const api = {
  listComments: () => request<ReviewFile>("GET", "/api/comments"),
  createComment: (body: CreateCommentBody) => request<Comment>("POST", "/api/comments", body),
  patchComment: (id: string, body: PatchCommentBody) =>
    request<Comment>("PATCH", `/api/comments/${id}`, body),
  deleteComment: (id: string) => request<unknown>("DELETE", `/api/comments/${id}`),
  submitReview: () => request<unknown>("POST", "/api/review/submit", {}),
  approve: () => request<unknown>("POST", "/api/approve", {}),
};
