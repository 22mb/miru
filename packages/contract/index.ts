// Single source of truth for the API contract, shared by the Bun server and the
// browser frontend. The server validates request bodies against these schemas at
// runtime; both ends derive their TypeScript types from them (`z.infer`), so the
// wire shape cannot drift between front and back.
//
// The frontend imports *types only* from here, so the bundler erases this module
// (and zod) from the browser bundle — zod ships only in the server binary.
import { z } from "zod";

// Per-field length caps. Well above any legitimate use, but kill the DoS amplifier:
// without them a single ~128 MB POST body would be parsed, sanitized, persisted, and
// re-parsed on every loadReview.
const PROSE_MAX = 32_000; // body, reply, suggestion replacement
const SNIPPET_MAX = 4_096; // text-anchor quote/prefix/suffix
const LABEL_MAX = 2_048; // element-anchor selector/role/name/landmark/textHint, tagChain entry
const CHAIN_MAX = 256; // tagChain length
const ID_MAX = 64; // server-issued shortId
const PATH_MAX = 4_096; // file path
const ISO_DATE_MAX = 64; // ISO 8601 timestamp
const OFFSET_MAX = 1_000_000_000; // text offsets / element index — generous doc size cap

// ---------- domain (persisted + wire) ----------
export const TextAnchor = z.object({
  type: z.literal("text"),
  quote: z.string().max(SNIPPET_MAX),
  prefix: z.string().max(SNIPPET_MAX),
  suffix: z.string().max(SNIPPET_MAX),
  start: z.number().int().min(0).max(OFFSET_MAX),
  end: z.number().int().min(0).max(OFFSET_MAX),
});
export type TextAnchor = z.infer<typeof TextAnchor>;

export const ElementAnchor = z.object({
  type: z.literal("element"),
  selector: z.string().max(LABEL_MAX),
  tagChain: z.array(z.string().max(LABEL_MAX)).max(CHAIN_MAX),
  role: z.string().max(LABEL_MAX).nullable(),
  accessibleName: z.string().max(LABEL_MAX).nullable(),
  landmark: z.string().max(LABEL_MAX).nullable(),
  textHint: z.string().max(LABEL_MAX).nullable(),
  index: z.number().int().min(0).max(OFFSET_MAX),
});
export type ElementAnchor = z.infer<typeof ElementAnchor>;

export const Anchor = z.discriminatedUnion("type", [TextAnchor, ElementAnchor]);
export type Anchor = z.infer<typeof Anchor>;

export const Suggestion = z.object({ replacement: z.string().max(PROSE_MAX) });
export type Suggestion = z.infer<typeof Suggestion>;

// Who wrote a comment/reply. Drives the per-message author label in the panel so a
// thread that mixes the reviewer and the AI agent reads unambiguously.
export const Author = z.enum(["human", "agent"]);
export type Author = z.infer<typeof Author>;

export const Reply = z.object({
  id: z.string().max(ID_MAX),
  body: z.string().max(PROSE_MAX),
  createdAt: z.string().max(ISO_DATE_MAX),
  // Default keeps older sidecar files (written before `author` existed) parsing — they
  // were all human replies at the time, since the agent never wrote replies back then.
  author: Author.default("human"),
  // True while a human reply has been staged ("Add to review") but not yet sent. The
  // agent doesn't see draft replies in `miru next`. Promoted (set false) by
  // /api/review/submit; the parent comment's status also flips to "sent" then.
  // Default keeps pre-existing sidecars parsing.
  draft: z.boolean().default(false),
});
export type Reply = z.infer<typeof Reply>;

// Dispatch lifecycle, orthogonal to `resolved`:
//   draft    — staged in an unsubmitted review; not handed to the agent yet
//   sent     — submitted; awaiting the agent
//   answered — the agent has replied (set during the agent loop)
export const CommentStatus = z.enum(["draft", "sent", "answered"]);
export type CommentStatus = z.infer<typeof CommentStatus>;

export const Comment = z.object({
  id: z.string().max(ID_MAX),
  anchor: Anchor,
  body: z.string().max(PROSE_MAX),
  suggestion: Suggestion.nullable(),
  status: CommentStatus,
  resolved: z.boolean(),
  createdAt: z.string().max(ISO_DATE_MAX),
  // ISO 8601 of the most recent `miru next` delivery, or null if the agent has not
  // picked this comment up yet. Drives the "agent is reviewing" hint in the panel so
  // the human knows the agent has at least seen the comment. Cleared back to null on
  // status flips to "sent" (human re-reply or submit-review batch on drafts).
  // Default keeps sidecar files written before this field existed parsing.
  pickedUpAt: z.string().max(ISO_DATE_MAX).nullable().default(null),
  replies: z.array(Reply),
});
export type Comment = z.infer<typeof Comment>;

// Bump on breaking changes to the sidecar schema. Evolution policy:
//   - Additive: introduce a new field with `.default(...)`. Old sidecars keep parsing;
//     no version bump.
//   - Breaking (removes / retypes / makes-required a field): bump this constant and
//     add a migration branch in store.loadReview that transforms the older shape
//     forward.
// A sidecar whose `version` exceeds this constant surfaces as FutureSidecarError so the
// user sees "please upgrade miru" instead of a corruption error.
export const CURRENT_VERSION = 1;

export const ReviewFile = z.object({
  version: z.number().int(),
  target: z.string().max(PATH_MAX),
  // Explicit human verdict (the "Approve" action), separate from leaving comments.
  // Ends the agent loop; reset to false whenever new feedback is sent.
  // Defaults to false so older files written before the field existed still parse.
  approved: z.boolean().default(false),
  comments: z.array(Comment),
});
export type ReviewFile = z.infer<typeof ReviewFile>;

// ---------- request bodies (the untrusted inputs the server validates) ----------
export const CreateCommentBody = z.object({
  anchor: Anchor,
  body: z.string().max(PROSE_MAX),
  suggestion: Suggestion.nullish(),
  // true → stage in the current review ("Add to review"); false → send now ("Comment").
  draft: z.boolean().default(false),
});
export type CreateCommentBody = z.infer<typeof CreateCommentBody>;

// A comment the agent should act on: submitted (not a staged draft) and not yet resolved.
export function openForAgent(c: Comment): boolean {
  return !c.resolved && c.status !== "draft";
}

// A comment awaiting the agent's next response: submitted but not yet answered or resolved.
// Drives `miru next` (the agent loop) — re-notified to "sent" when a human replies.
export function awaitingAgent(c: Comment): boolean {
  return c.status === "sent" && !c.resolved;
}

// The agent-facing projection of a review — the external JSON contract emitted by
// `miru comments --json`, `miru next`, and the final `miru review` output. Centralized
// here so those three call sites cannot drift (they used to hand-build it three ways).
// The one rule: staged ("Add to review") replies stay hidden until submitted → draft
// replies stripped. Since the persisted shape has no bodyHtml (F-1), there's nothing
// else to hide.
export type AgentReply = Reply;
export type AgentComment = Omit<Comment, "replies"> & { replies: AgentReply[] };

export function agentView(
  review: ReviewFile,
  filter: (c: Comment) => boolean,
): { approved: boolean; comments: AgentComment[] } {
  return {
    approved: review.approved,
    comments: review.comments.filter(filter).map((c) => ({
      ...c,
      replies: c.replies.filter((r) => !r.draft),
    })),
  };
}

// ---------- wire hydrations (server → browser) ----------
// The browser panel injects a sanitized HTML render of `body` via
// dangerouslySetInnerHTML. That HTML is a pure derivation of `body` — cheap to
// re-render on every response, and *not* persisted (so a hostile committed sidecar
// can't smuggle markup through). The server attaches `bodyHtml` at response-assembly
// time using renderCommentBody. Consumers on the browser side (api.ts, Card.tsx,
// hooks.ts) type API responses with these Hydrated* shapes so bodyHtml stays required.
export type HydratedReply = Reply & { bodyHtml: string };
export type HydratedComment = Omit<Comment, "replies"> & {
  bodyHtml: string;
  replies: HydratedReply[];
};
export type HydratedReviewFile = Omit<ReviewFile, "comments"> & {
  comments: HydratedComment[];
};

// ---------- lifecycle transitions (pure) ----------
// Centralize the state-machine here so server routes and CLI commands cannot drift.

export interface BuildCommentInput {
  anchor: Anchor;
  body: string;
  suggestion: Suggestion | null;
  draft: boolean;
}

export function buildComment(input: BuildCommentInput, id: string, createdAt: string): Comment {
  return {
    id,
    anchor: input.anchor,
    body: input.body,
    suggestion: input.suggestion,
    status: input.draft ? "draft" : "sent",
    resolved: false,
    createdAt,
    pickedUpAt: null,
    replies: [],
  };
}

export interface AddReplyInput {
  id: string;
  body: string;
  author: Author;
  draft: boolean;
}

// Return a new comment with the reply appended and the author/draft-dependent status
// transition applied. A staged (draft) reply leaves status/pickedUpAt as-is. A non-draft
// human reply re-opens the round (status="sent", pickedUpAt=null). A non-draft agent
// reply answers the round (status="answered"). Approved lives at review scope, so
// callers pair this with dismissApproval() when a non-draft human reply lands.
export function addReply(comment: Comment, input: AddReplyInput, createdAt: string): Comment {
  const reply: Reply = {
    id: input.id,
    body: input.body,
    createdAt,
    author: input.author,
    draft: input.draft,
  };
  const replies = [...comment.replies, reply];
  if (input.draft) return { ...comment, replies };
  if (input.author === "agent") return { ...comment, replies, status: "answered" };
  return { ...comment, replies, status: "sent", pickedUpAt: null };
}

// Return a new review with all staged drafts (draft comments and draft replies)
// promoted to "sent" and pickedUpAt cleared on every touched comment so the fresh
// round looks unread to the agent. `submitted` is the number of comments promoted —
// 0 means nothing changed and callers can skip saveReview.
export function promoteDrafts(review: ReviewFile): { review: ReviewFile; submitted: number } {
  let submitted = 0;
  const comments = review.comments.map((c) => {
    let promoted = c.status === "draft";
    const replies = c.replies.map((r) => {
      if (!r.draft) return r;
      promoted = true;
      return { ...r, draft: false };
    });
    if (!promoted) return c;
    submitted++;
    return { ...c, replies, status: "sent" as const, pickedUpAt: null };
  });
  return { review: submitted > 0 ? { ...review, comments } : review, submitted };
}

// Return a new review with pickedUpAt=`now` on every comment whose id is in `ids`.
// `touched` is false when nothing matched — callers use it to skip saveReview.
export function stampPickedUp(
  review: ReviewFile,
  ids: Set<string>,
  now: string,
): { review: ReviewFile; touched: boolean } {
  let touched = false;
  const comments = review.comments.map((c) => {
    if (!ids.has(c.id)) return c;
    touched = true;
    return { ...c, pickedUpAt: now };
  });
  return { review: touched ? { ...review, comments } : review, touched };
}

// Return a new review with approved=true. The human's "Approve" verdict — ends the
// agent loop until fresh feedback dismisses it.
export function approve(review: ReviewFile): ReviewFile {
  return { ...review, approved: true };
}

// Return a new review with approved=false. New feedback (a fresh comment, a promoted
// draft, a non-draft human reply) unbids a prior "Approve" so the agent sees an
// active round.
export function dismissApproval(review: ReviewFile): ReviewFile {
  return { ...review, approved: false };
}

export const PatchCommentBody = z.object({
  body: z.string().max(PROSE_MAX).optional(),
  resolved: z.boolean().optional(),
  reply: z.string().max(PROSE_MAX).optional(),
  // Pair with `reply`: when true, the reply is staged (Reply.draft = true), the
  // parent comment's status / pickedUpAt are left untouched, and the agent does
  // NOT see this reply until /api/review/submit promotes it. Ignored when `reply`
  // is omitted.
  replyDraft: z.boolean().optional(),
  suggestion: Suggestion.nullable().optional(),
});
export type PatchCommentBody = z.infer<typeof PatchCommentBody>;
