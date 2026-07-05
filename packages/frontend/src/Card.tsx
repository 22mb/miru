// Single comment card with reply / resolve / delete actions. Pure presentation —
// App owns the comment state and passes handlers down.
import { type KeyboardEvent, type ReactNode, useActionState, useRef, useState } from "react";
import type { Author, HydratedComment } from "@miru/contract";

const AUTHOR_LABEL: Record<Author, string> = { human: "You", agent: "Agent" };

// Cmd/Ctrl+Enter on a textarea submits via its form's primary button. The button's
// disabled state still gates the click, so an empty/pending form is a no-op.
function submitOnModEnter(e: KeyboardEvent<HTMLTextAreaElement>, btn: HTMLButtonElement | null) {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    btn?.click();
  }
}

// A card action button that stops the click from also activating the card.
function ActionButton(props: { onClick: () => void; children: ReactNode; ariaPressed?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={props.ariaPressed}
      onClick={(e) => {
        e.stopPropagation();
        props.onClick();
      }}
    >
      {props.children}
    </button>
  );
}

export function Card(props: {
  comment: HydratedComment;
  active: boolean;
  stale: boolean;
  // True when this comment just received a new agent reply — drives a brief CSS pulse to
  // catch the eye if the user is mid-scroll. Cleared upstream after FRESH_REPLY_MS.
  fresh: boolean;
  onActivate: () => void;
  // Pointer hover into / out of the card. Lets App paint a transient preview highlight
  // on the corresponding anchor in the doc (call with the card's id on enter, null on
  // leave). Pure pointer hint — keyboard activation goes through onActivate.
  onHover: (id: string | null) => void;
  onRemove: () => void;
  onToggle: () => void;
  onReply: (body: string) => void;
}) {
  const c = props.comment;
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const trimmed = replyText.trim();
  const submitRef = useRef<HTMLButtonElement>(null);

  // Reply form action: trim, hand off to App, then close. useActionState gives us a
  // pending flag while the parent's async reply is in flight, so we can disable the
  // submit and avoid a double-post.
  const [, replyAction, replying] = useActionState<null, FormData>(async () => {
    if (!trimmed) return null;
    props.onReply(trimmed);
    setReplyText("");
    setReplyOpen(false);
    return null;
  }, null);

  return (
    <div
      className="miru-card"
      // Per-card view-transition-name lets the browser morph each card across reorders
      // (e.g. when one is resolved). The id is opaque (shortId), safe as an ident.
      style={{ viewTransitionName: `mc-${c.id}` }}
      tabIndex={0}
      aria-current={props.active ? "true" : undefined}
      data-resolved={c.resolved || undefined}
      data-draft={c.status === "draft" || undefined}
      data-fresh={props.fresh || undefined}
      onMouseEnter={() => props.onHover(c.id)}
      onMouseLeave={() => props.onHover(null)}
      onClick={props.onActivate}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          props.onActivate();
        }
      }}
    >
      <div className="miru-card__head">
        {c.status === "draft" && <span className="miru-draft-badge">draft</span>}
        {c.status === "sent" && (
          <span
            className={`miru-status miru-status--${c.pickedUpAt ? "reviewing" : "waiting"}`}
            title={
              c.pickedUpAt
                ? `Agent picked this up at ${new Date(c.pickedUpAt).toLocaleString()}`
                : "Sent — awaiting agent"
            }
          >
            <span className="miru-status__dot" aria-hidden="true" />
            {c.pickedUpAt ? "agent reviewing" : "waiting"}
          </span>
        )}
        {props.stale && <span className="miru-stale">stale</span>}
        <time dateTime={c.createdAt}>{new Date(c.createdAt).toLocaleString()}</time>
      </div>
      <div className="miru-card__body" dangerouslySetInnerHTML={{ __html: c.bodyHtml }} />
      {c.suggestion && <pre className="miru-suggestion">{c.suggestion.replacement}</pre>}
      {c.replies.length > 0 && (
        <div className="miru-replies">
          {c.replies.map((r) => (
            <div key={r.id} className={`miru-reply miru-reply--${r.author}`}>
              <div className="miru-reply__author">{AUTHOR_LABEL[r.author]}</div>
              <div className="miru-reply__body" dangerouslySetInnerHTML={{ __html: r.bodyHtml }} />
            </div>
          ))}
        </div>
      )}
      <div className="miru-card__actions">
        <ActionButton onClick={() => setReplyOpen((v) => !v)} ariaPressed={replyOpen}>
          Reply
        </ActionButton>
        <ActionButton onClick={props.onToggle} ariaPressed={c.resolved}>
          {c.resolved ? "reopen" : "resolve"}
        </ActionButton>
        <ActionButton onClick={props.onRemove}>Delete</ActionButton>
      </div>
      {replyOpen && (
        <form className="miru-reply-form" onClick={(e) => e.stopPropagation()} action={replyAction}>
          <textarea
            autoFocus
            value={replyText}
            placeholder="Reply (markdown)"
            aria-label="Reply (markdown)"
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={(e) => submitOnModEnter(e, submitRef.current)}
          />
          <div className="miru-reply-form__actions">
            <button type="button" onClick={() => setReplyOpen(false)}>
              Cancel
            </button>
            <button
              ref={submitRef}
              type="submit"
              className="miru-primary"
              disabled={!trimmed || replying}
            >
              Reply
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
