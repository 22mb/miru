// Shared fixtures for frontend *.test.tsx.
import type { Comment, Reply } from "@miru/contract";

// A Comment with sensible defaults; override any field (including `anchor`) via `over`.
export function makeComment(over: Partial<Comment> = {}): Comment {
  return {
    id: "c1",
    anchor: { type: "text", quote: "q", prefix: "", suffix: "", start: 0, end: 1 },
    body: "b",
    bodyHtml: "<p>b</p>",
    suggestion: null,
    status: "sent",
    resolved: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    pickedUpAt: null,
    replies: [],
    ...over,
  };
}

export function makeReply(over: Partial<Reply> = {}): Reply {
  return {
    id: "r1",
    body: "r",
    bodyHtml: "<p>r</p>",
    createdAt: "2026-01-01T00:00:00.000Z",
    author: "human",
    draft: false,
    ...over,
  };
}
