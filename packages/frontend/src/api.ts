// Server API client. All calls carry the per-launch token; CSP allows connect-src
// 'self' only, so every request stays same-origin and local.
//
// The wire types on GET/POST/PATCH are Hydrated* — the server attaches a sanitized
// `bodyHtml` render of `body` at response time. The persisted shape (Comment, Reply,
// ReviewFile) has no bodyHtml.
import type {
  CreateCommentBody,
  HydratedComment,
  HydratedReviewFile,
  PatchCommentBody,
} from "@miru/contract";

// Injected into <head> by the server (src/inject.ts); validated on every /api/* call.
// Read per-request rather than at module-load time so tests can mount a meta tag in
// the DOM before exercising the client without caring about import order.
function token(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="miru-token"]')?.content ?? "";
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = {
    method,
    headers: { "content-type": "application/json", "x-miru-token": token() },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(path, init);
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

// Typed endpoint wrappers — keep all request shapes in one place so call sites can't
// drift from the contract package.
export const api = {
  listComments: () => request<HydratedReviewFile>("GET", "/api/comments"),
  createComment: (body: CreateCommentBody) =>
    request<HydratedComment>("POST", "/api/comments", body),
  patchComment: (id: string, body: PatchCommentBody) =>
    request<HydratedComment>("PATCH", `/api/comments/${id}`, body),
  deleteComment: (id: string) => request<unknown>("DELETE", `/api/comments/${id}`),
  submitReview: () => request<unknown>("POST", "/api/review/submit", {}),
  approve: () => request<unknown>("POST", "/api/approve", {}),
};
