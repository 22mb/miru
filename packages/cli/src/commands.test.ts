import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Comment, ReviewFile } from "@miru/contract";
import { loadReview, saveReview } from "@miru/server";
import { applyCommentUpdate, awaitAgentTurn, commentsOutput, installSkill } from "./commands.ts";

const T0 = "2026-01-01T00:00:00.000Z";

function comment(id: string, over: Partial<Comment> = {}): Comment {
  return {
    id,
    anchor: { type: "text", quote: "quoted", prefix: "", suffix: "", start: 0, end: 6 },
    body: "needs work",
    suggestion: null,
    status: "sent",
    resolved: false,
    createdAt: T0,
    pickedUpAt: null,
    replies: [],
    ...over,
  };
}

function review(target: string, comments: Comment[], approved = false): ReviewFile {
  return { version: 1, target, approved, comments };
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "miru-cli-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("commentsOutput", () => {
  test("json mode emits the agent projection: approved flag, open comments, draft replies stripped", () => {
    const r = review("/tmp/doc.md", [
      comment("c_open", {
        replies: [
          { id: "r_sent", body: "done", createdAt: T0, author: "agent", draft: false },
          { id: "r_draft", body: "staged", createdAt: T0, author: "human", draft: true },
        ],
      }),
      comment("c_resolved", { resolved: true }),
      comment("c_draft", { status: "draft" }),
    ]);
    const out = JSON.parse(commentsOutput(r, true)) as {
      approved: boolean;
      comments: { id: string; replies: { id: string }[] }[];
    };
    expect(out.approved).toBe(false);
    // openForAgent: resolved and staged-draft comments are excluded.
    expect(out.comments.map((c) => c.id)).toEqual(["c_open"]);
    // Staged ("Save draft") replies stay hidden until submitted.
    expect(out.comments[0]?.replies.map((x) => x.id)).toEqual(["r_sent"]);
  });

  test("text mode lists each unresolved comment with its location and suggestion", () => {
    const r = review("/tmp/doc.md", [
      comment("c_1", { suggestion: { replacement: "fixed" } }),
      comment("c_2", {
        anchor: {
          type: "element",
          selector: "main > img",
          tagChain: ["main", "img"],
          role: "img",
          accessibleName: null,
          landmark: "main",
          textHint: null,
          index: 0,
        },
      }),
    ]);
    const out = commentsOutput(r, false);
    expect(out).toBe(
      '- [c_1] (text) "quoted"\n  needs work\n  suggestion: fixed\n' +
        "- [c_2] (element) main > img\n  needs work",
    );
  });

  test("text mode reports when nothing is unresolved", () => {
    const r = review("/tmp/doc.md", [comment("c_1", { resolved: true })]);
    expect(commentsOutput(r, false)).toBe("No unresolved comments.");
  });
});

describe("applyCommentUpdate", () => {
  test("appends an agent reply and flips status to answered", () => {
    const loaded = review("/tmp/doc.md", [comment("c_1"), comment("c_2")]);
    const { review: next, result } = applyCommentUpdate(
      loaded,
      { targetId: "c_1", replyBody: "fixed it", resolve: false },
      "r_new",
      T0,
    );
    expect(result).toBe("c_1");
    const updated = next.comments[0]!;
    expect(updated.status).toBe("answered");
    expect(updated.replies).toEqual([
      { id: "r_new", body: "fixed it", createdAt: T0, author: "agent", draft: false },
    ]);
    // Untouched comments come through unchanged; the input is not mutated.
    expect(next.comments[1]).toBe(loaded.comments[1]!);
    expect(loaded.comments[0]!.replies).toEqual([]);
  });

  test("resolve marks the comment resolved, with or without a reply", () => {
    const loaded = review("/tmp/doc.md", [comment("c_1")]);
    const { review: next } = applyCommentUpdate(
      loaded,
      { targetId: "c_1", resolve: true },
      "r_unused",
      T0,
    );
    expect(next.comments[0]!.resolved).toBe(true);
    expect(next.comments[0]!.replies).toEqual([]);
  });

  test("unknown target returns the review by identity and a null result", () => {
    const loaded = review("/tmp/doc.md", [comment("c_1")]);
    const { review: next, result } = applyCommentUpdate(
      loaded,
      { targetId: "c_missing", replyBody: "hi", resolve: false },
      "r_new",
      T0,
    );
    expect(result).toBeNull();
    // Identity return is what lets updateReview skip the save.
    expect(next).toBe(loaded);
  });
});

describe("installSkill", () => {
  test("creates the directory and writes SKILL.md", () => {
    const skillsDir = join(dir, "nested", "skills", "miru");
    const result = installSkill(skillsDir, "# skill");
    expect(result).toEqual({ ok: true, dest: join(skillsDir, "SKILL.md") });
    expect(readFileSync(join(skillsDir, "SKILL.md"), "utf8")).toBe("# skill");
  });

  test("refuses to write through a symlink at the destination", async () => {
    const victim = join(dir, "victim.txt");
    await writeFile(victim, "precious");
    await symlink(victim, join(dir, "SKILL.md"));
    const result = installSkill(dir, "# skill");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("symlink");
    // The symlink target is untouched.
    expect(readFileSync(victim, "utf8")).toBe("precious");
  });
});

describe("awaitAgentTurn", () => {
  test("returns immediately when a comment already awaits the agent, and stamps pickedUpAt", async () => {
    const target = join(dir, "doc.md");
    await saveReview(target, review(target, [comment("c_1"), comment("c_2", { resolved: true })]));
    const s = await awaitAgentTurn(target, loadReview);
    expect(s.approved).toBe(false);
    // awaitingAgent: only sent + unresolved comments are handed over.
    expect(s.comments.map((c) => c.id)).toEqual(["c_1"]);
    // The handover is stamped so the panel can show "agent is reviewing".
    const persisted = await loadReview(target);
    expect(persisted.comments.find((c) => c.id === "c_1")?.pickedUpAt).not.toBeNull();
    expect(persisted.comments.find((c) => c.id === "c_2")?.pickedUpAt).toBeNull();
  });

  test("returns immediately on approval without stamping anything", async () => {
    const target = join(dir, "doc.md");
    await saveReview(target, review(target, [], true));
    const s = await awaitAgentTurn(target, loadReview);
    expect(s).toEqual({ approved: true, comments: [] });
  });

  test("blocks until a sidecar write hands the agent something", async () => {
    const target = join(dir, "doc.md");
    await saveReview(target, review(target, []));
    const pending = awaitAgentTurn(target, loadReview);
    // Let the directory watcher attach before the write it must observe.
    await new Promise((r) => setTimeout(r, 150));
    await saveReview(target, review(target, [comment("c_late")]));
    const s = await pending;
    expect(s.comments.map((c) => c.id)).toEqual(["c_late"]);
  });
});
