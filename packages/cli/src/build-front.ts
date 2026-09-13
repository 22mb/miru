#!/usr/bin/env bun
// Production build of the panel: packages/frontend/src -> packages/frontend/dist/miru.{js,css},
// what cli.ts text-imports and `bun build --compile` embeds. This used to be a one-line
// `bun build … --production`; the CLI form takes no plugins, and the React Compiler runs
// as one (react-compiler.ts), so the build lives here. `bun run build:front` runs it.
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { reactCompiler } from "./react-compiler.ts";

const FRONTEND = join(import.meta.dirname, "../../frontend");
const SRC = join(FRONTEND, "src");
const DIST = join(FRONTEND, "dist");

// Same knobs as `bun build --production`: minify + NODE_ENV=production. Bun.build throws
// on failure (a build error, a fatal compiler diagnostic), which is the exit we want.
const result = await Bun.build({
  entrypoints: [join(SRC, "index.tsx")],
  outdir: DIST,
  naming: "miru.js",
  minify: true,
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  plugins: [reactCompiler(SRC)],
});
copyFileSync(join(SRC, "miru.css"), join(DIST, "miru.css"));
for (const out of result.outputs) console.log(`build-front: ${out.path} (${out.size} bytes)`);
