// Review panel orchestration: composes the hooks that own state and effects, then
// renders the panel and the floating draft form. All non-trivial logic lives in
// hooks.ts (state/SSE/capture/shortcuts) and components/* (presentation).
import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import type { HydratedReviewFile } from "@miru/contract";
import { api } from "./api.ts";
import { Card } from "./Card.tsx";
import { DraftForm } from "./DraftForm.tsx";
import { DOC, docText } from "./dom.ts";
import { applyChangedHighlight, applyHighlights, applyPreviewHighlight } from "./highlight.ts";
import {
  popoverRef,
  useAltHoverPreview,
  useComments,
  useDraftCapture,
  useKeyboardShortcuts,
  useLiveReload,
  usePanelResize,
  withViewTransition,
} from "./hooks.ts";

// If the reviewed doc grew or shrunk enough that the "changed region" is a large fraction
// of the current text, the prefix/suffix diff is almost certainly conflating unrelated
// edits — better to skip the highlight than to paint most of the page. The chip still
// fires (the reviewer knows the reload landed) so they aren't left wondering.
const MAX_CHANGED_FRACTION = 0.2;
// How long the changed highlight stays painted before clearing itself. Long enough to
// register visually, short enough that it doesn't linger past the moment of relevance.
const CHANGED_FLASH_MS = 3000;
// How long a failure toast stays up before clearing itself.
const TOAST_MS = 4000;

export function App({
  initialCommentsPromise,
  changedRange,
}: {
  initialCommentsPromise: Promise<HydratedReviewFile>;
  // Post-live-reload diff, computed once per page load in index.tsx (the snapshot
  // consumption is single-shot, so it can't live in an effect). Null when this load
  // wasn't a live reload or nothing changed.
  changedRange: { start: number; end: number } | null;
}) {
  const c = useComments(initialCommentsPromise);
  const [showResolved, setShowResolved] = useState(false);
  const { draft, clearDraft } = useDraftCapture();
  useAltHoverPreview();
  const resizerRef = usePanelResize();

  useEffect(() => {
    applyHighlights(c.comments, c.activeId);
  }, [c.comments, c.activeId]);

  // Surface "your turn" from another window: prefix the tab title with (N) where N is the
  // count of comments the agent has answered but the human hasn't resolved yet. The
  // cleanup restores the unprefixed title so remounts (tests / hot reload) can't stack
  // `(N)` prefixes.
  useEffect(() => {
    const needsYou = c.comments.filter((x) => x.status === "answered" && !x.resolved).length;
    const original = document.title.replace(/^\(\d+\)\s+/, "");
    document.title = needsYou > 0 ? `(${needsYou}) ${original}` : original;
    return () => {
      document.title = original;
    };
  }, [c.comments]);

  // Post-live-reload flash: paint the changed range for CHANGED_FLASH_MS and show the
  // chip. Consuming the snapshot and diffing happen once per page load in index.tsx;
  // what remains here is an idempotent paint + timer with full cleanup, so a remount
  // (StrictMode, tests) repaints instead of losing the flash. The highlight is dropped
  // when the diff is too coarse to be useful (see MAX_CHANGED_FRACTION); the chip still
  // fires so the reviewer knows the reload landed.
  const [changedChip, setChangedChip] = useState(changedRange !== null);
  useEffect(() => {
    if (!changedRange) return;
    const span = changedRange.end - changedRange.start;
    const len = docText(DOC()).length;
    if (len > 0 && span / len <= MAX_CHANGED_FRACTION) applyChangedHighlight(changedRange);
    const t = window.setTimeout(() => {
      applyChangedHighlight(null);
      setChangedChip(false);
    }, CHANGED_FLASH_MS);
    return () => {
      window.clearTimeout(t);
      applyChangedHighlight(null);
    };
  }, [changedRange]);

  // Card hover → highlight that comment's anchor in the doc, painted straight from the
  // event handler — same reasoning as the draft highlight in useDraftCapture: every
  // transition is user-driven, so a state + effect round-trip would be derived
  // bookkeeping (and a full App re-render per hover). Lifted to App so cards don't hold
  // a reference to the highlight layer. One gap an effect would have covered: deleting
  // the hovered card fires no mouseleave — the onRemove wrapper below clears explicitly.
  const onCardHover = (id: string | null) => {
    const target = id ? c.comments.find((x) => x.id === id) : null;
    applyPreviewHighlight(target?.anchor ?? null);
  };

  // Defer file-change reloads while a draft is open — the reload wipes the textarea
  // contents and the file change is usually what the user is reacting to.
  const { connected } = useLiveReload(c.reload, !!draft);

  // Transient toast for API save failures (the API call throws; we surface it here).
  // Only one at a time — a second failure replaces the message rather than stacking; the
  // review loop doesn't have parallel writes worth queuing. Auto-clears after TOAST_MS.
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const notify = useCallback((msg: string) => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    setToast(msg);
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, TOAST_MS);
  }, []);
  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    };
  }, []);
  // Wrap an async mutator so a rejection surfaces as a toast; resolves true on success,
  // false on failure. A boolean instead of a re-throw so no caller can forget to catch —
  // fire-and-forget callers (delete / resolve) just drop the flag, callers that keep
  // their form open on failure (reply / draft submit) branch on it.
  const guard = useCallback(
    <A extends unknown[]>(fn: (...args: A) => Promise<unknown>, msg: string) =>
      async (...args: A): Promise<boolean> => {
        try {
          await fn(...args);
          return true;
        } catch {
          notify(msg);
          return false;
        }
      },
    [notify],
  );

  // Resolved comments are hidden by default — the toggle in the header restores them.
  // Derived before the keyboard hook so j/k navigate exactly what's rendered; feeding
  // the full list would let navigation land on a hidden resolved card (a silent scroll
  // with no visible focus).
  const visible = showResolved ? c.comments : c.comments.filter((x) => !x.resolved);

  useKeyboardShortcuts({
    comments: visible,
    activeId: c.activeId,
    focusComment: c.focusComment,
    onCancelDraft: clearDraft,
    onResolveActive: () => {
      const active = c.comments.find((x) => x.id === c.activeId);
      if (active) void guard(c.toggleResolved, "Couldn't update — server unreachable")(active);
    },
  });

  const onSubmitDraft = async (body: string, suggestion: string, asDraft: boolean) => {
    if (!draft) return;
    const saved = await guard(
      () => c.submit(draft.anchor, body, suggestion, asDraft),
      "Couldn't save — server unreachable",
    )();
    // On failure keep the draft (and its text) open for a retry — only the toast fires.
    if (!saved) return;
    clearDraft();
    window.getSelection()?.removeAllRanges();
  };

  // Approve = the explicit verdict that ends the review loop. Two-step inline confirm:
  // 1st click arms (label morphs to "Sure?" and tints warning), 2nd click commits.
  // Click outside or Esc disarms; auto-disarms after 4s so the loaded state doesn't
  // outlive the user's intent. The useActionState pending flag still covers the
  // in-flight window after the confirming click, so a quick second confirm-click is
  // harmless. The server may close the connection right after approving; swallow that —
  // the verdict has still registered.
  const [armed, setArmed] = useState(false);
  const armedTimerRef = useRef<number | null>(null);
  const disarmApprove = useCallback(() => {
    setArmed(false);
    if (armedTimerRef.current !== null) {
      window.clearTimeout(armedTimerRef.current);
      armedTimerRef.current = null;
    }
  }, []);
  const [approved, approveAction, approving] = useActionState<boolean>(async () => {
    if (!armed) {
      setArmed(true);
      if (armedTimerRef.current !== null) window.clearTimeout(armedTimerRef.current);
      armedTimerRef.current = window.setTimeout(() => setArmed(false), 4000);
      return false;
    }
    // Two failure paths look different to the reviewer:
    //   1. The connection dropped (SSE onerror already banner'd) — the request fails with a
    //      network error before ever reaching the server. In that case `connected` is false
    //      here, and swallowing keeps a stale "Approved" from flashing on a lost server.
    //   2. The server closed the connection immediately after accepting the approval
    //      (the terminal narration prints `{approved:true,…}` and the process exits — the
    //      HTTP response may be aborted). That looks identical to (1) from fetch()'s point
    //      of view. We still want the banner to appear so the reviewer knows the terminal
    //      is where to look next; the useActionState resolves true.
    // Toast only on (1). (2) is the designed end of the loop, not a failure.
    try {
      await api.approve();
    } catch {
      if (!connected) notify("Couldn't approve — server unreachable");
    }
    disarmApprove();
    return true;
  }, false);

  // Disarm on any click that isn't the Approve button, or on Esc. Prevents a stale
  // armed state from turning a casual later click into an accidental commit. Only
  // installed while armed so the panel doesn't pay for these listeners by default.
  useEffect(() => {
    if (!armed) return;
    const onDown = (e: MouseEvent) => {
      // composedPath()[0], not target: the confirming click on Approve retargets to the
      // shadow host at document level — target-based matching would disarm right before
      // the click lands, turning every second click into a re-arm.
      const t = e.composedPath()[0];
      if (!(t instanceof Element && t.closest(".miru-approve"))) disarmApprove();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") disarmApprove();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [armed, disarmApprove]);

  // Submit-review is a form action so we get pending state for free (used to disable the
  // button while in flight, avoiding double submits).
  const [, submitReviewAction, submittingReview] = useActionState<null>(async () => {
    try {
      await c.submitReview();
    } catch {
      notify("Couldn't submit review — server unreachable");
    }
    return null;
  }, null);

  const open = c.comments.filter((x) => !x.resolved).length;
  const resolved = c.comments.length - open;
  const drafts = c.comments.filter((x) => x.status === "draft").length;

  return (
    <>
      {approved && (
        <div
          className="miru-finished"
          popover="manual"
          ref={popoverRef}
          role="status"
          aria-live="polite"
        >
          Approved — return to your terminal (the AI agent).
        </div>
      )}
      {draft && <DraftForm draft={draft} onCancel={clearDraft} onSubmit={onSubmitDraft} />}
      {toast && (
        <div
          className="miru-toast"
          popover="manual"
          ref={popoverRef}
          role="status"
          aria-live="polite"
        >
          {toast}
        </div>
      )}
      {changedChip && (
        // Top-layer popover like the toast — a light-DOM z-index would lose to any
        // document CSS stacking games now that document <style> passes sanitization.
        <div
          className="miru-changed-chip"
          popover="manual"
          ref={popoverRef}
          role="status"
          aria-live="polite"
        >
          Doc updated — change highlighted
        </div>
      )}
      <aside
        className="miru-panel"
        popover="manual"
        ref={popoverRef}
        aria-label="miru review panel"
      >
        {!connected && (
          <div className="miru-banner" role="status" aria-live="polite">
            <span>Connection lost — the review session may have ended.</span>
          </div>
        )}
        {/* Focusable so the separator role keeps its promise: arrow keys resize (see
            usePanelResize), which also maintains aria-valuenow/min/max imperatively. */}
        <div
          ref={resizerRef}
          className="miru-panel__resizer"
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label="Resize panel"
        />
        <header className="miru-panel__head">
          <span
            className="miru-count"
            data-empty={open === 0 || undefined}
            aria-label={`${open} unresolved comment${open === 1 ? "" : "s"}`}
          >
            {/* Octicons "comment" — single-path SVG, no asset round-trip. */}
            <svg
              className="miru-count__icon"
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Z" />
            </svg>
            <span className="miru-count__label">open</span>
            <span className="miru-count__n">{open}</span>
          </span>
          {resolved > 0 && (
            <button
              type="button"
              className="miru-count miru-count--resolved"
              // View transition name so the pill morphs in/out when resolved crosses zero.
              style={{ viewTransitionName: "miru-resolved-toggle" }}
              data-pressed={showResolved || undefined}
              aria-pressed={showResolved}
              aria-label={`${showResolved ? "Hide" : "Show"} ${resolved} resolved comment${resolved === 1 ? "" : "s"}`}
              onClick={() => withViewTransition(() => setShowResolved((v) => !v))}
            >
              {/* Octicons "check-circle" — checkmark-in-circle, matches GitHub's resolved state. */}
              <svg
                className="miru-count__icon"
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M8 16A8 8 0 1 1 8 0a8 8 0 0 1 0 16Zm3.78-9.72a.751.751 0 0 0-.018-1.042.751.751 0 0 0-1.042-.018L6.75 9.19 5.28 7.72a.751.751 0 0 0-1.042.018.751.751 0 0 0-.018 1.042l2 2a.75.75 0 0 0 1.06 0Z" />
              </svg>
              <span className="miru-count__label">resolved</span>
              <span className="miru-count__n">{resolved}</span>
            </button>
          )}
          <div className="miru-head-actions">
            {drafts > 0 && (
              <form className="miru-head-form" action={submitReviewAction}>
                <button
                  type="submit"
                  className="miru-submit-review"
                  // VT name so the button morphs in/out on the drafts==0 boundary.
                  style={{ viewTransitionName: "miru-submit-review" }}
                  disabled={submittingReview}
                  aria-label={`Submit ${drafts} staged draft comment${drafts === 1 ? "" : "s"} to the agent`}
                >
                  Submit review ({drafts})
                </button>
              </form>
            )}
            <form className="miru-head-form" action={approveAction}>
              <button
                type="submit"
                className="miru-approve"
                data-armed={armed || undefined}
                disabled={approved || approving}
                aria-label={
                  armed ? "Click again to approve and end the review" : "Approve and end the review"
                }
              >
                {armed ? "Sure?" : "Approve"}
              </button>
            </form>
          </div>
        </header>
        {visible.length === 0 ? (
          <div className="miru-panel__list">
            <p className="miru-empty">
              Select text to comment, or <kbd>Alt</kbd>+click an element.
            </p>
          </div>
        ) : (
          <ul
            className="miru-panel__list"
            aria-label={`${visible.length} comment${visible.length === 1 ? "" : "s"}`}
          >
            {visible.map((cm) => (
              <li key={cm.id} className="miru-panel__item">
                <Card
                  comment={cm}
                  active={cm.id === c.activeId}
                  stale={c.staleIds.has(cm.id)}
                  fresh={c.freshReplyIds.has(cm.id)}
                  onActivate={() => c.focusComment(cm.id)}
                  onHover={onCardHover}
                  onRemove={() => {
                    // The card vanishes under the pointer — mouseleave never fires,
                    // so clear the hover preview explicitly.
                    applyPreviewHighlight(null);
                    void guard(c.remove, "Couldn't delete — server unreachable")(cm.id);
                  }}
                  onToggle={() =>
                    void guard(c.toggleResolved, "Couldn't update — server unreachable")(cm)
                  }
                  onReply={(body) =>
                    guard(c.reply, "Couldn't save — server unreachable")(cm.id, body)
                  }
                />
              </li>
            ))}
          </ul>
        )}
        {/* Always-visible shortcut reminder — the empty state's hint disappears the
            moment a comment exists, but j/k/r/Esc keep working. */}
        <footer className="miru-panel__foot" aria-label="keyboard shortcuts">
          <kbd>j</kbd>/<kbd>k</kbd> navigate · <kbd>r</kbd> resolve · <kbd>Esc</kbd> cancel draft
        </footer>
      </aside>
    </>
  );
}
