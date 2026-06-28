#!/usr/bin/env bun
// Stop hook: run typecheck + lint scoped to the files Claude actually edited in this
// session. Parses transcript_path to find Edit/Write/MultiEdit/NotebookEdit targets,
// filters to project source files, then:
//   - lint: oxlint on just those files (file-scoped is safe and fast)
//   - typecheck: full `tsc -b` only if a TS/TSX file was touched (project references
//     graph catches cross-package breaks that file-scoped tsc would miss)
// If no source files were edited, exits 0 without running anything.
// On failure: prints captured output to stderr and exits 2 so Claude re-engages.
import { $ } from "bun";
import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";

type StopInput = {
  stop_hook_active?: boolean;
  transcript_path?: string;
  cwd?: string;
};

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const TS_EXT = /\.(ts|tsx)$/;

const input = (await Bun.stdin.json().catch(() => ({}))) as StopInput;
if (input.stop_hook_active) process.exit(0);

const projectRoot = resolve(process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? ".");

const edited = new Set<string>();
const transcriptPath = input.transcript_path;
if (transcriptPath && existsSync(transcriptPath)) {
  const text = await Bun.file(transcriptPath).text();
  for (const line of text.split("\n")) {
    if (!line) continue;
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    const content = (msg as { message?: { content?: unknown } })?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type !== "tool_use" || !EDIT_TOOLS.has(block.name)) continue;
      const fp = block.input?.file_path;
      if (typeof fp === "string") edited.add(fp);
    }
  }
}

const projectFiles = [...edited]
  .map((p) => resolve(p))
  .filter((p) => p.startsWith(`${projectRoot}/`))
  .filter((p) => SOURCE_EXT.test(p))
  .filter((p) => existsSync(p))
  .map((p) => relative(projectRoot, p));

if (projectFiles.length === 0) process.exit(0);

type Check = { name: string; run: () => ReturnType<typeof $> };
const checks: Check[] = [
  {
    name: "lint",
    run: () => $`bun x oxlint --deny-warnings ${projectFiles}`.cwd(projectRoot).quiet().nothrow(),
  },
];
if (projectFiles.some((f) => TS_EXT.test(f))) {
  checks.push({
    name: "typecheck",
    run: () => $`bun run typecheck`.cwd(projectRoot).quiet().nothrow(),
  });
}

const results = await Promise.all(
  checks.map(async (c) => ({ name: c.name, out: await c.run() })),
);
const failed = results.filter((r) => r.out.exitCode !== 0);
if (failed.length > 0) {
  const report = failed
    .map((r) => `=== ${r.name} ===\n${r.out.stdout.toString()}${r.out.stderr.toString()}`)
    .join("\n");
  process.stderr.write(`${report}\n`);
  process.exit(2);
}
