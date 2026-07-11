// Text-offset helpers over the rendered document. Offsets are measured against the
// concatenation of all text nodes under a root, so anchors survive structural edits
// that preserve text. Pure relative to the DOM passed in — the unit-test seam.

// The reviewed content root; falls back to body when the wrapper is absent.
export const DOC = (): HTMLElement =>
  document.querySelector<HTMLElement>(".miru-doc") ?? document.body;

/** The document's own scroll container, or null when the viewport scrolls. Template-
 *  owned pages (Markdown / sanitized HTML) scroll inside main.miru-doc so the page
 *  scrollbar sits at the document/panel boundary (see miru.css); raw documents keep
 *  their own <body> and native viewport scrolling. */
export function docScroller(): HTMLElement | null {
  const doc = DOC();
  return doc.matches("body > main.miru-doc") ? doc : null;
}

// Reading-position persistence for the container scroller. Browsers restore viewport
// scroll across reloads on their own, but not an overflow container's — and live
// reload fires on every source edit, so losing the position would make the review
// loop unbearable. Saved on pagehide (covers live reload, F5, and navigation),
// consumed single-shot on load. No-op for raw documents (null scroller).
const DOC_SCROLL_KEY = "miru:doc-scroll";

export function persistDocScroll(): void {
  const scroller = docScroller();
  if (!scroller) return;
  const saved = sessionStorage.getItem(DOC_SCROLL_KEY);
  if (saved !== null) {
    sessionStorage.removeItem(DOC_SCROLL_KEY);
    scroller.scrollTop = Number(saved) || 0;
  }
  window.addEventListener("pagehide", () => {
    try {
      sessionStorage.setItem(DOC_SCROLL_KEY, String(scroller.scrollTop));
    } catch {
      /* private-browsing / quota — position restore is nice-to-have */
    }
  });
}

export function walkText(root: Node): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const out: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) out.push(n as Text);
  return out;
}

export function offsetOf(root: Node, node: Node, offset: number): number {
  let count = 0;
  for (const t of walkText(root)) {
    if (t === node) return count + offset;
    count += t.data.length;
  }
  return count;
}

// A one-pass index over a root's text nodes: their cumulative start offsets plus the
// concatenated text. Build it ONCE and reuse for many lookups — each offset→Range
// conversion is then a binary search instead of a fresh full-document walk.
export interface TextIndex {
  nodes: Text[];
  starts: number[]; // starts[i] = global offset where nodes[i] begins; starts[length] = total
  text: string;
}

export function buildTextIndex(root: Node): TextIndex {
  const nodes = walkText(root);
  const starts: number[] = [];
  let count = 0;
  for (const t of nodes) {
    starts.push(count);
    count += t.data.length;
  }
  starts.push(count); // sentinel: total length
  return { nodes, starts, text: nodes.map((t) => t.data).join("") };
}

// First text node whose end (>=) covers `offset`, matching the linear scan's boundary
// tie-break (an offset on a node boundary resolves to the end of the earlier node).
function locate(idx: TextIndex, offset: number): { node: Text; off: number } | null {
  const { nodes, starts } = idx;
  let lo = 0;
  let hi = nodes.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid + 1]! >= offset) {
      ans = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  if (ans < 0) return null; // offset past the end
  return { node: nodes[ans]!, off: offset - starts[ans]! };
}

export function rangeFromIndex(idx: TextIndex, start: number, end: number): Range | null {
  const s = locate(idx, start);
  const e = locate(idx, end);
  if (!s || !e) return null;
  try {
    const r = document.createRange();
    r.setStart(s.node, s.off);
    r.setEnd(e.node, e.off);
    return r;
  } catch {
    return null;
  }
}

export function rangeFromOffsets(root: Node, start: number, end: number): Range | null {
  return rangeFromIndex(buildTextIndex(root), start, end);
}

export function docText(root: Node): string {
  return buildTextIndex(root).text;
}

// sessionStorage keys used to hand the pre-reload doc text across a live reload — the JS
// heap is destroyed by location.reload(), so we can only compute an after-reload "what
// changed" if the before-text was persisted somewhere that survives the reload. Cleared
// as soon as consumePreReloadText reads it (single-shot) so a plain user F5 doesn't
// re-paint a stale change.
const PRE_RELOAD_TEXT_KEY = "miru:pre-reload-text";
const PRE_RELOAD_TS_KEY = "miru:pre-reload-ts";
// Snapshots older than this are treated as stale and dropped — a browser refresh, a tab
// closed & reopened, or a real reload with no accompanying doc change should not paint an
// obsolete diff. 10s is long enough to cover a slow reload's disk read + parse.
const PRE_RELOAD_FRESH_MS = 10_000;

export function stashPreReloadText(text: string): void {
  try {
    sessionStorage.setItem(PRE_RELOAD_TEXT_KEY, text);
    sessionStorage.setItem(PRE_RELOAD_TS_KEY, String(Date.now()));
  } catch {
    /* private-browsing / quota — the flash is nice-to-have, not load-bearing */
  }
}

// Read + clear the pre-reload snapshot. Returns null if none is present or the snapshot
// is older than the freshness window.
export function consumePreReloadText(): string | null {
  try {
    const text = sessionStorage.getItem(PRE_RELOAD_TEXT_KEY);
    const ts = Number(sessionStorage.getItem(PRE_RELOAD_TS_KEY));
    sessionStorage.removeItem(PRE_RELOAD_TEXT_KEY);
    sessionStorage.removeItem(PRE_RELOAD_TS_KEY);
    if (text === null || !Number.isFinite(ts)) return null;
    if (Date.now() - ts > PRE_RELOAD_FRESH_MS) return null;
    return text;
  } catch {
    return null;
  }
}

// Character range in `next` that differs from `prev`, via longest common prefix + longest
// common suffix. Returns null when the strings are identical or when the change is a pure
// deletion (nothing to paint in `next`). Deliberately coarse: two scattered edits collapse
// into a single spanning range — good enough for "look here after the reload" without a
// real diff algorithm's cost. Callers can cap by size (see MAX_CHANGED_FRACTION in App).
export function diffRange(prev: string, next: string): { start: number; end: number } | null {
  if (prev === next) return null;
  const maxPrefix = Math.min(prev.length, next.length);
  let start = 0;
  while (start < maxPrefix && prev.charCodeAt(start) === next.charCodeAt(start)) start++;
  let endPrev = prev.length;
  let endNext = next.length;
  while (
    endPrev > start &&
    endNext > start &&
    prev.charCodeAt(endPrev - 1) === next.charCodeAt(endNext - 1)
  ) {
    endPrev--;
    endNext--;
  }
  if (start === endNext) return null;
  return { start, end: endNext };
}
