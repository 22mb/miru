import { randomUUID } from "node:crypto";

/** Short unique id like "c_1a2b3c4d" (prefix + 8 hex chars). */
export function shortId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}
