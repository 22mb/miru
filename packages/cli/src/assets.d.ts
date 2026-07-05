// Assets loaded via Bun's `import ... with { type: "text" }`: the bundled skill
// markdown and the pre-built frontend JS/CSS handed to createServer's `assets`.
declare module "*.md" {
  const content: string;
  export default content;
}
declare module "*.js" {
  const content: string;
  export default content;
}
declare module "*.css" {
  const content: string;
  export default content;
}
