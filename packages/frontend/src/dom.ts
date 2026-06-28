// Text-offset helpers over the rendered document. Offsets are measured against the
// concatenation of all text nodes under a root, so anchors survive structural edits
// that preserve text. Pure relative to the DOM passed in — the unit-test seam.

// The reviewed content root; falls back to body when the wrapper is absent.
export const DOC = (): HTMLElement =>
  document.querySelector<HTMLElement>(".miru-doc") ?? document.body;

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
