// Shared fixtures for frontend *.test.tsx.
// The panel consumes hydrated wire shapes (bodyHtml required), not the persisted
// domain types — fixtures reflect that so tests exercise the same shape components see.
import type { HydratedComment, HydratedReply } from "@miru/contract";

export function makeComment(over: Partial<HydratedComment> = {}): HydratedComment {
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

export function makeReply(over: Partial<HydratedReply> = {}): HydratedReply {
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
