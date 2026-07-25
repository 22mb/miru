// Command logic for the `miru` CLI, split out of cli.ts so it can be imported —
// and tested — without executing the entry script (cli.ts runs on import; this
// module must never import it back). cli.ts keeps arg parsing, stdout/stderr,
// process.exit and the long-running `review` orchestration; everything here takes
// values and returns values, with the corruption-handling review loader injected
// where a command reads the sidecar.
import { existsSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  addReply,
  agentView,
  awaitingAgent,
  openForAgent,
  stampPickedUp,
  type AgentComment,
  type ReviewFile,
} from "@miru/contract";
import { updateReview, watchFile } from "@miru/server";

// ---------- comments ----------
// The full stdout payload of `miru comments`. The --json shape is agentView over
// openForAgent — the same projection `miru review` prints on approve, so the two
// commands can't drift (cli.ts calls this with json=true there).
export function commentsOutput(review: ReviewFile, json: boolean): string {
  if (json) return JSON.stringify(agentView(review, openForAgent), null, 2);
  const unresolved = review.comments.filter(openForAgent);
  if (unresolved.length === 0) return "No unresolved comments.";
  return unresolved
    .map((c) => {
      const loc = c.anchor.type === "text" ? `"${c.anchor.quote}"` : c.anchor.selector;
      const sug = c.suggestion ? `\n  suggestion: ${c.suggestion.replacement}` : "";
      return `- [${c.id}] (${c.anchor.type}) ${loc}\n  ${c.body}${sug}`;
    })
    .join("\n");
}

// ---------- comment (reply / resolve) ----------
export interface CommentUpdate {
  targetId: string;
  /** When set, append an agent reply with this body. */
  replyBody?: string | undefined;
  /** When true, mark the comment resolved. */
  resolve: boolean;
}

// The load-mutate-save body of `miru comment`, pure — the reply id and timestamp
// are the caller's. `miru comment --reply-to` is how the agent loop posts back; the
// browser never goes through this path, so the author is always the agent here and
// the reply is never staged (addReply flips status to "answered"). `result` is the
// updated comment's id, or null when the target doesn't exist (the review is then
// returned by identity, so updateReview skips the save).
export function applyCommentUpdate(
  loaded: ReviewFile,
  update: CommentUpdate,
  replyId: string,
  now: string,
): { review: ReviewFile; result: string | null } {
  const existing = loaded.comments.find((c) => c.id === update.targetId);
  if (!existing) return { review: loaded, result: null };
  let comment = existing;
  if (update.replyBody !== undefined) {
    comment = addReply(
      comment,
      { id: replyId, body: update.replyBody, author: "agent", draft: false },
      now,
    );
  }
  if (update.resolve) comment = { ...comment, resolved: true };
  return {
    review: {
      ...loaded,
      comments: loaded.comments.map((c) => (c.id === update.targetId ? comment : c)),
    },
    result: comment.id,
  };
}

// ---------- install ----------
export type InstallResult = { ok: true; dest: string } | { ok: false; error: string };

// Write the bundled SKILL.md into `skillsDir`. Refuses to write through a symlink
// at the destination — defends against a planted symlink redirecting the write to
// (e.g.) ~/.bashrc.
export function installSkill(skillsDir: string, content: string): InstallResult {
  mkdirSync(skillsDir, { recursive: true });
  const dest = join(skillsDir, "SKILL.md");
  if (existsSync(dest) && lstatSync(dest).isSymbolicLink()) {
    return { ok: false, error: `refusing to write through a symlink at ${dest}` };
  }
  writeFileSync(dest, content);
  return { ok: true, dest };
}

// ---------- next ----------
export interface AgentSnapshot {
  approved: boolean;
  comments: AgentComment[];
}

// The body of `miru next`: block until comments await the agent (or the human has
// approved), stamp pickedUpAt on what's being handed over, and return the snapshot.
// `load` is injected so cli.ts can pass its exit-on-corruption wrapper while tests
// use the raw loadReview.
export async function awaitAgentTurn(
  file: string,
  load: (file: string) => Promise<ReviewFile>,
): Promise<AgentSnapshot> {
  // agentView strips staged ("Save draft") replies — the human is still composing
  // drafts and /api/review/submit hasn't promoted them, so the agent shouldn't react.
  const snapshot = async () => agentView(await load(file), awaitingAgent);
  let s = await snapshot();
  if (!s.approved && s.comments.length === 0) {
    // Watch the directory (not the sidecar itself: saveReview's atomic rename swaps
    // the inode) and re-check until something awaits the agent or the human approves.
    s = await new Promise<AgentSnapshot>((resolve) => {
      const stop = watchFile(dirname(file), async () => {
        const next = await snapshot();
        if (next.approved || next.comments.length > 0) {
          stop();
          resolve(next);
        }
      });
    });
  }
  // Stamp picked-up comments so the panel can show "agent is reviewing". Reuse the
  // full review (not the filtered snapshot) so unrelated comments stay intact.
  // Each `miru next` refreshes the timestamp; the value is descriptive, not strictly
  // semantic — a stale stamp on a crashed agent looks like "still reviewing", which
  // the human can interpret with a relative-time hint in the UI.
  if (s.comments.length > 0) {
    const ids = new Set(s.comments.map((c) => c.id));
    const now = new Date().toISOString();
    // stampPickedUp returns the same review reference when nothing matched, so
    // updateReview's identity check skips the save in that case.
    await updateReview(file, (loaded) => {
      const { review } = stampPickedUp(loaded, ids, now);
      return { review, result: undefined };
    });
  }
  return s;
}
