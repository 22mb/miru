import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CorruptedSidecarError,
  FutureSidecarError,
  loadReview,
  reviewPath,
  saveReview,
  updateReview,
  type ReviewFile,
} from "./store.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "miru-store-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function blankReview(target: string): ReviewFile {
  return { version: 1, target, approved: false, comments: [] };
}

describe("reviewPath", () => {
  test("appends .miru.json to the target", () => {
    expect(reviewPath("/tmp/doc.md")).toBe("/tmp/doc.md.miru.json");
  });
});

describe("loadReview", () => {
  test("returns a fresh review when the sidecar is missing", async () => {
    const target = join(dir, "doc.md");
    expect(await loadReview(target)).toEqual(blankReview(target));
  });

  test("round-trips a saved review", async () => {
    const target = join(dir, "doc.md");
    const review: ReviewFile = {
      version: 1,
      target,
      approved: true,
      comments: [
        {
          id: "c_1",
          anchor: {
            type: "text",
            quote: "q",
            prefix: "p",
            suffix: "s",
            start: 0,
            end: 1,
          },
          body: "hi",
          suggestion: null,
          status: "sent",
          resolved: false,
          createdAt: "2026-01-01T00:00:00.000Z",
          pickedUpAt: null,
          replies: [],
        },
      ],
    };
    await saveReview(target, review);
    expect(await loadReview(target)).toEqual(review);
  });

  test("never persists bodyHtml — zod strips it from the parsed sidecar (F-1)", async () => {
    const target = join(dir, "doc.md");
    // A hostile git-tracked sidecar tries to smuggle raw HTML in `bodyHtml`. The
    // panel injects bodyHtml via dangerouslySetInnerHTML, so anything preserved by
    // loadReview and then handed to the browser would be an XSS vector. Under F-1
    // bodyHtml is not on the persisted schema, so zod drops it — the browser only
    // ever sees the fresh renderCommentBody() output attached at response time.
    const hostile = {
      version: 1,
      target,
      approved: false,
      comments: [
        {
          id: "c_1",
          anchor: { type: "text", quote: "q", prefix: "p", suffix: "s", start: 0, end: 1 },
          body: "benign note",
          bodyHtml: '<div style="position:fixed;inset:0"><img src=x onerror="steal()"></div>',
          suggestion: null,
          status: "sent",
          resolved: false,
          createdAt: "2026-01-01T00:00:00.000Z",
          pickedUpAt: null,
          replies: [
            {
              id: "r_1",
              body: "reply text",
              bodyHtml: "<script>steal()</script>",
              createdAt: "2026-01-01T00:00:00.000Z",
              author: "human",
              draft: false,
            },
          ],
        },
      ],
    };
    await writeFile(reviewPath(target), JSON.stringify(hostile));

    const loaded = await loadReview(target);
    const c = loaded.comments[0]!;
    expect("bodyHtml" in c).toBe(false);
    const r = c.replies[0]!;
    expect("bodyHtml" in r).toBe(false);
  });

  test("an older file without `approved` parses with the schema default", async () => {
    const target = join(dir, "doc.md");
    await writeFile(reviewPath(target), JSON.stringify({ version: 1, target, comments: [] }));
    expect(await loadReview(target)).toEqual(blankReview(target));
  });

  test("invalid JSON sidecar throws CorruptedSidecarError with path + detail", async () => {
    const target = join(dir, "doc.md");
    const path = reviewPath(target);
    await writeFile(path, "{not json");
    try {
      await loadReview(target);
      throw new Error("expected loadReview to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(CorruptedSidecarError);
      expect((err as CorruptedSidecarError).path).toBe(path);
      expect((err as CorruptedSidecarError).detail).toContain("invalid JSON");
    }
  });

  test("schema-mismatched sidecar throws CorruptedSidecarError", async () => {
    const target = join(dir, "doc.md");
    // Valid JSON, wrong shape — fails the zod parse, not JSON.parse.
    await writeFile(reviewPath(target), JSON.stringify({ version: "one", comments: "lots" }));
    await expect(loadReview(target)).rejects.toBeInstanceOf(CorruptedSidecarError);
  });

  test("sidecar written by a newer miru throws FutureSidecarError (not corruption)", async () => {
    const target = join(dir, "doc.md");
    // Version 2 doesn't exist yet — pretend a future miru wrote it. Even if the shape
    // otherwise happens to match today's schema, the version gate should fire first
    // so the user gets an "upgrade" message rather than "schema mismatch".
    await writeFile(
      reviewPath(target),
      JSON.stringify({ version: 2, target, approved: false, comments: [] }),
    );
    try {
      await loadReview(target);
      throw new Error("expected loadReview to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FutureSidecarError);
      expect((err as FutureSidecarError).fileVersion).toBe(2);
      expect((err as FutureSidecarError).path).toBe(reviewPath(target));
    }
  });
});

describe("saveReview", () => {
  test("writes are atomic — no partial temp files remain after a successful write", async () => {
    const target = join(dir, "doc.md");
    await saveReview(target, blankReview(target));
    const entries = await readdir(dir);
    expect(entries).toContain("doc.md.miru.json");
    expect(entries.some((e) => e.includes(".tmp-"))).toBe(false);
  });

  test("written sidecar is mode 0o600 (owner read/write only)", async () => {
    const target = join(dir, "doc.md");
    await saveReview(target, blankReview(target));
    const info = await stat(reviewPath(target));
    // Mask off file-type bits; comments can carry sensitive review notes.
    expect(info.mode & 0o777).toBe(0o600);
  });

  test("two concurrent saves do not corrupt the file", async () => {
    const target = join(dir, "doc.md");
    const a = blankReview(target);
    const b: ReviewFile = { ...blankReview(target), approved: true };
    await Promise.all([saveReview(target, a), saveReview(target, b)]);
    const loaded = await loadReview(target);
    // The last writer wins; what matters is that the file parses (atomic rename).
    expect([true, false]).toContain(loaded.approved);
  });
});

describe("updateReview", () => {
  const mkComment = (id: string) => ({
    id,
    anchor: { type: "text" as const, quote: "q", prefix: "p", suffix: "s", start: 0, end: 1 },
    body: id,
    suggestion: null,
    status: "sent" as const,
    resolved: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    pickedUpAt: null,
    replies: [],
  });

  test("returns mutate's result and persists the returned review", async () => {
    const target = join(dir, "doc.md");
    await saveReview(target, blankReview(target));
    const returned = await updateReview(target, (r) => ({
      review: { ...r, approved: true },
      result: "ok" as const,
    }));
    expect(returned).toBe("ok");
    expect((await loadReview(target)).approved).toBe(true);
  });

  test("skips saveReview when mutate returns the same review reference", async () => {
    const target = join(dir, "doc.md");
    await saveReview(target, blankReview(target));
    const mtimeBefore = (await stat(reviewPath(target))).mtimeMs;
    await new Promise((r) => setTimeout(r, 20));
    await updateReview(target, (r) => ({ review: r, result: undefined }));
    const mtimeAfter = (await stat(reviewPath(target))).mtimeMs;
    // No rewrite → mtime unchanged.
    expect(mtimeAfter).toBe(mtimeBefore);
  });

  test("concurrent updateReview calls do not lose updates (in-process chain serializes)", async () => {
    const target = join(dir, "doc.md");
    await saveReview(target, blankReview(target));
    const N = 20;
    // Each mutate appends one comment. Without serialization, load-then-save races
    // would drop some. With the chain + file lock, every append lands.
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        updateReview(target, (r) => ({
          review: { ...r, comments: [...r.comments, mkComment(`c${i}`)] },
          result: undefined,
        })),
      ),
    );
    const final = await loadReview(target);
    expect(final.comments.length).toBe(N);
    // The set of ids is exactly the ones we asked for (order isn't asserted).
    expect(new Set(final.comments.map((c) => c.id))).toEqual(
      new Set(Array.from({ length: N }, (_, i) => `c${i}`)),
    );
  });

  test("reclaims a stale lock (crashed prior holder)", async () => {
    const target = join(dir, "doc.md");
    await saveReview(target, blankReview(target));
    const lockFile = `${reviewPath(target)}.lock`;
    // Simulate a crashed writer: a lock file that's ancient (well past LOCK_STALE_MS = 30s).
    await writeFile(lockFile, "");
    const ancient = new Date(Date.now() - 60_000);
    await utimes(lockFile, ancient, ancient);

    // Fresh call should reclaim and proceed rather than spin out to the fallback.
    await updateReview(target, (r) => ({ review: { ...r, approved: true }, result: undefined }));
    expect((await loadReview(target)).approved).toBe(true);
    // Lock file was released after the operation completed.
    await expect(stat(lockFile)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
