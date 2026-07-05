// Integration seam: App wires useComments + useLiveReload + guard/toast + the panel
// markup together. One happy-path flow (render → comment visible → resolve → refetch
// reflects it) keeps that composition honest without re-testing each hook. Rendered
// under StrictMode so double-mount hazards (popovers, one-shot effects) fail here
// instead of only in a dev browser.
import "./register-dom.ts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { StrictMode, Suspense } from "react";
import { act, cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { HydratedReviewFile } from "@miru/contract";
import { App } from "./App.tsx";
import { makeComment, makeReview } from "./fixtures.ts";

class FakeEventSource {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close() {}
}

const RealFetch = globalThis.fetch;
const RealEventSource = globalThis.EventSource;

// What GET /api/comments returns next — tests reassign it to simulate server state
// advancing between the initial load and a post-mutation refetch.
let listResponse: HydratedReviewFile;
let requests: Array<{ method: string; path: string }> = [];

beforeEach(() => {
  requests = [];
  (globalThis as { EventSource: unknown }).EventSource = FakeEventSource;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path =
      typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
    const method = init?.method ?? "GET";
    requests.push({ method, path });
    if (method === "PATCH") return Response.json(listResponse.comments[0]);
    return Response.json(listResponse);
  }) as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = RealFetch;
  (globalThis as { EventSource: unknown }).EventSource = RealEventSource;
  document.body.innerHTML = "";
});

async function renderApp(review: HydratedReviewFile) {
  listResponse = review;
  let resolve!: (v: HydratedReviewFile) => void;
  const promise = new Promise<HydratedReviewFile>((r) => {
    resolve = r;
  });
  const tree = (
    <StrictMode>
      <Suspense fallback={null}>
        <App initialCommentsPromise={promise} changedRange={null} />
      </Suspense>
    </StrictMode>
  );
  const view = render(tree);
  // Two-step Suspense resume for bun + happy-dom: resolve inside act, then kick a
  // rerender — the retry never self-schedules in this environment (neither waitFor
  // polling nor an empty act picks it up).
  await act(async () => {
    resolve(review);
    await promise;
  });
  view.rerender(tree);
  return view;
}

describe("App", () => {
  test("renders fetched comments; resolving one hides it behind the resolved toggle", async () => {
    const user = userEvent.setup();
    const c = makeComment({ id: "c1", bodyHtml: "<p>first note</p>" });
    const view = await renderApp(makeReview([c]));
    view.getByText("first note");

    // The refetch that follows the PATCH sees the comment resolved on the server.
    listResponse = makeReview([{ ...c, resolved: true }]);
    await user.click(view.getByRole("button", { name: "resolve" }));
    // Drain the PATCH → refetch → setComments chain.
    await act(async () => {});

    // Resolved comments are hidden by default; the header toggle now advertises one.
    expect(view.queryByText("first note")).toBeNull();
    expect(view.getByRole("button", { name: "Show 1 resolved comment" })).toBeDefined();
    expect(requests.some((r) => r.method === "PATCH" && r.path === "/api/comments/c1")).toBe(true);
  });
});
