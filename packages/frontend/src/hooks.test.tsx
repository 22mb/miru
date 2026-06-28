// Hook coverage. The pure / DOM-driven hooks (useDocumentEvent, useKeyboardShortcuts,
// inPanel) are exercised here. useComments, useDraftCapture, and useLiveReload depend
// on api / EventSource / Range selection; their behavior is covered by api.test.ts and
// anchor.test.tsx — App.tsx is the integration seam.
import "./register-dom.ts";
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, renderHook } from "@testing-library/react";
import { makeComment } from "./fixtures.ts";
import { inPanel, useAltHoverPreview, useDocumentEvent, useKeyboardShortcuts } from "./hooks.ts";

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
});
