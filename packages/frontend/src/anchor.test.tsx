import "./register-dom.ts";
import { afterEach, describe, expect, test } from "bun:test";
import {
  anchorElement,
  buildElementAnchor,
  buildTextAnchor,
  isStale,
  resolveElement,
  resolveText,
} from "./anchor.ts";
import { docText, offsetOf, rangeFromOffsets } from "./dom.ts";
import { makeComment } from "./fixtures.ts";

// Build a `.miru-doc` fixture; DOC() (used internally by the anchor helpers) resolves to it.
function setDoc(html: string): HTMLElement {
  document.body.innerHTML = `<div class="miru-doc">${html}</div>`;
  return document.querySelector<HTMLElement>(".miru-doc")!;
}

afterEach(() => {
  document.body.innerHTML = "";
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
  test("anchorElement returns the element containing a resolved text anchor", () => {
    const root = setDoc("<p>alpha</p><p>beta</p>");
    const anchor = buildTextAnchor(rangeFromOffsets(root, 6, 9)!)!; // "eta" inside "beta"
    const el = anchorElement(makeComment({ anchor }));
    expect(el?.tagName).toBe("P");
    expect(el?.textContent).toBe("beta");
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
