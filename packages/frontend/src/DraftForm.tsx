// Floating draft form rendered next to a fresh selection or Alt+clicked element.
// Pure presentation — App owns the draft state and the submit handler.
import { useActionState, useRef, useState } from "react";
import type { Anchor } from "@miru/contract";
import { popoverRef } from "./hooks.ts";
import { MOD_LABEL, submitOnModEnter } from "./keys.ts";

const SEND_KEY_LABEL = `${MOD_LABEL} ⏎`;
const DRAFT_KEY_LABEL = `${MOD_LABEL} ⇧ ⏎`;

// A pending comment being authored, positioned next to its selection/element.
export interface Draft {
  anchor: Anchor;
  top: number;
  left: number;
}

export function DraftForm(props: {
  draft: Draft;
  onCancel: () => void;
  // Awaited only for the pending flag; must not throw. On failure the parent keeps the
  // draft open (this form stays mounted with its text) and surfaces a toast — the
  // reviewer's words should not evaporate on a network blip.
  onSubmit: (body: string, suggestion: string, draft: boolean) => Promise<void> | void;
}) {
  const [body, setBody] = useState("");
  const [sug, setSug] = useState("");
  // The suggestion section is collapsed by default — most comments are pure prose, so
  // hiding the field until asked keeps the form calm and steers the user toward the
  // primary "just leave a comment" flow. Element anchors don't get the toggle at all
  // (see below): replacement text against a whole element block is ambiguous.
  const [sugOpen, setSugOpen] = useState(false);
  const { anchor } = props.draft;
  // Suggestion is only submitted when the section is actually open — closing the toggle
  // discards it from the submission without wiping the state, so a re-open restores what
  // the user was writing. hasContent also reads from `effectiveSug` so a closed section
  // never unlocks the submit buttons on stale text.
  const effectiveSug = sugOpen ? sug : "";
  // Either field counts: a suggestion-only comment (replacement text without prose)
  // is a valid review interaction.
  const hasContent = !!(body.trim() || effectiveSug.trim());
  const sendRef = useRef<HTMLButtonElement>(null);
  const draftRef = useRef<HTMLButtonElement>(null);

  // The form is submitted by one of two submitter buttons — Send (posts now) or
  // Save draft (stages it). React's form action collects the submitter's name/value
  // into FormData, so the action sees which button fired. Disabling on `pending` lets
  // the parent's async submit finish before a second click can fire.
  const [, submitAction, pending] = useActionState<null, FormData>(async (_prev, fd) => {
    if (!hasContent) return null;
    await props.onSubmit(body, effectiveSug, fd.get("intent") === "draft");
    return null;
  }, null);

  return (
    <form
      className="miru-draft"
      popover="manual"
      ref={popoverRef}
      style={{ top: props.draft.top, left: props.draft.left }}
      action={submitAction}
      aria-labelledby="miru-draft-title"
      // Esc on the form (not just the document-level useKeyboardShortcuts handler) so the
      // Cancel button's <kbd>Esc</kbd> hint also fires while focus is in the body/suggestion
      // textareas — the document handler skips TEXTAREA targets so j/k stay typeable, but
      // that left the hint as a broken promise from the form's autoFocus state.
      // isComposing guard so IME-cancel-composition isn't treated as a form cancel.
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.nativeEvent.isComposing) {
          e.preventDefault();
          props.onCancel();
        }
      }}
    >
      <div id="miru-draft-title" className="miru-draft__type">
        Comment on {anchor.type === "text" ? "text" : "element"}
      </div>
      <textarea
        className="miru-draft__body"
        value={body}
        placeholder="Comment (markdown)"
        aria-label="Comment (markdown)"
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => submitOnModEnter(e, sendRef.current, draftRef.current)}
      />
      {/* Suggestion is a text-anchor concept: replacing the quoted range with new text.
          Element anchors (Alt+click on a whole <pre> / <img> / <table>) have no natural
          "before" text to replace, so the toggle isn't shown for them. */}
      {anchor.type === "text" &&
        (sugOpen ? (
          <div className="miru-draft__sug-section">
            <div className="miru-draft__sug-label">Before (selected)</div>
            <pre className="miru-draft__sug-before">{anchor.quote}</pre>
            <div className="miru-draft__sug-label">After</div>
            <textarea
              className="miru-draft__sug"
              value={sug}
              placeholder="Replacement text"
              aria-label="Suggested replacement (markdown)"
              onChange={(e) => setSug(e.target.value)}
              onKeyDown={(e) => submitOnModEnter(e, sendRef.current, draftRef.current)}
            />
            <button
              type="button"
              className="miru-draft__sug-toggle"
              onClick={() => setSugOpen(false)}
            >
              − remove suggestion
            </button>
          </div>
        ) : (
          <button type="button" className="miru-draft__sug-toggle" onClick={() => setSugOpen(true)}>
            + suggest a fix
          </button>
        ))}
      <div className="miru-draft__actions">
        <button type="button" onClick={props.onCancel}>
          Cancel{" "}
          <kbd className="miru-btn-kbd" aria-hidden="true">
            Esc
          </kbd>
        </button>
        <button
          ref={draftRef}
          type="submit"
          name="intent"
          value="draft"
          disabled={!hasContent || pending}
        >
          Save draft{" "}
          <kbd className="miru-btn-kbd" aria-hidden="true">
            {DRAFT_KEY_LABEL}
          </kbd>
        </button>
        <button
          ref={sendRef}
          type="submit"
          name="intent"
          value="comment"
          className="miru-primary"
          disabled={!hasContent || pending}
        >
          Send{" "}
          <kbd className="miru-btn-kbd" aria-hidden="true">
            {SEND_KEY_LABEL}
          </kbd>
        </button>
      </div>
    </form>
  );
}
