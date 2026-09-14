// The compiler plugin is the one build step a Dependabot bump of an experimental 0.x
// package can silently neuter — a transform that stops compiling anything still builds.
// So: bundle a tiny component through the plugin and assert the compiler actually ran.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reactCompiler } from "./react-compiler.ts";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "miru-react-compiler-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// React's runtime modules are external: the fixture lives in a tmp dir with no
// node_modules, and what's asserted is the import the compiler inserts, not its resolution.
async function bundle(files: Record<string, string>, entry: string): Promise<string> {
  for (const [name, src] of Object.entries(files)) writeFileSync(join(dir, name), src);
  const result = await Bun.build({
    entrypoints: [join(dir, entry)],
    external: ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react/compiler-runtime"],
    plugins: [reactCompiler(dir)],
  });
  return result.outputs[0]!.text();
}

describe("reactCompiler plugin", () => {
  test("compiles a component: inserts the compiler-runtime cache, leaves JSX to Bun", async () => {
    const js = await bundle(
      {
        "Hello.tsx":
          'export function Hello(props: { name: string }) {\n  return <p className="hi">{props.name}</p>;\n}\n',
      },
      "Hello.tsx",
    );
    expect(js).toContain("react/compiler-runtime");
    // JSX survived oxc (`jsx: "preserve"`) and was lowered by Bun's own transform.
    expect(js).toMatch(/react\/jsx(-dev)?-runtime/);
    expect(js).not.toContain(": string");
  });

  test("a plain .ts module passes through with its types stripped", async () => {
    const js = await bundle(
      { "util.ts": "export const double = (n: number): number => n * 2;\n" },
      "util.ts",
    );
    expect(js).toContain("n * 2");
    expect(js).not.toContain("compiler-runtime");
  });

  test("a fatal diagnostic fails the build and names the file", async () => {
    const err = await bundle(
      { "broken.tsx": "export function X() { return <p>; }\n" },
      "broken.tsx",
    )
      .then(() => null)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AggregateError);
    const messages = (err as AggregateError).errors.map((e) => String(e.message ?? e)).join("\n");
    expect(messages).toMatch(/react-compiler: .*broken\.tsx/);
  });
});
