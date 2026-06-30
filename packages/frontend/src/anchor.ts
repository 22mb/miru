// Anchoring: locate a comment's target in the live document, robust to edits.
// Text anchors restore by exact offset -> prefix/suffix re-search -> quote-only.
// Element anchors restore by selector -> role + accessible name -> tag-chain + text-hint.
// When nothing matches the anchor is `stale` (kept, not dropped).
import type { Comment, ElementAnchor, TextAnchor } from "@miru/contract";
import { DOC, docText, offsetOf, rangeFromOffsets } from "./dom.ts";

const ANCHOR_CONTEXT_LEN = 32; // chars of context stored around a text anchor, for re-anchoring after edits
const TEXT_HINT_LEN = 64; // max chars of element text used as accessible name / hint

// ---------- text anchor ----------
export function buildTextAnchor(range: Range): TextAnchor | null {
  const root = DOC();
  if (!root.contains(range.commonAncestorContainer)) return null;
  const start = offsetOf(root, range.startContainer, range.startOffset);
  const end = offsetOf(root, range.endContainer, range.endOffset);
  if (end <= start) return null;
  const full = docText(root);
  return {
    type: "text",
    quote: full.slice(start, end),
    prefix: full.slice(Math.max(0, start - ANCHOR_CONTEXT_LEN), start),
    suffix: full.slice(end, end + ANCHOR_CONTEXT_LEN),
    start,
    end,
  };
}

// Pure-string restore: exact offset -> prefix/suffix re-search -> quote-only. Returns the
// matched offsets without touching the DOM, so callers that only need yes/no (staleness)
// or that already hold a TextIndex can skip building a Range.
export function findTextOffsets(
  a: TextAnchor,
  full: string,
): { start: number; end: number } | null {
  // 1) exact offset
  if (full.slice(a.start, a.end) === a.quote) return { start: a.start, end: a.end };
  // 2) prefix + quote + suffix re-search (robust to edits)
  let i = full.indexOf(a.prefix + a.quote + a.suffix);
  if (i >= 0) {
    const s = i + a.prefix.length;
    return { start: s, end: s + a.quote.length };
  }
  // 3) quote only
  i = full.indexOf(a.quote);
  if (i >= 0) return { start: i, end: i + a.quote.length };
  return null; // stale
}

export function resolveText(a: TextAnchor, fullText?: string): Range | null {
  const root = DOC();
  const off = findTextOffsets(a, fullText ?? docText(root));
  return off ? rangeFromOffsets(root, off.start, off.end) : null;
}

// ---------- element anchor ----------
const LANDMARKS = ["main", "nav", "header", "footer", "aside", "section", "article"];
const IMPLICIT_ROLE: Record<string, string> = {
  img: "img",
  a: "link",
  table: "table",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
};

function roleOf(el: Element): string | null {
  return el.getAttribute("role") ?? IMPLICIT_ROLE[el.tagName.toLowerCase()] ?? null;
}
function textHintOf(el: Element): string | null {
  return el.textContent?.trim().slice(0, TEXT_HINT_LEN) || null;
}
function accNameOf(el: Element): string | null {
  return (
    el.getAttribute("aria-label") ??
    el.getAttribute("alt") ??
    el.getAttribute("title") ??
    textHintOf(el)
  );
}
function landmarkOf(el: Element): string | null {
  let cur: Element | null = el;
  while (cur) {
    if (LANDMARKS.includes(cur.tagName.toLowerCase())) return cur.tagName.toLowerCase();
    cur = cur.parentElement;
  }
  return null;
}
function tagChainOf(el: Element): string[] {
  const chain: string[] = [];
  let cur: Element | null = el;
  const root = DOC();
  while (cur && cur !== root && cur !== document.body) {
    chain.unshift(cur.tagName.toLowerCase());
    cur = cur.parentElement;
  }
  return chain;
}
function cssPath(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  const root = DOC();
  while (cur && cur !== root && cur !== document.body) {
    const tag = cur.tagName.toLowerCase();
    const parent: Element | null = cur.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    const node: Element = cur;
    const sameTag = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
    const idx = sameTag.indexOf(node) + 1;
    parts.unshift(sameTag.length > 1 ? `${tag}:nth-of-type(${idx})` : tag);
    cur = parent;
  }
  return parts.join(" > ");
}

export function buildElementAnchor(el: Element): ElementAnchor {
  const root = DOC();
  const selector = cssPath(el);
  let all: Element[] = [];
  try {
    all = Array.from(root.querySelectorAll(selector));
  } catch {
    all = [];
  }
  return {
    type: "element",
    selector,
    tagChain: tagChainOf(el),
    role: roleOf(el),
    accessibleName: accNameOf(el),
    landmark: landmarkOf(el),
    textHint: textHintOf(el),
    index: Math.max(0, all.indexOf(el)),
  };
}

export function resolveElement(a: ElementAnchor): Element | null {
  const root = DOC();
  // 1) selector
  try {
    const found = root.querySelectorAll(a.selector);
    if (found.length === 1) return found[0]!;
    if (found.length > 1 && found[a.index]) return found[a.index]!;
  } catch {
    // invalid selector -> fall through
  }
  // 2) role + accessible name within the same landmark (robust to structure changes)
  if (a.accessibleName) {
    const scope = (a.landmark && root.querySelector(a.landmark)) || root;
    const cands = Array.from(scope.querySelectorAll("*")).filter(
      (e) => roleOf(e) === a.role && accNameOf(e) === a.accessibleName,
    );
    if (cands[0]) return cands[0];
  }
  // 3) tag chain + text hint
  if (a.textHint) {
    const tag = a.tagChain[a.tagChain.length - 1] ?? "*";
    const cands = Array.from(root.querySelectorAll(tag)).filter(
      (e) => textHintOf(e) === a.textHint,
    );
    if (cands[0]) return cands[0];
  }
  return null; // stale
}

// ---------- combined ----------
// Live bounding rect of a comment's anchor: the Range rect for text, the element rect
// for element anchors. Returns null when the anchor no longer resolves. Used to scroll
// the actual anchor — not the enclosing block — to viewport center, which matters when
// the enclosing block is a tall Markdown paragraph that grew after a source edit (e.g.
// a single `<p>` whose source lines were merged by blank-line collapsing).
export function anchorRect(c: Comment): DOMRect | null {
  if (c.anchor.type === "text") return resolveText(c.anchor)?.getBoundingClientRect() ?? null;
  return resolveElement(c.anchor)?.getBoundingClientRect() ?? null;
}

// Scroll the page so the anchor sits at the vertical center of the viewport. Uses the
// Range/element rect directly instead of Element.scrollIntoView on a parent: a parent
// `<p>` that wraps to many visual lines would centre its own middle, pushing the actual
// highlighted text out of view. window.scrollBy clamps to document bounds, so a target
// near the top/bottom falls back to a partial scroll automatically.
export function scrollToComment(c: Comment): void {
  const rect = anchorRect(c);
  if (!rect) return;
  const delta = rect.top + rect.height / 2 - window.innerHeight / 2;
  window.scrollBy({ top: delta, behavior: "smooth" });
}

export function isStale(c: Comment, fullText?: string): boolean {
  // Text staleness is a pure string question — don't build (and discard) a Range for it.
  if (c.anchor.type === "text") return !findTextOffsets(c.anchor, fullText ?? docText(DOC()));
  return !resolveElement(c.anchor);
}
