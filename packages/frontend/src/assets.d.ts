// panel.css is loaded via Bun's `import ... with { type: "text" }` and adopted into
// the panel's shadow root (index.tsx). `bun build` inlines it into the bundle as a
// string, so it survives `bun build --compile` with no extra asset route.
declare module "*.css" {
  const content: string;
  export default content;
}
