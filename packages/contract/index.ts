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
const BODY_HTML_MAX = 128_000; // sanitized HTML derived from PROSE; ~4x to allow markup expansion
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
  bodyHtml: z.string().max(BODY_HTML_MAX),
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
  bodyHtml: z.string().max(BODY_HTML_MAX),
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
