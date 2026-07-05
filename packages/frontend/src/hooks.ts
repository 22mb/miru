// React hooks shared across the panel. Each hook owns one concern of the review
// flow so App.tsx can stay a thin composition layer:
//   - useDocumentEvent       : low-level document listener with effect cleanup
//   - useComments            : Suspense-resolved comments state + mutators
//   - useDraftCapture        : selection / Alt-click -> open draft form
//   - useAltHoverPreview     : outline the would-be Alt-click target while Alt is held
//   - useLiveReload          : SSE subscription, reload page or refetch comments
//   - useKeyboardShortcuts   : j / k / r / Esc panel-wide bindings
import {
  type RefObject,
  use,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import type { Anchor, HydratedComment, HydratedReviewFile, SseEvent } from "@miru/contract";
import { buildElementAnchor, buildTextAnchor, isStale, scrollToComment } from "./anchor.ts";
import { api } from "./api.ts";
import type { Draft } from "./DraftForm.tsx";
import { DOC, docText, stashPreReloadText } from "./dom.ts";
import { applyDraftHighlight } from "./highlight.ts";

// Content-bearing block elements an Alt+click resolves to (nearest ancestor wins —
// `closest()` walks up by proximity, so a click inside a <td> anchors to the cell;
// table-level only fires when the click misses every cell, e.g. caption or border).
const ALT_CLICK_TARGETS = "img, pre, td, th, table, figure, blockquote, li, p, h1, h2, h3, h4";

// Draft form width — keep in sync with `.miru-draft` in miru.css. Used here for the
// viewport-clamp in useDraftCapture (kept out of DraftForm to keep that component pure
// presentation).
const DRAFT_WIDTH = 440;

// Wrap a state mutation with the View Transitions API so card add/remove/reorder morph
// instead of snap. flushSync is required: VT needs the DOM committed synchronously
// inside its callback to snapshot the "after" frame. Falls through to a plain call on
// engines that haven't shipped startViewTransition yet (Firefox as of writing).
//
// IMPORTANT: Skip the transition while a textarea / input is focused. VT replaces the
// live DOM with ::view-transition-old/new pseudo-elements for the duration of the
// animation; the focused element is captured into a non-interactive snapshot, which
// breaks IME composition (a window blur/refocus during a transition can leave the
// caret in limbo — IME input stops working until the user manually refocuses). The
// animation is a nicety; correct text input is not.
function isEditing(): boolean {
  const a = document.activeElement;
  return !!a && (a.tagName === "TEXTAREA" || a.tagName === "INPUT");
}
export function withViewTransition(cb: () => void): void {
  // lib.dom types startViewTransition as always-present; guard for engines that
  // haven't shipped it (Firefox as of writing) and for happy-dom in tests.
  const start = document.startViewTransition;
  if (typeof start === "function" && !isEditing()) start.call(document, () => flushSync(cb));
  else cb();
}

// Ref callback that promotes an element to the browser's top layer via the popover API
// the moment it mounts. Module-level so the ref identity is stable across re-renders —
// an inline arrow would re-attach every render, and the second showPopover() throws
// InvalidStateError because the popover is already showing. Optional chain on the
// method covers DOMs that don't implement it (older test envs) and very old browsers;
// the element still renders, just without the top-layer guarantee.
//
// After showing, focus a nested textarea if the popover contains one. This is the
// draft form's "start typing immediately" hook: React's `autoFocus` fires during commit
// while the popover is still `display: none`, so its focus() is a no-op — focusing here,
// after showPopover flips the popover open, lands the caret in the first textarea.
// The panel and the "Approved" banner also mount through popoverRef but contain no
// textarea at that moment, so the querySelector is a harmless miss.
export function popoverRef(el: HTMLElement | null): void {
  if (!el) return;
  el.showPopover?.();
  el.querySelector<HTMLTextAreaElement>("textarea")?.focus();
}

// Subscribe to a document-level event with effect-managed cleanup. Used for the
// selection / Alt-click / shortcut listeners that have to live above the panel
// root, where React's synthetic-event delegation can't reach. Pair with
// useEffectEvent so the handler can read latest state without re-subscribing.
export function useDocumentEvent<K extends keyof DocumentEventMap>(
  type: K,
  handler: (e: DocumentEventMap[K]) => void,
): void {
  useEffect(() => {
    document.addEventListener(type, handler);
    return () => document.removeEventListener(type, handler);
  }, [type, handler]);
}

export interface CommentsApi {
  comments: HydratedComment[];
  staleIds: Set<string>;
  // IDs that just received a NEW agent reply (compared to the previous comment-set).
  // Cards drive a brief pulse off this — auto-cleared after FRESH_REPLY_MS.
  freshReplyIds: Set<string>;
  reload: () => Promise<void>;
  submit: (anchor: Anchor, body: string, suggestion: string, asDraft: boolean) => Promise<void>;
  remove: (id: string) => Promise<void>;
  toggleResolved: (c: HydratedComment) => Promise<void>;
  reply: (id: string, body: string) => Promise<void>;
  submitReview: () => Promise<void>;
  focusComment: (id: string, scroll?: boolean) => void;
  activeId: string | null;
}

// How long the fresh-reply pulse stays on a card before fading. Long enough to catch the
// eye if the user is mid-scroll; short enough not to linger past the moment of relevance.
const FRESH_REPLY_MS = 8000;

// Comment state owner. The initial fetch is a Promise read through `use()`, so the
// enclosing <Suspense> handles "first paint while loading" instead of a render with an
// empty array + a useEffect refetch. The promise is owned by the caller (above the
// Suspense boundary) — creating it inside would re-fire on every Suspense remount and
// loop forever. Subsequent reloads just setComments.
export function useComments(initialPromise: Promise<HydratedReviewFile>): CommentsApi {
  const initial = use(initialPromise);
  const [comments, setComments] = useState<HydratedComment[]>(initial.comments);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Set of comment IDs whose reply count just grew with an agent reply. Cards subscribe
  // to this to drive a brief pulse — auto-cleared per-id after FRESH_REPLY_MS.
  const [freshReplyIds, setFreshReplyIds] = useState<Set<string>>(() => new Set());
  // Last-seen comments snapshot for diffing against a fresh server reload. Kept in a ref
  // because we read it inside `reload` without wanting to recreate the callback every render.
  const prevCommentsRef = useRef<HydratedComment[]>(initial.comments);
  // Active fade-out timers, keyed by comment id, so a second reply arriving before the
  // first timer fires extends the pulse instead of double-scheduling.
  const freshTimersRef = useRef<Map<string, number>>(new Map());

  // Cleanup pending timers on unmount so we don't setState into a dead hook.
  useEffect(() => {
    const timers = freshTimersRef.current;
    return () => {
      for (const t of timers.values()) window.clearTimeout(t);
      timers.clear();
    };
  }, []);

  const markFresh = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setFreshReplyIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
    for (const id of ids) {
      const existing = freshTimersRef.current.get(id);
      if (existing !== undefined) window.clearTimeout(existing);
      const t = window.setTimeout(() => {
        setFreshReplyIds((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        freshTimersRef.current.delete(id);
      }, FRESH_REPLY_MS);
      freshTimersRef.current.set(id, t);
    }
  }, []);

  const reload = useCallback(async () => {
    const review = await api.listComments();
    // Diff against the previous comment-set: any comment whose reply count grew AND whose
    // latest reply is from the agent is a "fresh" agent reply. Human replies don't pulse
    // (they're the user's own action, no need to attract attention).
    const prevByCid = new Map(prevCommentsRef.current.map((c) => [c.id, c]));
    const freshIds: string[] = [];
    for (const c of review.comments) {
      const prev = prevByCid.get(c.id);
      if (!prev) continue;
      if (c.replies.length <= prev.replies.length) continue;
      const newest = c.replies[c.replies.length - 1];
      if (newest?.author === "agent") freshIds.push(c.id);
    }
    prevCommentsRef.current = review.comments;
    withViewTransition(() => setComments(review.comments));
    if (freshIds.length) markFresh(freshIds);
  }, [markFresh]);

  const submit = useCallback(
    async (anchor: Anchor, body: string, suggestion: string, asDraft: boolean) => {
      await api.createComment({
        anchor,
        body,
        suggestion: suggestion.trim() ? { replacement: suggestion } : null,
        draft: asDraft,
      });
      await reload();
    },
    [reload],
  );

  const remove = useCallback(
    async (id: string) => {
      await api.deleteComment(id);
      await reload();
    },
    [reload],
  );

  const toggleResolved = useCallback(
    async (c: HydratedComment) => {
      await api.patchComment(c.id, { resolved: !c.resolved });
      await reload();
    },
    [reload],
  );

  const reply = useCallback(
    async (id: string, body: string) => {
      await api.patchComment(id, { reply: body });
      await reload();
    },
    [reload],
  );

  const submitReview = useCallback(async () => {
    await api.submitReview();
    await reload();
  }, [reload]);

  const focusComment = useCallback(
    (id: string, scroll = true) => {
      setActiveId(id);
      if (!scroll) return;
      const c = comments.find((x) => x.id === id);
      if (c) scrollToComment(c);
    },
    [comments],
  );

  // Staleness depends only on the (static) document and the comment set, so compute it once
  // per comment-set change instead of on every Card render (e.g. while typing a reply).
  const staleIds = useMemo(() => {
    const full = docText(DOC());
    return new Set(comments.filter((c) => isStale(c, full)).map((c) => c.id));
  }, [comments]);

  return {
    comments,
    staleIds,
    freshReplyIds,
    activeId,
    reload,
    submit,
    remove,
    toggleResolved,
    reply,
    submitReview,
    focusComment,
  };
}

// Selection (mouseup) and Alt+click on the reviewed document open a draft form
// next to the target. Events inside the miru panel are ignored.
//
// The draft's target is painted via the Custom Highlight API at the moment the
// draft opens/closes, not from a `[draft]` Effect — every transition is driven by
// an event handler (open/cancel/submit/Escape), so synchronizing in a separate
// Effect would just be derived bookkeeping.
export function useDraftCapture(): {
  draft: Draft | null;
  clearDraft: () => void;
} {
  const [draft, setDraft] = useState<Draft | null>(null);

  // Effect Events let listeners read latest state without forcing the subscription
  // to re-attach on every render.
  const openDraft = useEffectEvent((anchor: Anchor, rect: DOMRect) => {
    // Position the draft just below the selection/element, in VIEWPORT coordinates —
    // the form lives in the browser's top layer (popover="manual"), so its containing
    // block is the viewport and `top`/`left` are viewport-relative. Adding scrollY here
    // would push the form down by the scroll offset (it would appear below the fold on
    // a scrolled page).
    //
    // Clamp so the form stays fully on-screen:
    //   - left: subtract --miru-panel-w from the right bound so the form doesn't slip
    //     under the panel when the selection is right-aligned.
    //   - top: prefer placing below the anchor; if that would overflow the viewport
    //     bottom and there's room above, flip above. Form-height is an estimate (the
    //     element hasn't rendered yet) — covers the default empty state. Heavy growth
    //     from `field-sizing: content` would still overflow, accepted as a niche.
    const panelW =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--miru-panel-w")) ||
      380;
    const margin = 16;
    const formHEst = 280;
    const docMaxX = window.innerWidth - panelW;
    const left = Math.max(margin, Math.min(rect.left, docMaxX - DRAFT_WIDTH - margin));
    const below = rect.bottom + 6;
    const above = rect.top - 6 - formHEst;
    const fitsBelow = below + formHEst <= window.innerHeight - margin;
    const top = fitsBelow
      ? below
      : above >= margin
        ? above
        : Math.max(margin, window.innerHeight - formHEst - margin);
    setDraft({ anchor, top, left });
    applyDraftHighlight(anchor);
    // Clear the browser's native selection so we don't get two stacked highlights:
    // the OS/browser keeps the selection painted until the user clicks elsewhere, and
    // our Custom-Highlight repaint sits on top of it. Auto-focusing the form's textarea
    // doesn't collapse the document selection on its own.
    window.getSelection()?.removeAllRanges();
  });

  const clearDraft = useCallback(() => {
    setDraft(null);
    applyDraftHighlight(null);
  }, []);

  const onMouseUp = useEffectEvent((e: MouseEvent) => {
    if (inPanel(e.target)) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const anchor = buildTextAnchor(range);
    if (anchor) openDraft(anchor, range.getBoundingClientRect());
  });

  const onClick = useEffectEvent((e: MouseEvent) => {
    if (inPanel(e.target) || !e.altKey) return;
    const t = e.target;
    if (!(t instanceof Element) || !DOC().contains(t)) return;
    e.preventDefault();
    const el = t.closest(ALT_CLICK_TARGETS) ?? t;
    openDraft(buildElementAnchor(el), el.getBoundingClientRect());
  });

  useDocumentEvent("mouseup", onMouseUp);
  useDocumentEvent("click", onClick);

  return { draft, clearDraft };
}

// While Alt is held, outline the element a click would currently target — same
// resolution as useDraftCapture's onClick, so what you see is what you'd get.
export function useAltHoverPreview(): void {
  useEffect(() => {
    let target: Element | null = null;
    const clear = () => {
      target?.classList.remove("miru-el-preview");
      target = null;
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!e.altKey || inPanel(e.target)) return clear();
      const t = e.target;
      if (!(t instanceof Element) || !DOC().contains(t)) return clear();
      const next = t.closest(ALT_CLICK_TARGETS) ?? t;
      if (next === target) return;
      clear();
      target = next;
      target.classList.add("miru-el-preview");
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Alt") clear();
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("keyup", onKeyUp);
    // Alt released while window is out of focus would otherwise leave the outline stuck.
    window.addEventListener("blur", clear);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clear);
      clear();
    };
  }, []);
}

// Snapshot the current rendered document text into sessionStorage right before triggering
// a live reload. On the next page load the App reads it (once) and paints a transient
// highlight over what changed — the "did the agent apply my suggestion verbatim?" check.
// A no-op if the snapshot can't be written (private-browsing / storage quota).
function reloadWithSnapshot(): void {
  stashPreReloadText(docText(DOC()));
  location.reload();
}

// Debounce window for the "connection lost" banner. EventSource fires `onerror` on both
// terminal failures and transient blips (the browser's own auto-reconnect uses onerror →
// silent retry → onopen); only flip disconnected after this window to avoid flashing the
// banner during a normal reconnect.
const CONN_LOST_MS = 3000;

// Server -> client live updates: a file change forces a hard reload (CSS, anchors,
// document text are all derived from the served HTML); a comments change just refetches.
//
// Refetches are DEFERRED while the user is in IME composition. Re-rendering a
// controlled textarea (value={replyText}) mid-composition wipes the IME state —
// React's value-prop write trampling the browser's composition buffer — which is
// exactly the moment a CJK user is most exposed (any background SSE event during
// typing kills the in-flight characters). We listen for compositionstart/end at
// the document level and coalesce all pending refetches into one post-composition.
//
// Reloads are also DEFERRED while a draft form is open (`reloadDeferred`). A hard
// reload mid-draft would wipe what the user is typing, and the most likely moment a
// file change arrives is exactly when the user is reacting to it. When the draft
// closes (submit / cancel), the deferred reload flushes. Trade-off: the just-submitted
// comment may anchor against now-stale source; the staleness badge surfaces that.
export function useLiveReload(
  onCommentsChange: () => void,
  reloadDeferred = false,
): { connected: boolean } {
  const composingRef = useRef(false);
  const pendingCommentsRef = useRef(false);
  const pendingReloadRef = useRef(false);
  const [connected, setConnected] = useState(true);
  const disconnectTimerRef = useRef<number | null>(null);
  const handle = useEffectEvent((data: string) => {
    // `satisfies SseEvent` ties each literal to the contract type, so renaming an
    // event on the server side becomes a compile error here instead of a silent miss.
    if (data === ("reload" satisfies SseEvent)) {
      if (reloadDeferred) pendingReloadRef.current = true;
      else reloadWithSnapshot();
    } else if (data === ("comments" satisfies SseEvent)) {
      if (composingRef.current) pendingCommentsRef.current = true;
      else onCommentsChange();
    }
  });
  const flushPendingComments = useEffectEvent(() => {
    if (pendingCommentsRef.current) {
      pendingCommentsRef.current = false;
      onCommentsChange();
    }
  });

  // When `reloadDeferred` flips back to false (e.g. draft closes), fire any reload
  // that arrived while it was true. Runs once per false transition.
  useEffect(() => {
    if (!reloadDeferred && pendingReloadRef.current) {
      pendingReloadRef.current = false;
      reloadWithSnapshot();
    }
  }, [reloadDeferred]);

  useEffect(() => {
    const onStart = () => {
      composingRef.current = true;
    };
    const onEnd = () => {
      composingRef.current = false;
      flushPendingComments();
    };
    document.addEventListener("compositionstart", onStart);
    document.addEventListener("compositionend", onEnd);
    const es = new EventSource("/api/events");
    es.onmessage = (e) => handle(e.data);
    es.onopen = () => {
      if (disconnectTimerRef.current !== null) {
        window.clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
      }
      setConnected(true);
    };
    es.onerror = () => {
      if (disconnectTimerRef.current !== null) return;
      disconnectTimerRef.current = window.setTimeout(() => {
        setConnected(false);
        disconnectTimerRef.current = null;
      }, CONN_LOST_MS);
    };
    return () => {
      es.close();
      if (disconnectTimerRef.current !== null) {
        window.clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
      }
      document.removeEventListener("compositionstart", onStart);
      document.removeEventListener("compositionend", onEnd);
    };
    // `handle` / `flushPendingComments` are from useEffectEvent: they must not be in
    // deps (React rule).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { connected };
}

// Panel-wide keyboard shortcuts. Suppressed while the user is typing in a textarea
// or input (so j/k inside a reply form behave as letters, not navigation).
export function useKeyboardShortcuts(opts: {
  comments: HydratedComment[];
  activeId: string | null;
  focusComment: (id: string) => void;
  onCancelDraft: () => void;
  onResolveActive: () => void;
}): void {
  const handle = useEffectEvent((e: KeyboardEvent) => {
    const t = e.target;
    if (t instanceof Element && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) return;
    if (e.key === "Escape") {
      opts.onCancelDraft();
      return;
    }
    if (opts.comments.length === 0) return;
    if (e.key === "j" || e.key === "k") {
      e.preventDefault();
      const cur = opts.activeId ? opts.comments.findIndex((c) => c.id === opts.activeId) : -1;
      const nextIdx =
        e.key === "j" ? Math.min(opts.comments.length - 1, cur + 1) : Math.max(0, cur - 1);
      const id = opts.comments[nextIdx]?.id;
      if (id) opts.focusComment(id);
    }
    if (e.key === "r" && opts.activeId) opts.onResolveActive();
  });
  useDocumentEvent("keydown", handle);
}

// Draggable left-edge resizer for the side panel. Width lives on --miru-panel-w
// (read by both the panel itself and body's right-padding), so updating the CSS
// variable is enough — no React state, no per-frame re-render. Persisted to
// localStorage so the chosen width survives reloads.
const PANEL_W_KEY = "miru:panel-width";
// Lower bound chosen so the header row (open pill + resolved pill + Approve button) doesn't
// clip Approve off the right edge at the min. Bumped from 320 once the resolved pill gained
// a "resolved" label for symmetry with "open". Submit-review-while-staging can still squeeze
// past this when drafts exist — flex-wrap on the header would be the fuller fix.
const PANEL_W_MIN = 360;
// Capped at 70vw so a misclick can't swallow the document area entirely.
const PANEL_W_MAX_FRACTION = 0.7;

function clampPanelWidth(w: number): number {
  return Math.max(PANEL_W_MIN, Math.min(w, Math.floor(window.innerWidth * PANEL_W_MAX_FRACTION)));
}
function setPanelWidthVar(w: number): void {
  document.documentElement.style.setProperty("--miru-panel-w", `${w}px`);
}

export function usePanelResize(): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const saved = Number(localStorage.getItem(PANEL_W_KEY));
    if (Number.isFinite(saved) && saved > 0) setPanelWidthVar(clampPanelWidth(saved));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onDown = (e: PointerEvent) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      let width = clampPanelWidth(window.innerWidth - e.clientX);
      const onMove = (ev: PointerEvent) => {
        width = clampPanelWidth(window.innerWidth - ev.clientX);
        setPanelWidthVar(width);
      };
      const onUp = () => {
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointercancel", onUp);
        localStorage.setItem(PANEL_W_KEY, String(width));
      };
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onUp);
    };
    el.addEventListener("pointerdown", onDown);
    return () => el.removeEventListener("pointerdown", onDown);
  }, []);

  return ref;
}

// True when the event target is inside the miru panel (so the document-level
// listeners can ignore their own UI).
export function inPanel(t: EventTarget | null): boolean {
  return t instanceof Element && t.closest("#miru-root") !== null;
}
