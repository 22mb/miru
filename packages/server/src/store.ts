import { rename, writeFile } from "node:fs/promises";
import { ReviewFile } from "@miru/contract";

export type { Anchor, Comment, ElementAnchor, Reply, ReviewFile, TextAnchor } from "@miru/contract";

// Thrown by loadReview when the sidecar exists but is malformed (bad JSON or schema
// mismatch). Callers turn this into a 422 (server) or a clean stderr message (CLI) so
// the user knows to fix the file by hand instead of seeing a 500 with a stack trace.
export class CorruptedSidecarError extends Error {
  constructor(
    readonly path: string,
    readonly detail: string,
  ) {
    super(`corrupted sidecar at ${path}: ${detail}`);
    this.name = "CorruptedSidecarError";
  }
}

export function reviewPath(target: string): string {
  return `${target}.miru.json`;
}

export async function loadReview(target: string): Promise<ReviewFile> {
  const path = reviewPath(target);
  const file = Bun.file(path);
  if (!(await file.exists())) return { version: 1, target, approved: false, comments: [] };
  // Validate at the boundary — a hand-edited / older file should fail loudly, not
  // silently reset comments to empty. Convert to CorruptedSidecarError so callers
  // can surface a clean diagnostic instead of a raw 500.
  let raw: unknown;
  try {
    raw = await file.json();
  } catch (err) {
    throw new CorruptedSidecarError(path, `invalid JSON (${(err as Error).message})`);
  }
  const parsed = ReviewFile.safeParse(raw);
  if (!parsed.success) {
    throw new CorruptedSidecarError(path, `schema mismatch: ${parsed.error.message}`);
  }
  return parsed.data;
}

/** Write to a temp file then rename, so the save is atomic. */
export async function saveReview(target: string, review: ReviewFile): Promise<void> {
  const p = reviewPath(target);
  const tmp = `${p}.tmp-${process.pid}-${crypto.randomUUID()}`;
  // 0o600 so review comments (potentially sensitive) aren't world-readable on shared
  // machines. rename preserves the mode set at create.
  await writeFile(tmp, JSON.stringify(review, null, 2), { mode: 0o600 });
  await rename(tmp, p);
}
