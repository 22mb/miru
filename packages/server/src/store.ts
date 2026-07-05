import { open, rename, stat, unlink, writeFile } from "node:fs/promises";
import { CURRENT_VERSION, ReviewFile } from "@miru/contract";

export type { Anchor, Comment, ElementAnchor, Reply, ReviewFile, TextAnchor } from "@miru/contract";

// Thrown by loadReview when the sidecar exists but is malformed (bad JSON or schema
// mismatch). Callers turn this into a 422 (server) or a clean stderr message (CLI) so
// the user knows to fix the file by hand instead of seeing a 500 with a stack trace.
export class CorruptedSidecarError extends Error {
  readonly path: string;
  readonly detail: string;
  constructor(path: string, detail: string) {
    super(`corrupted sidecar at ${path}: ${detail}`);
    this.name = "CorruptedSidecarError";
    this.path = path;
    this.detail = detail;
  }
}

// Thrown when the sidecar was written by a newer miru than this one knows how to read.
// Distinct from CorruptedSidecarError: the file is fine, the reader is out of date.
// Callers surface it as an upgrade prompt (CLI stderr / server 409).
export class FutureSidecarError extends Error {
  readonly path: string;
  readonly fileVersion: number;
  constructor(path: string, fileVersion: number) {
    super(
      `sidecar at ${path} was written by a newer miru (version ${fileVersion} > ${CURRENT_VERSION}); please upgrade miru`,
    );
    this.name = "FutureSidecarError";
    this.path = path;
    this.fileVersion = fileVersion;
  }
}

export function reviewPath(target: string): string {
  return `${target}.miru.json`;
}

export async function loadReview(target: string): Promise<ReviewFile> {
  const path = reviewPath(target);
  const file = Bun.file(path);
  if (!(await file.exists()))
    return { version: CURRENT_VERSION, target, approved: false, comments: [] };
  // Validate at the boundary — a hand-edited / older file should fail loudly, not
  // silently reset comments to empty. Convert to CorruptedSidecarError so callers
  // can surface a clean diagnostic instead of a raw 500.
  let raw: unknown;
  try {
    raw = await file.json();
  } catch (err) {
    throw new CorruptedSidecarError(path, `invalid JSON (${(err as Error).message})`);
  }
  // Version gate — check BEFORE schema-parse. A future miru may have added required
  // fields the current schema doesn't know about; surfacing that as "please upgrade"
  // is much clearer than "schema mismatch". A version lower than CURRENT_VERSION
  // would land here as the migration dispatch point once we ever bump — no-op today
  // because CURRENT_VERSION is 1 and nothing predates it.
  if (typeof raw === "object" && raw !== null && "version" in raw) {
    const v = (raw as { version: unknown }).version;
    if (typeof v === "number" && v > CURRENT_VERSION) throw new FutureSidecarError(path, v);
  }
  const parsed = ReviewFile.safeParse(raw);
  if (!parsed.success) {
    throw new CorruptedSidecarError(path, `schema mismatch: ${parsed.error.message}`);
  }
  // Zod strips unknown fields by default, so any bodyHtml planted in a git-committed
  // sidecar simply disappears here — the browser only ever sees the fresh
  // renderCommentBody output attached at server response time. `body` is the single
  // source of truth on disk.
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

// A lock older than this is assumed to belong to a crashed writer and is reclaimed.
// Every real updateReview holds the lock for well under a millisecond, so 30s is
// generous by many orders of magnitude.
const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_DELAY_MS = 20;
// ~5s of active retry before giving up and proceeding without the lock. The fallback
// is intentional: never wedge the CLI or a browser POST because a peer misbehaves.
const LOCK_MAX_ATTEMPTS = 250;

function lockPath(target: string): string {
  return `${reviewPath(target)}.lock`;
}

// Try to create the lock file exclusively. On EEXIST, reclaim if the current file is
// stale (crashed holder), otherwise back off and retry. Returns a release function on
// success, or null when we give up — callers proceed unlocked in that case.
async function acquireFileLock(path: string): Promise<null | (() => Promise<void>)> {
  for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS; attempt++) {
    try {
      const fh = await open(path, "wx", 0o600);
      await fh.close();
      return async () => {
        try {
          await unlink(path);
        } catch {
          // Someone else reclaimed it (we ran long past LOCK_STALE_MS) — nothing to do.
        }
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      try {
        const s = await stat(path);
        if (Date.now() - s.mtimeMs > LOCK_STALE_MS) {
          try {
            await unlink(path);
          } catch {
            // Raced with another reclaimer; the next attempt will see a fresh lock.
          }
          continue;
        }
      } catch {
        // Lock disappeared between EEXIST and stat — retry immediately.
        continue;
      }
      await new Promise((r) => setTimeout(r, LOCK_RETRY_DELAY_MS));
    }
  }
  return null;
}

// Per-target promise chain so concurrent updateReview calls from the same process
// don't fight for the file lock. Cross-process serialization still goes through the
// file lock; this is just a fast path.
const inProcessChains = new Map<string, Promise<unknown>>();

/**
 * Load-mutate-save serialized against every other caller (same process AND other
 * processes writing the same sidecar). `mutate` is a pure function: it receives the
 * loaded review and returns { review, result }. When mutate returns the SAME review
 * reference, the save is skipped (composes with the identity-returning transitions
 * in contract). `result` is what updateReview resolves to.
 */
export async function updateReview<T>(
  target: string,
  mutate: (review: ReviewFile) => { review: ReviewFile; result: T },
): Promise<T> {
  const work = async (): Promise<T> => {
    const release = await acquireFileLock(lockPath(target));
    try {
      const loaded = await loadReview(target);
      const { review, result } = mutate(loaded);
      if (review !== loaded) await saveReview(target, review);
      return result;
    } finally {
      if (release) await release();
    }
  };
  const prev = inProcessChains.get(target) ?? Promise.resolve();
  const run = prev.then(work, work);
  // Store a swallowed variant so a failed work() doesn't poison the chain.
  inProcessChains.set(
    target,
    run.catch(() => {}),
  );
  return run;
}
