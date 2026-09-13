import { describe, expect, test } from "bun:test";
import { join } from "node:path";

// cli.ts runs on import, so it is exercised the way users run it: as a child
// process. It text-imports the frontend bundle, which this package's `test` script
// builds first (`bun run build` removes it again).
const CLI = join(import.meta.dirname, "cli.ts");

async function run(...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([process.execPath, CLI, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

describe("miru --help", () => {
  test("prints the overview on stdout and exits 0", async () => {
    const r = await run("--help");
    expect(r.code).toBe(0);
    expect(r.stdout).toStartWith("usage:\n");
    expect(r.stderr).toBe("");
  });

  test("with a command prints that command's page, -h in any position included", async () => {
    for (const command of ["review", "comments", "comment", "next", "install"]) {
      const r = await run(command, "missing.md", "-h");
      expect(r.code).toBe(0);
      expect(r.stdout).toStartWith(`usage: miru ${command} `);
    }
    expect((await run("review", "--help")).stdout).toContain("--unsafe-raw");
    expect((await run("comment", "--help")).stdout).toContain("--resolve <id>");
  });

  test("an unknown command falls back to the overview", async () => {
    const r = await run("frobnicate", "-h");
    expect(r.code).toBe(0);
    expect(r.stdout).toStartWith("usage:\n");
  });
});

describe("bad invocation", () => {
  test("an unknown flag is a one-line error plus the usage, not a stack trace", async () => {
    const r = await run("review", "--prot", "3");
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toStartWith("miru: Unknown option '--prot'");
    expect(r.stderr).toContain("usage:");
    expect(r.stderr).not.toContain("TypeError");
  });

  test("no command prints the usage on stderr and exits 1", async () => {
    const r = await run();
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toStartWith("usage:");
  });
});
