// Floating draft form rendered next to a fresh selection or Alt+clicked element.
// Pure presentation — App owns the draft state and the submit handler.
import { type KeyboardEvent, useActionState, useRef, useState } from "react";
import type { Anchor } from "@miru/contract";
import { popoverRef } from "./hooks.ts";

// Cmd/Ctrl+Enter clicks the primary (Comment) submit; Cmd/Ctrl+Shift+Enter clicks the
// "Add to review" draft submitter. Each button's disabled state still gates the click,
// so an empty/pending form is a no-op.
function submitOnModEnter(
  e: KeyboardEvent<HTMLTextAreaElement>,
  commentBtn: HTMLButtonElement | null,
  draftBtn: HTMLButtonElement | null,
) {
  if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
  e.preventDefault();
  (e.shiftKey ? draftBtn : commentBtn)?.click();
}

// Mac-style ⌘ vs Windows/Linux Ctrl in the button hint labels, picked from the platform
// at module load. matches the same metaKey/ctrlKey OR in submitOnModEnter — both still
// fire either way; this is only the label the user sees.
const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
const MOD = IS_MAC ? "⌘" : "Ctrl";
const COMMENT_KEY_LABEL = `${MOD} ⏎`;
const DRAFT_KEY_LABEL = `${MOD} ⇧ ⏎`;

// A pending comment being authored, positioned next to its selection/element.
export interface Draft {
  anchor: Anchor;
  top: number;
  left: number;
}

export function DraftForm(props: {
  draft: Draft;
  onCancel: () => void;
  // Awaited so a rejection keeps the form open with its text (server unreachable is
  // surfaced by the parent's toast — the reviewer's draft should not evaporate on retry).
  onSubmit: (body: string, suggestion: string, draft: boolean) => Promise<void> | void;
}) {
  const [body, setBody] = useState("");
  const [sug, setSug] = useState("");
  // Either field counts: a suggestion-only comment (replacement text without prose)
  // is a valid review interaction.
  const hasContent = !!(body.trim() || sug.trim());
  const commentRef = useRef<HTMLButtonElement>(null);
  const draftRef = useRef<HTMLButtonElement>(null);

  // The form is submitted by one of two submitter buttons — Comment (sends now) or
  // Add to review (stages it). React's form action collects the submitter's name/value
  // into FormData, so the action sees which button fired. Disabling on `pending` lets
  // the parent's async submit finish before a second click can fire.
  const [, submitAction, pending] = useActionState<null, FormData>(async (_prev, fd) => {
    if (!hasContent) return null;
    try {
      await props.onSubmit(body, sug, fd.get("intent") === "draft");
    } catch {
      /* parent toasts; body/suggestion text stays so the reviewer can retry */
    }
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
        Comment on {props.draft.anchor.type === "text" ? "text" : "element"}
      </div>
      <textarea
        className="miru-draft__body"
        value={body}
        placeholder="Comment (markdown)"
        aria-label="Comment (markdown)"
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => submitOnModEnter(e, commentRef.current, draftRef.current)}
      />
      <textarea
        className="miru-draft__sug"
        value={sug}
        placeholder="Suggestion (optional: replacement text)"
        aria-label="Suggestion (optional: replacement text)"
        onChange={(e) => setSug(e.target.value)}
        onKeyDown={(e) => submitOnModEnter(e, commentRef.current, draftRef.current)}
      />
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
          Add to review{" "}
          <kbd className="miru-btn-kbd" aria-hidden="true">
            {DRAFT_KEY_LABEL}
          </kbd>
        </button>
        <button
          ref={commentRef}
          type="submit"
          name="intent"
          value="comment"
          className="miru-primary"
          disabled={!hasContent || pending}
        >
          Comment{" "}
          <kbd className="miru-btn-kbd" aria-hidden="true">
            {COMMENT_KEY_LABEL}
          </kbd>
        </button>
      </div>
    </form>
  );
}
