// Visual highlighting of anchored comments. Text ranges use the CSS Custom Highlight
// API (no DOM mutation, so offsets stay stable); elements get marker classes.
import type { Anchor, Comment } from "@miru/contract";
import { findTextOffsets, resolveElement } from "./anchor.ts";
import { buildTextIndex, DOC, rangeFromIndex } from "./dom.ts";

// Transient "the agent just changed this" highlight, painted right after a live reload.
// Pass a { start, end } computed by diffRange over pre-reload vs current docText, or null
// to clear. Same Custom Highlight machinery as applyDraftHighlight — a separate name so
// its CSS style is independent (a warm amber that reads as "look here" without conflicting
// with the anchored-comment yellow).
export function applyChangedHighlight(range: { start: number; end: number } | null): void {
  const root = DOC();
  const ranges: Range[] = [];
  if (range) {
    const idx = buildTextIndex(root);
    const r = rangeFromIndex(idx, range.start, range.end);
    if (r) ranges.push(r);
  }
  // typeof-guard: happy-dom and older browsers don't ship the Custom Highlight API.
  if (typeof Highlight !== "undefined" && CSS.highlights) {
    CSS.highlights.set("miru-changed", new Highlight(...ranges));
  }
}

export function applyHighlights(comments: Comment[], activeId: string | null): void {
  const root = DOC();
  root
    .querySelectorAll(".miru-el-hl, .miru-el-active")
    .forEach((e) => e.classList.remove("miru-el-hl", "miru-el-active"));
  const ranges: Range[] = [];
  // One text-node walk for the whole pass; each anchor is then a string search + binary search.
  const idx = buildTextIndex(root);
  for (const c of comments) {
    if (c.resolved) continue;
    if (c.anchor.type === "text") {
      const off = findTextOffsets(c.anchor, idx.text);
      const r = off && rangeFromIndex(idx, off.start, off.end);
      if (r) ranges.push(r);
    } else {
      const el = resolveElement(c.anchor);
      if (el) {
        el.classList.add("miru-el-hl");
        if (c.id === activeId) el.classList.add("miru-el-active");
      }
    }
  }
  if (typeof Highlight !== "undefined" && CSS.highlights) {
    CSS.highlights.set("miru", new Highlight(...ranges));
  }
}

// Paint (or clear) a named single-anchor highlight: text ranges go through the Custom
// Highlight API, element anchors get a marker class. Shared by the draft form's
// "target while composing" state and the card-hover preview — the two differ only in
// the CSS name/class, and keeping the shape single-sourced means a future style tweak
// (or a third anchor state) doesn't drift between siblings.
function applyAnchorHighlight(
  anchor: Anchor | null,
  { highlight, klass }: { highlight: string; klass: string },
): void {
  const root = DOC();
  root.querySelectorAll(`.${klass}`).forEach((e) => e.classList.remove(klass));
  const ranges: Range[] = [];
  if (anchor) {
    if (anchor.type === "text") {
      const idx = buildTextIndex(root);
      const off = findTextOffsets(anchor, idx.text);
      const r = off && rangeFromIndex(idx, off.start, off.end);
      if (r) ranges.push(r);
    } else {
      const el = resolveElement(anchor);
      if (el) el.classList.add(klass);
    }
  }
  if (typeof Highlight !== "undefined" && CSS.highlights) {
    CSS.highlights.set(highlight, new Highlight(...ranges));
  }
}

// Persist a visible "selected" state on the draft's target while the form is open.
// Native text selection collapses as soon as focus moves to the textarea, so we
// re-paint the range through the Custom Highlight API; element anchors get a
// distinct class. Pass null to clear.
export function applyDraftHighlight(anchor: Anchor | null): void {
  applyAnchorHighlight(anchor, { highlight: "miru-draft", klass: "miru-el-draft" });
}

// Transient highlight painted on the anchor of the card the user is hovering over in
// the panel. The visual is intentionally distinct from the draft highlight (which is
// more committed) and from the Alt-hover .miru-el-preview (which targets a
// not-yet-anchored element). Pass null to clear.
export function applyPreviewHighlight(anchor: Anchor | null): void {
  applyAnchorHighlight(anchor, { highlight: "miru-preview", klass: "miru-el-card-preview" });
}
