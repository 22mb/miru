// Bun.build plugin that runs the React Compiler over the panel sources before Bun
// bundles them. The compiler is Oxc's Rust port (`oxc-transform-react`), used as a
// standalone transform: it inserts the memoization cache (`react/compiler-runtime`,
// built into React 19) and strips TypeScript. JSX is left alone (`jsx: "preserve"`) so
// Bun keeps lowering it exactly as before, dev and prod runtimes included — the only
// behavioural delta from a plain `bun build` is the compiler pass.
//
// Build-time only: imported by build-front.ts and dev-server.ts, never by cli.ts — the
// compile step bundles cli.ts's import graph, and the native binding must stay out of
// the binary.
//
// Two known limits. Bun's onLoad result has no source-map slot, so a bundle's map points
// at the compiler's output rather than the .tsx (readable, same names, shifted lines).
// And a function that breaks the Rules of React is skipped silently (the default
// `panicThreshold` is "none"), not reported here — the react/* compiler rules in
// .oxlintrc.json are the visibility layer for that.
import type { BunPlugin } from "bun";
import { realpathSync } from "node:fs";
import { sep } from "node:path";
import { transformSync } from "oxc-transform-react";

// `srcDir`: only files under it are transformed; anything a dependency ships stays on
// Bun's own loaders. Bun hands onLoad the resolved real path, so the boundary is the
// real path too (a tmp dir on macOS arrives as /private/var/…, not /var/…).
export function reactCompiler(srcDir: string): BunPlugin {
  const root = realpathSync(srcDir) + sep;
  return {
    name: "react-compiler",
    setup(build) {
      build.onLoad({ filter: /\.tsx?$/ }, async (args) => {
        if (!args.path.startsWith(root)) return undefined;
        const tsx = args.path.endsWith(".tsx");
        const result = transformSync(args.path, await Bun.file(args.path).text(), {
          lang: tsx ? "tsx" : "ts",
          jsx: "preserve",
          reactCompiler: { target: "19" },
        });
        if (result.fatal) {
          const detail = result.errors.map((e) => e.codeframe ?? e.message).join("\n");
          throw new Error(`react-compiler: ${args.path}\n${detail}`);
        }
        for (const e of result.errors) console.error(`react-compiler: ${args.path}: ${e.message}`);
        return { contents: result.code, loader: tsx ? "jsx" : "js" };
      });
    },
  };
}
