// Keyboard helpers shared by the panel's forms (Card reply / DraftForm compose).
import type { KeyboardEvent } from "react";

// Mac-style ⌘ vs Windows/Linux Ctrl in kbd hint labels, picked from the platform at
// module load. Matches the metaKey/ctrlKey OR in submitOnModEnter below — both still
// fire either way; this is only the label the user sees.
const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
export const MOD_LABEL = IS_MAC ? "⌘" : "Ctrl";

// Cmd/Ctrl+Enter clicks the primary submitter. When a secondary button is passed,
// Cmd/Ctrl+Shift+Enter routes to it instead (DraftForm's "Save draft" variant).
// Each button's own `disabled` state still gates the click, so an empty/pending
// form is a no-op regardless of which submitter the key resolved to.
export function submitOnModEnter(
  e: KeyboardEvent<HTMLTextAreaElement>,
  primary: HTMLButtonElement | null,
  secondary: HTMLButtonElement | null = null,
): void {
  if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
  e.preventDefault();
  (e.shiftKey ? (secondary ?? primary) : primary)?.click();
}
