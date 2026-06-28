import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CorruptedSidecarError,
  loadReview,
  reviewPath,
  saveReview,
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
          bodyHtml: "<p>hi</p>",
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
