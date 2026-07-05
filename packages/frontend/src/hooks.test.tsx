// Hook coverage: the DOM-driven hooks (useDocumentEvent, useKeyboardShortcuts,
// useAltHoverPreview, usePanelResize, inPanel) plus the stateful seams — useComments'
// fresh-reply diff (fetch stubbed) and useLiveReload's defer/flush transitions
// (EventSource stubbed). Timer-expiry behavior (FRESH_REPLY_MS fade, the disconnect
// banner debounce window) is left to the browser — only expiry-independent transitions
// are pinned here. useDraftCapture depends on real Range selection geometry and stays
// a browser concern; App.test.tsx covers the integration seam.
import "./register-dom.ts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type ReactNode, Suspense } from "react";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { consumePreReloadText } from "./dom.ts";
import { makeComment, makeReply, makeReview } from "./fixtures.ts";
import {
  inPanel,
  useAltHoverPreview,
  useComments,
  useDocumentEvent,
  useKeyboardShortcuts,
  useLiveReload,
  usePanelResize,
} from "./hooks.ts";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("useDocumentEvent", () => {
  test("subscribes on mount, removes on unmount", () => {
    let count = 0;
    const { unmount } = renderHook(() =>
      useDocumentEvent("keydown", () => {
        count++;
      }),
    );
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
    expect(count).toBe(1);
    unmount();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
    expect(count).toBe(1);
  });
});

describe("inPanel", () => {
  test("true for nodes inside #miru-root, false otherwise", () => {
    document.body.innerHTML =
      '<div id="miru-root"><button class="b">x</button></div><p class="p">y</p>';
    expect(inPanel(document.querySelector(".b"))).toBe(true);
    expect(inPanel(document.querySelector(".p"))).toBe(false);
    expect(inPanel(null)).toBe(false);
  });
});

describe("useAltHoverPreview", () => {
  function move(target: Element, altKey: boolean) {
    target.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, altKey }));
  }

  test("Alt+hover outlines the closest content-bearing ancestor", () => {
    document.body.innerHTML = '<p class="p">hello <span class="s">world</span></p>';
    const p = document.querySelector(".p")!;
    const span = document.querySelector(".s")!;
    renderHook(() => useAltHoverPreview());

    move(span, true);
    expect(p.classList.contains("miru-el-preview")).toBe(true);
    expect(span.classList.contains("miru-el-preview")).toBe(false);
  });

  test("hovering without Alt adds no outline", () => {
    document.body.innerHTML = '<p class="p">x</p>';
    const p = document.querySelector(".p")!;
    renderHook(() => useAltHoverPreview());

    move(p, false);
    expect(p.classList.contains("miru-el-preview")).toBe(false);
  });

  test("moving to a new target clears the previous outline", () => {
    document.body.innerHTML = '<p class="a">a</p><p class="b">b</p>';
    const a = document.querySelector(".a")!;
    const b = document.querySelector(".b")!;
    renderHook(() => useAltHoverPreview());

    move(a, true);
    expect(a.classList.contains("miru-el-preview")).toBe(true);
    move(b, true);
    expect(a.classList.contains("miru-el-preview")).toBe(false);
    expect(b.classList.contains("miru-el-preview")).toBe(true);
  });

  test("releasing Alt clears the outline", () => {
    document.body.innerHTML = '<p class="p">x</p>';
    const p = document.querySelector(".p")!;
    renderHook(() => useAltHoverPreview());

    move(p, true);
    expect(p.classList.contains("miru-el-preview")).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt" }));
    expect(p.classList.contains("miru-el-preview")).toBe(false);
  });

  test("targets inside the miru panel are ignored", () => {
    document.body.innerHTML = '<div id="miru-root"><p class="p">x</p></div>';
    const p = document.querySelector(".p")!;
    renderHook(() => useAltHoverPreview());

    move(p, true);
    expect(p.classList.contains("miru-el-preview")).toBe(false);
  });

  test("unmount removes the outline and listeners", () => {
    document.body.innerHTML = '<p class="p">x</p>';
    const p = document.querySelector(".p")!;
    const { unmount } = renderHook(() => useAltHoverPreview());

    move(p, true);
    expect(p.classList.contains("miru-el-preview")).toBe(true);
    unmount();
    expect(p.classList.contains("miru-el-preview")).toBe(false);
    move(p, true);
    expect(p.classList.contains("miru-el-preview")).toBe(false);
  });
});

describe("useKeyboardShortcuts", () => {
  type Props = Parameters<typeof useKeyboardShortcuts>[0];

  function setup(activeId: string | null) {
    const focused: string[] = [];
    const resolved: number[] = [];
    const cancelled: number[] = [];
    const comments = [makeComment({ id: "a" }), makeComment({ id: "b" }), makeComment({ id: "c" })];
    const props: Props = {
      comments,
      activeId,
      focusComment: (id: string) => focused.push(id),
      onCancelDraft: () => cancelled.push(1),
      onResolveActive: () => resolved.push(1),
    };
    renderHook((p: Props) => useKeyboardShortcuts(p), { initialProps: props });
    return { focused, resolved, cancelled };
  }

  function press(key: string, target: EventTarget = document) {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  }

  test("j with no active selects the first comment", () => {
    const { focused } = setup(null);
    press("j");
    expect(focused).toEqual(["a"]);
  });

  test("j moves to the next comment", () => {
    const { focused } = setup("b");
    press("j");
    expect(focused).toEqual(["c"]);
  });

  test("j clamps at the last comment", () => {
    const { focused } = setup("c");
    press("j");
    expect(focused).toEqual(["c"]);
  });

  test("k moves to the previous comment", () => {
    const { focused } = setup("b");
    press("k");
    expect(focused).toEqual(["a"]);
  });

  test("k clamps at the first comment", () => {
    const { focused } = setup("a");
    press("k");
    expect(focused).toEqual(["a"]);
  });

  test("r calls onResolveActive only when something is active", () => {
    const a = setup(null);
    press("r");
    expect(a.resolved).toEqual([]);

    const b = setup("a");
    press("r");
    expect(b.resolved).toEqual([1]);
  });

  test("Escape always cancels the draft", () => {
    const { cancelled } = setup(null);
    press("Escape");
    expect(cancelled).toEqual([1]);
  });

  test("keys typed inside a textarea are ignored (so reply forms behave)", () => {
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    const { focused } = setup(null);
    press("j", ta);
    expect(focused).toEqual([]);
  });

  // The effect-event guarantee that justifies useDocumentEvent's design: the document
  // subscription attaches once, yet the handler must read the props of the LATEST
  // render, not the mount-time closure.
  test("a rerender swaps the comment list without re-subscribing — j sees the new list", () => {
    const focused: string[] = [];
    const base = {
      activeId: null,
      focusComment: (id: string) => focused.push(id),
      onCancelDraft: () => {},
      onResolveActive: () => {},
    };
    const { rerender } = renderHook((p: Props) => useKeyboardShortcuts(p), {
      initialProps: { ...base, comments: [makeComment({ id: "a" })] },
    });
    rerender({ ...base, comments: [makeComment({ id: "x" })] });
    press("j");
    expect(focused).toEqual(["x"]);
  });
});

describe("useLiveReload", () => {
  class FakeEventSource {
    static instances: FakeEventSource[] = [];
    url: string;
    onmessage: ((e: MessageEvent) => void) | null = null;
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    closed = false;
    constructor(url: string) {
      this.url = url;
      FakeEventSource.instances.push(this);
    }
    close() {
      this.closed = true;
    }
    emit(data: string) {
      this.onmessage?.({ data } as MessageEvent);
    }
  }
  const RealEventSource = globalThis.EventSource;
  const lastES = () => FakeEventSource.instances.at(-1)!;

  beforeEach(() => {
    FakeEventSource.instances = [];
    (globalThis as { EventSource: unknown }).EventSource = FakeEventSource;
  });
  afterEach(() => {
    (globalThis as { EventSource: unknown }).EventSource = RealEventSource;
    sessionStorage.clear();
  });

  test("a comments event outside composition refetches immediately; unmount closes the stream", () => {
    const calls: number[] = [];
    const { unmount } = renderHook(() => useLiveReload(() => calls.push(1), false));
    act(() => lastES().emit("comments"));
    expect(calls.length).toBe(1);
    unmount();
    expect(lastES().closed).toBe(true);
  });

  test("comments events during IME composition are deferred and coalesced into one flush", () => {
    const calls: number[] = [];
    renderHook(() => useLiveReload(() => calls.push(1), false));
    document.dispatchEvent(new Event("compositionstart"));
    act(() => {
      lastES().emit("comments");
      lastES().emit("comments");
    });
    expect(calls.length).toBe(0);
    document.dispatchEvent(new Event("compositionend"));
    expect(calls.length).toBe(1);
  });

  test("a reload during an open draft is deferred, then flushes when the draft closes", () => {
    const { rerender } = renderHook(({ deferred }) => useLiveReload(() => {}, deferred), {
      initialProps: { deferred: true },
    });
    act(() => lastES().emit("reload"));
    // Still deferred: reloadWithSnapshot hasn't run, so no snapshot was stashed.
    expect(consumePreReloadText()).toBeNull();
    rerender({ deferred: false });
    // The false transition flushes the pending reload — the sessionStorage stash is
    // reloadWithSnapshot's observable side effect (location.reload is inert here).
    expect(consumePreReloadText()).not.toBeNull();
  });

  test("a transient EventSource error does not flip connected before the debounce window", () => {
    const { result } = renderHook(() => useLiveReload(() => {}, false));
    act(() => lastES().onerror?.());
    expect(result.current.connected).toBe(true);
    // The browser's silent retry reopens the stream; the pending flip is cancelled.
    act(() => lastES().onopen?.());
    expect(result.current.connected).toBe(true);
  });
});

describe("useComments", () => {
  const RealFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = RealFetch;
  });

  // The reload path fetches through api.listComments — stub at the fetch layer, same
  // seam api.test.ts uses.
  function stubList(review: ReturnType<typeof makeReview>) {
    globalThis.fetch = (async () => Response.json(review)) as unknown as typeof fetch;
  }

  function wrapper({ children }: { children: ReactNode }) {
    return <Suspense fallback={null}>{children}</Suspense>;
  }

  async function mounted(initial: ReturnType<typeof makeReview>) {
    let resolve!: (v: ReturnType<typeof makeReview>) => void;
    const promise = new Promise<ReturnType<typeof makeReview>>((r) => {
      resolve = r;
    });
    const { result, rerender } = renderHook(() => useComments(promise), { wrapper });
    // Two-step Suspense resume for bun + happy-dom: resolve inside act, then kick a
    // rerender — the retry never self-schedules in this environment (neither waitFor
    // polling nor an empty act picks it up).
    await act(async () => {
      resolve(initial);
      await promise;
    });
    rerender();
    expect(result.current).not.toBeNull();
    return result;
  }

  test("a reload whose comment gained an agent reply marks it fresh (pulse)", async () => {
    const result = await mounted(makeReview([makeComment({ id: "c1", replies: [] })]));
    stubList(
      makeReview([
        makeComment({
          id: "c1",
          status: "answered",
          replies: [makeReply({ id: "r1", author: "agent" })],
        }),
      ]),
    );
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.freshReplyIds.has("c1")).toBe(true);
  });

  test("a human reply does not pulse — it's the user's own action", async () => {
    const result = await mounted(makeReview([makeComment({ id: "c1", replies: [] })]));
    stubList(
      makeReview([makeComment({ id: "c1", replies: [makeReply({ id: "r1", author: "human" })] })]),
    );
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.freshReplyIds.has("c1")).toBe(false);
  });
});

describe("usePanelResize", () => {
  function Harness() {
    const ref = usePanelResize();
    return <div ref={ref} role="separator" tabIndex={0} aria-label="Resize panel" />;
  }

  afterEach(() => {
    document.documentElement.style.removeProperty("--miru-panel-w");
    localStorage.removeItem("miru:panel-width");
  });

  test("arrow keys resize the panel, persist the width, and update aria-valuenow", async () => {
    const user = userEvent.setup();
    const { getByRole } = render(<Harness />);
    const sep = getByRole("separator");
    sep.focus();
    // No stylesheet under happy-dom → the hook falls back to the 380px default;
    // ArrowLeft widens by one step (16px), inside the 360..70vw clamp.
    await user.keyboard("{ArrowLeft}");
    expect(document.documentElement.style.getPropertyValue("--miru-panel-w")).toBe("396px");
    expect(localStorage.getItem("miru:panel-width")).toBe("396");
    expect(sep.getAttribute("aria-valuenow")).toBe("396");
  });
});
