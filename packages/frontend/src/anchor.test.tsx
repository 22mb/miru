import "./register-dom.ts";
import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  anchorRect,
  buildElementAnchor,
  buildTextAnchor,
  isStale,
  resolveElement,
  resolveText,
  scrollToComment,
} from "./anchor.ts";
import { docText, offsetOf, rangeFromOffsets } from "./dom.ts";
import { makeComment } from "./fixtures.ts";

// Build a `.miru-doc` fixture; DOC() (used internally by the anchor helpers) resolves to it.
function setDoc(html: string): HTMLElement {
  document.body.innerHTML = `<div class="miru-doc">${html}</div>`;
  return document.querySelector<HTMLElement>(".miru-doc")!;
}

// Tests in the "combined helpers" group stub Range.prototype.getBoundingClientRect to
// simulate layout; restore it after each test so the override doesn't leak.
const realRangeRect = Range.prototype.getBoundingClientRect;
afterEach(() => {
  document.body.innerHTML = "";
  Range.prototype.getBoundingClientRect = realRangeRect;
});

describe("text offsets", () => {
  test("offsetOf and rangeFromOffsets round-trip across element boundaries", () => {
    const root = setDoc("<p>Hello</p><p>World</p>");
    expect(docText(root)).toBe("HelloWorld");
    const r = rangeFromOffsets(root, 6, 9)!; // "orl" inside the second <p>
    expect(r).not.toBeNull();
    expect(r.toString()).toBe("orl");
    expect(offsetOf(root, r.startContainer, r.startOffset)).toBe(6);
    expect(offsetOf(root, r.endContainer, r.endOffset)).toBe(9);
  });
});

describe("text anchor restore paths", () => {
  test("exact offset", () => {
    const root = setDoc("<p>The quick brown fox</p>");
    const anchor = buildTextAnchor(rangeFromOffsets(root, 4, 9)!)!;
    expect(anchor.quote).toBe("quick");
    expect(resolveText(anchor)?.toString()).toBe("quick");
  });

  test("prefix/suffix re-search after an edit shifts offsets", () => {
    const root = setDoc("<p>The quick brown fox</p>");
    const anchor = buildTextAnchor(rangeFromOffsets(root, 4, 9)!)!;
    setDoc("<p>NOTE: The quick brown fox</p>"); // absolute offsets no longer match
    expect(resolveText(anchor)?.toString()).toBe("quick");
  });

  test("quote-only when surrounding context changed", () => {
    const root = setDoc("<p>The quick brown fox</p>");
    const anchor = buildTextAnchor(rangeFromOffsets(root, 4, 9)!)!;
    setDoc("<p>A quick cat</p>"); // prefix/suffix gone, quote survives
    expect(resolveText(anchor)?.toString()).toBe("quick");
  });

  test("null (stale) when the quote is gone", () => {
    const root = setDoc("<p>The quick brown fox</p>");
    const anchor = buildTextAnchor(rangeFromOffsets(root, 4, 9)!)!;
    setDoc("<p>Entirely different content</p>");
    expect(resolveText(anchor)).toBeNull();
  });

  test("buildTextAnchor rejects a collapsed/empty range", () => {
    const root = setDoc("<p>abc</p>");
    expect(buildTextAnchor(rangeFromOffsets(root, 2, 2)!)).toBeNull();
  });
});

describe("element anchor restore paths", () => {
  test("selector", () => {
    const root = setDoc("<section><h2>Title</h2><p>Para</p></section>");
    const target = root.querySelector("p")!;
    const anchor = buildElementAnchor(target);
    expect(anchor.selector).toBe("section > p");
    expect(resolveElement(anchor)).toBe(target);
  });

  test("role + accessible name within the landmark", () => {
    setDoc('<nav><a href="#" aria-label="Home">x</a></nav>');
    const anchor = buildElementAnchor(document.querySelector("a")!);
    expect(anchor.role).toBe("link");
    expect(anchor.accessibleName).toBe("Home");
    // Restructure so the original selector misses, but role+name in the nav still match.
    setDoc('<nav><div><span></span><a href="#" aria-label="Home">x</a></div></nav>');
    expect(resolveElement(anchor)).toBe(document.querySelector("a"));
  });

  test("tag chain + text hint", () => {
    setDoc('<div><span>a</span><span>b</span><p title="Label">Target</p></div>');
    const anchor = buildElementAnchor(document.querySelector("p")!);
    expect(anchor.accessibleName).toBe("Label");
    // New wrapper (selector breaks) and no title (accessible-name breaks); only the
    // tag-chain + text-hint path can match.
    setDoc("<section><p>Target</p></section>");
    expect(resolveElement(anchor)).toBe(document.querySelector("p"));
  });

  test("null (stale) when nothing matches", () => {
    setDoc("<section><p>Target</p></section>");
    const anchor = buildElementAnchor(document.querySelector("p")!);
    setDoc("<article><h2>Different</h2></article>");
    expect(resolveElement(anchor)).toBeNull();
  });
});

describe("combined helpers", () => {
  test("anchorRect prefers the Range rect over the parent block", () => {
    // The parent <p> wraps to many visual lines, but the anchored quote sits on the last
    // one — centring the parent would push the quote far from viewport centre, which is
    // the bug this helper fixes. The Range rect tracks the actual quote location.
    const root = setDoc("<p>line 1\nline 2 longer\nline 3 target</p>");
    const full = docText(root);
    const start = full.indexOf("target");
    const anchor = buildTextAnchor(rangeFromOffsets(root, start, start + 6)!)!;
    const para = root.querySelector("p")!;
    // Stub bounding rects: parent spans 0–200, the quote sits at 180–196 (near the bottom).
    para.getBoundingClientRect = () => new DOMRect(0, 0, 800, 200);
    Range.prototype.getBoundingClientRect = () => new DOMRect(50, 180, 60, 16);
    const rect = anchorRect(makeComment({ anchor }));
    expect(rect?.top).toBe(180);
    expect(rect?.height).toBe(16);
  });

  test("anchorRect returns the element rect for element anchors", () => {
    setDoc('<p><img src="data:," alt="logo"></p>');
    const img = document.querySelector("img")!;
    img.getBoundingClientRect = () => new DOMRect(10, 20, 100, 80);
    const anchor = buildElementAnchor(img);
    expect(anchorRect(makeComment({ anchor }))?.top).toBe(20);
  });

  test("anchorRect is null when the anchor no longer resolves", () => {
    const root = setDoc("<p>findable</p>");
    const anchor = buildTextAnchor(rangeFromOffsets(root, 0, 8)!)!;
    setDoc("<p>nothing</p>");
    expect(anchorRect(makeComment({ anchor }))).toBeNull();
  });

  test("scrollToComment centres the anchor rect, not the enclosing block", () => {
    // Same shape as the bug repro: text anchor on a multi-visual-line paragraph. The fix
    // must use the Range rect so the quote — not the paragraph midpoint — lands at center.
    const root = setDoc("<p>line 1\nline 2 longer\nline 3 target</p>");
    const full = docText(root);
    const start = full.indexOf("target");
    const anchor = buildTextAnchor(rangeFromOffsets(root, start, start + 6)!)!;
    const para = root.querySelector("p")!;
    para.getBoundingClientRect = () => new DOMRect(0, 0, 800, 200); // parent midpoint at y=100
    Range.prototype.getBoundingClientRect = () => new DOMRect(50, 180, 60, 16); // quote midpoint at y=188
    const scrollBy = mock((_opts: ScrollToOptions) => {});
    (window as unknown as { scrollBy: typeof scrollBy }).scrollBy = scrollBy;
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
    scrollToComment(makeComment({ anchor }));
    // Range centre 188, viewport centre 300 -> scroll by -112 (up). The buggy behaviour
    // would have centred the parent (midpoint 100) and produced delta -200 instead.
    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollBy.mock.calls[0]![0]).toEqual({ top: -112, behavior: "smooth" });
  });

  test("scrollToComment is a no-op when the anchor is stale", () => {
    const root = setDoc("<p>findable</p>");
    const anchor = buildTextAnchor(rangeFromOffsets(root, 0, 8)!)!;
    setDoc("<p>nothing</p>");
    const scrollBy = mock((_opts: ScrollToOptions) => {});
    (window as unknown as { scrollBy: typeof scrollBy }).scrollBy = scrollBy;
    scrollToComment(makeComment({ anchor }));
    expect(scrollBy).not.toHaveBeenCalled();
  });

  test("isStale tracks whether the anchor still resolves", () => {
    const root = setDoc("<p>findable text here</p>");
    const anchor = buildTextAnchor(rangeFromOffsets(root, 0, 8)!)!; // "findable"
    const comment = makeComment({ anchor });
    expect(isStale(comment)).toBe(false);
    setDoc("<p>nothing here</p>");
    expect(isStale(comment)).toBe(true);
  });
});
