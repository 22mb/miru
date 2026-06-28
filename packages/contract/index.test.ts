import { describe, expect, test } from "bun:test";
import {
  awaitingAgent,
  Comment,
  CreateCommentBody,
  openForAgent,
  PatchCommentBody,
  ReviewFile,
  TextAnchor,
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
    bodyHtml: "<p>hi</p>",
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
});

describe("openForAgent / awaitingAgent", () => {
  const base = {
    id: "c1",
    anchor: textAnchor,
    body: "",
    bodyHtml: "",
    suggestion: null,
    resolved: false,
    createdAt: "",
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
