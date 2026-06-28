// Review panel orchestration: composes the hooks that own state and effects, then
// renders the panel and the floating draft form. All non-trivial logic lives in
// hooks.ts (state/SSE/capture/shortcuts) and components/* (presentation).
import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import type { ReviewFile } from "@miru/contract";
import { api } from "./api.ts";
import { Card } from "./Card.tsx";
import { DraftForm } from "./DraftForm.tsx";
import { applyHighlights, applyPreviewHighlight } from "./highlight.ts";
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

export function App({ initialCommentsPromise }: { initialCommentsPromise: Promise<ReviewFile> }) {
  const c = useComments(initialCommentsPromise);
  const [showResolved, setShowResolved] = useState(false);
  const { draft, clearDraft } = useDraftCapture();
  useAltHoverPreview();
  const resizerRef = usePanelResize();

  useEffect(() => {
    applyHighlights(c.comments, c.activeId);
  }, [c.comments, c.activeId]);

  // Card hover → highlight that comment's anchor in the doc. Lifted to App so we don't
  // hand individual cards a reference to the highlight layer; they just call onHover with
  // their id (or null on leave). The applied highlight clears automatically when the
  // hovered card unmounts, since the leave event fires before unmount.
  const [previewId, setPreviewId] = useState<string | null>(null);
  useEffect(() => {
    const target = previewId ? c.comments.find((x) => x.id === previewId) : null;
    applyPreviewHighlight(target?.anchor ?? null);
  }, [previewId, c.comments]);

  // Defer file-change reloads while a draft is open — the reload wipes the textarea
  // contents and the file change is usually what the user is reacting to.
  useLiveReload(c.reload, !!draft);
  useKeyboardShortcuts({
    comments: c.comments,
    activeId: c.activeId,
    focusComment: c.focusComment,
    onCancelDraft: clearDraft,
    onResolveActive: () => {
      const active = c.comments.find((x) => x.id === c.activeId);
      if (active) void c.toggleResolved(active);
    },
  });

  const onSubmitDraft = async (body: string, suggestion: string, asDraft: boolean) => {
    if (!draft) return;
    await c.submit(draft.anchor, body, suggestion, asDraft);
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
    try {
      await api.approve();
    } catch {
      /* see comment above */
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
      if (!(e.target as Element | null)?.closest?.(".miru-approve")) disarmApprove();
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
    await c.submitReview();
    return null;
  }, null);

  const open = c.comments.filter((x) => !x.resolved).length;
  const resolved = c.comments.length - open;
  const drafts = c.comments.filter((x) => x.status === "draft").length;
  // Resolved comments are hidden by default — the toggle in the header restores them.
  // Wrap the state flip in View Transitions so the resolved cards morph in/out.
  const visible = showResolved ? c.comments : c.comments.filter((x) => !x.resolved);

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
      <aside
        className="miru-panel"
        popover="manual"
        ref={popoverRef}
        aria-label="miru review panel"
      >
        <div
          ref={resizerRef}
          className="miru-panel__resizer"
          role="separator"
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
                  onHover={setPreviewId}
                  onRemove={() => void c.remove(cm.id)}
                  onToggle={() => void c.toggleResolved(cm)}
                  onReply={(body) => void c.reply(cm.id, body)}
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
