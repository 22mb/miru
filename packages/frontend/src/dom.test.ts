import "./register-dom.ts";
import { afterEach, describe, expect, test } from "bun:test";
import { consumePreReloadText, diffRange, stashPreReloadText } from "./dom.ts";

afterEach(() => {
  sessionStorage.clear();
});

describe("diffRange", () => {
  test("returns null for identical strings", () => {
    expect(diffRange("hello", "hello")).toBeNull();
    expect(diffRange("", "")).toBeNull();
  });

  test("locates a single in-middle edit via prefix+suffix", () => {
    // "the quick brown fox" -> "the slow brown fox"
    //  012345678901234567
    //  common prefix "the " (4), common suffix " brown fox" (10)
    const r = diffRange("the quick brown fox", "the slow brown fox");
    expect(r).toEqual({ start: 4, end: 8 }); // "slow" in the new string
  });

  test("insertion at end returns the tail range", () => {
    const r = diffRange("hello", "hello world");
    expect(r).toEqual({ start: 5, end: 11 });
  });

  test("pure deletion returns null (nothing left to paint in the new text)", () => {
    // Prefix consumes everything of `next`, so start === endNext.
    expect(diffRange("hello world", "hello")).toBeNull();
  });

  test("collapses two scattered edits into a single spanning range", () => {
    // The prefix stops at the first change and the suffix walks back to the last —
    // documented behaviour, and what the MAX_CHANGED_FRACTION cap in App is there to
    // catch when the collapse gets absurd.
    const prev = "aaa X bbb Y ccc";
    const next = "aaa 1 bbb 2 ccc";
    const r = diffRange(prev, next)!;
    expect(next.slice(r.start, r.end)).toBe("1 bbb 2");
  });
});

describe("pre-reload snapshot", () => {
  test("stash then consume returns the same text and clears the slot", () => {
    stashPreReloadText("before edit");
    expect(consumePreReloadText()).toBe("before edit");
    // Single-shot — a second consumer sees nothing.
    expect(consumePreReloadText()).toBeNull();
  });

  test("consume returns null when nothing has been stashed", () => {
    expect(consumePreReloadText()).toBeNull();
  });
});
