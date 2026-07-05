import { describe, expect, test } from "bun:test";
import {
  addReply,
  agentView,
  approve,
  awaitingAgent,
  buildComment,
  Comment,
  CreateCommentBody,
  dismissApproval,
  openForAgent,
  PatchCommentBody,
  promoteDrafts,
  ReviewFile,
  stampPickedUp,
  TextAnchor,
  type Reply,
} from "./index.ts";

const textAnchor = {
  type: "text" as const,
  quote: "q",
  prefix: "p",
  suffix: "s",
  start: 0,
  end: 1,
};

describe("TextAnchor", () => {
  test("accepts a valid anchor", () => {
    expect(TextAnchor.safeParse(textAnchor).success).toBe(true);
  });

  test("rejects wrong discriminator", () => {
    expect(TextAnchor.safeParse({ ...textAnchor, type: "element" }).success).toBe(false);
  });

  test("rejects missing fields", () => {
    expect(TextAnchor.safeParse({ type: "text", quote: "q" }).success).toBe(false);
  });

  test("rejects a negative offset", () => {
    expect(TextAnchor.safeParse({ ...textAnchor, start: -1 }).success).toBe(false);
  });

  test("rejects a non-integer offset", () => {
    expect(TextAnchor.safeParse({ ...textAnchor, start: 1.5 }).success).toBe(false);
  });

  test("rejects a quote past the snippet cap", () => {
    expect(TextAnchor.safeParse({ ...textAnchor, quote: "x".repeat(4097) }).success).toBe(false);
  });
});

describe("CreateCommentBody", () => {
  test("accepts minimum body and defaults draft=false", () => {
    const parsed = CreateCommentBody.safeParse({ anchor: textAnchor, body: "hi" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.draft).toBe(false);
  });

  test("rejects missing anchor", () => {
    expect(CreateCommentBody.safeParse({ body: "hi" }).success).toBe(false);
  });

  test("rejects non-string body", () => {
    expect(CreateCommentBody.safeParse({ anchor: textAnchor, body: 42 }).success).toBe(false);
  });

  test("rejects a body past the prose cap (DoS guard)", () => {
    expect(
      CreateCommentBody.safeParse({ anchor: textAnchor, body: "x".repeat(32_001) }).success,
    ).toBe(false);
  });

  test("rejects a suggestion replacement past the prose cap", () => {
    expect(
      CreateCommentBody.safeParse({
        anchor: textAnchor,
        body: "hi",
        suggestion: { replacement: "x".repeat(32_001) },
      }).success,
    ).toBe(false);
  });
});

describe("PatchCommentBody", () => {
  test("accepts an empty patch (all fields optional)", () => {
    expect(PatchCommentBody.safeParse({}).success).toBe(true);
  });

  test("accepts a partial patch with reply only", () => {
    expect(PatchCommentBody.safeParse({ reply: "ok" }).success).toBe(true);
  });

  test("rejects wrong field types", () => {
    expect(PatchCommentBody.safeParse({ resolved: "yes" }).success).toBe(false);
  });
});

describe("ReviewFile", () => {
  test("defaults approved to false when missing (backwards compat)", () => {
    const parsed = ReviewFile.safeParse({
      version: 1,
      target: "doc.md",
      comments: [],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.approved).toBe(false);
  });

  test("rejects bogus comments shape", () => {
    expect(
      ReviewFile.safeParse({
        version: 1,
        target: "doc.md",
        approved: false,
        comments: [{ id: "x" }],
      }).success,
    ).toBe(false);
  });
});

describe("Comment", () => {
  const valid = {
    id: "c1",
    anchor: textAnchor,
    body: "hi",
    suggestion: null,
    status: "sent" as const,
    resolved: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    replies: [],
  };

  test("accepts a valid comment", () => {
    expect(Comment.safeParse(valid).success).toBe(true);
  });

  test("rejects an invalid status", () => {
    expect(Comment.safeParse({ ...valid, status: "weird" }).success).toBe(false);
  });

  test("strips bodyHtml if present (not a persisted field)", () => {
    const parsed = Comment.safeParse({ ...valid, bodyHtml: "<script>steal()</script>" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect("bodyHtml" in parsed.data).toBe(false);
  });
});

describe("agentView", () => {
  const comment = (over: Partial<Comment> = {}): Comment => ({
    id: "c1",
    anchor: textAnchor,
    body: "hi",
    suggestion: null,
    status: "sent",
    resolved: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    pickedUpAt: null,
    replies: [],
    ...over,
  });
  const reply = (over: Partial<Reply> = {}): Reply => ({
    id: "r1",
    body: "ok",
    createdAt: "2026-01-01T00:00:00.000Z",
    author: "human",
    draft: false,
    ...over,
  });
  const review = (comments: Comment[], approved = false): ReviewFile => ({
    version: 1,
    target: "doc.md",
    approved,
    comments,
  });

  test("strips staged draft replies but keeps non-draft replies", () => {
    const view = agentView(
      review([
        comment({
          replies: [reply({ id: "r-sent" }), reply({ id: "r-draft", draft: true })],
        }),
      ]),
      openForAgent,
    );
    expect(view.comments[0]!.replies.map((r) => r.id)).toEqual(["r-sent"]);
  });

  test("filter substitution: openForAgent vs awaitingAgent", () => {
    const r = review([
      comment({ id: "sent", status: "sent" }),
      comment({ id: "answered", status: "answered" }),
      comment({ id: "draft", status: "draft" }),
    ]);
    expect(agentView(r, openForAgent).comments.map((c) => c.id)).toEqual(["sent", "answered"]);
    expect(agentView(r, awaitingAgent).comments.map((c) => c.id)).toEqual(["sent"]);
  });

  test("passes through approved verbatim", () => {
    expect(agentView(review([], true), openForAgent).approved).toBe(true);
  });
});

describe("lifecycle transitions", () => {
  const anchor = textAnchor;
  const mkComment = (over: Partial<Comment> = {}): Comment => ({
    id: "c1",
    anchor,
    body: "hi",
    suggestion: null,
    status: "sent",
    resolved: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    pickedUpAt: null,
    replies: [],
    ...over,
  });
  const mkReview = (comments: Comment[], approved = false): ReviewFile => ({
    version: 1,
    target: "doc.md",
    approved,
    comments,
  });

  describe("buildComment", () => {
    test("input.draft=false → status=sent", () => {
      const c = buildComment(
        { anchor, body: "hi", suggestion: null, draft: false },
        "c1",
        "2026-01-01T00:00:00.000Z",
      );
      expect(c).toEqual({
        id: "c1",
        anchor,
        body: "hi",
        suggestion: null,
        status: "sent",
        resolved: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        pickedUpAt: null,
        replies: [],
      });
    });
    test("input.draft=true → status=draft", () => {
      const c = buildComment(
        { anchor, body: "hi", suggestion: { replacement: "x" }, draft: true },
        "c1",
        "2026-01-01T00:00:00.000Z",
      );
      expect(c.status).toBe("draft");
      expect(c.suggestion).toEqual({ replacement: "x" });
    });
  });

  describe("addReply", () => {
    test("non-draft human reply → status=sent, pickedUpAt cleared, input untouched", () => {
      const input = mkComment({ status: "answered", pickedUpAt: "2026-01-01T00:00:00.000Z" });
      const next = addReply(
        input,
        { id: "r1", body: "ok", author: "human", draft: false },
        "2026-01-02T00:00:00.000Z",
      );
      expect(next.status).toBe("sent");
      expect(next.pickedUpAt).toBe(null);
      expect(next.replies.map((r) => r.id)).toEqual(["r1"]);
      // purity: input is unchanged
      expect(input.status).toBe("answered");
      expect(input.pickedUpAt).toBe("2026-01-01T00:00:00.000Z");
      expect(input.replies).toEqual([]);
    });
    test("non-draft agent reply → status=answered, pickedUpAt untouched", () => {
      const stamp = "2026-01-01T00:00:00.000Z";
      const next = addReply(
        mkComment({ status: "sent", pickedUpAt: stamp }),
        { id: "r1", body: "done", author: "agent", draft: false },
        stamp,
      );
      expect(next.status).toBe("answered");
      expect(next.pickedUpAt).toBe(stamp);
    });
    test("draft reply leaves status and pickedUpAt untouched", () => {
      const stamp = "2026-01-01T00:00:00.000Z";
      const next = addReply(
        mkComment({ status: "answered", pickedUpAt: stamp }),
        { id: "r1", body: "wip", author: "human", draft: true },
        stamp,
      );
      expect(next.status).toBe("answered");
      expect(next.pickedUpAt).toBe(stamp);
      expect(next.replies[0]?.draft).toBe(true);
    });
  });

  describe("promoteDrafts", () => {
    test("promotes draft comments and draft replies, clears pickedUpAt, counts distinct comments; input untouched", () => {
      const draftComment = mkComment({ id: "c-draft", status: "draft" });
      const answeredWithDraftReply = mkComment({
        id: "c-answered",
        status: "answered",
        pickedUpAt: "2026-01-01T00:00:00.000Z",
        replies: [{ id: "r1", body: "wip", createdAt: "", author: "human", draft: true }],
      });
      const untouched = mkComment({ id: "c-sent", status: "sent" });
      const input = mkReview([draftComment, answeredWithDraftReply, untouched]);
      const { review, submitted } = promoteDrafts(input);
      expect(submitted).toBe(2);
      const [a, b, c] = review.comments;
      expect(a?.status).toBe("sent");
      expect(b?.status).toBe("sent");
      expect(b?.pickedUpAt).toBe(null);
      expect(b?.replies[0]?.draft).toBe(false);
      expect(c?.status).toBe("sent");
      // purity: original comments still hold pre-transition state
      expect(draftComment.status).toBe("draft");
      expect(answeredWithDraftReply.status).toBe("answered");
      expect(answeredWithDraftReply.pickedUpAt).toBe("2026-01-01T00:00:00.000Z");
      expect(answeredWithDraftReply.replies[0]?.draft).toBe(true);
    });
    test("returns submitted=0 and identity review when nothing to promote", () => {
      const input = mkReview([mkComment({ status: "sent" })]);
      const { review, submitted } = promoteDrafts(input);
      expect(submitted).toBe(0);
      expect(review).toBe(input); // same reference — no rebuild when nothing changed
    });
  });

  describe("stampPickedUp", () => {
    test("stamps only matched ids; input untouched", () => {
      const a = mkComment({ id: "a" });
      const b = mkComment({ id: "b" });
      const input = mkReview([a, b]);
      const { review, touched } = stampPickedUp(input, new Set(["a"]), "2026-01-02T00:00:00.000Z");
      expect(touched).toBe(true);
      expect(review.comments[0]?.pickedUpAt).toBe("2026-01-02T00:00:00.000Z");
      expect(review.comments[1]?.pickedUpAt).toBe(null);
      // purity
      expect(a.pickedUpAt).toBe(null);
    });
    test("returns touched=false and identity review when no ids match", () => {
      const input = mkReview([mkComment({ id: "a" })]);
      const { review, touched } = stampPickedUp(input, new Set(["x"]), "");
      expect(touched).toBe(false);
      expect(review).toBe(input);
    });
  });

  describe("approve / dismissApproval", () => {
    test("approve returns a new review with approved=true; input untouched", () => {
      const input = mkReview([], false);
      const next = approve(input);
      expect(next.approved).toBe(true);
      expect(input.approved).toBe(false);
    });
    test("dismissApproval returns a new review with approved=false; input untouched", () => {
      const input = mkReview([], true);
      const next = dismissApproval(input);
      expect(next.approved).toBe(false);
      expect(input.approved).toBe(true);
    });
  });
});

describe("openForAgent / awaitingAgent", () => {
  const base = {
    id: "c1",
    anchor: textAnchor,
    body: "",
    suggestion: null,
    resolved: false,
    createdAt: "",
    pickedUpAt: null,
    replies: [],
  };
  test("openForAgent: sent + !resolved", () => {
    expect(openForAgent({ ...base, status: "sent" })).toBe(true);
    expect(openForAgent({ ...base, status: "answered" })).toBe(true);
    expect(openForAgent({ ...base, status: "draft" })).toBe(false);
    expect(openForAgent({ ...base, status: "sent", resolved: true })).toBe(false);
  });
  test("awaitingAgent: only sent + !resolved (answered does NOT count)", () => {
    expect(awaitingAgent({ ...base, status: "sent" })).toBe(true);
    expect(awaitingAgent({ ...base, status: "answered" })).toBe(false);
    expect(awaitingAgent({ ...base, status: "draft" })).toBe(false);
    expect(awaitingAgent({ ...base, status: "sent", resolved: true })).toBe(false);
  });
});
