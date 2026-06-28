// Type declarations for build artifacts loaded via Bun's `import ... with { type: "text" }`.
// Only explicit extension-bearing imports (.js / .css) are covered; extensionless
// imports like "react" are unaffected.
declare module "*.js" {
  const content: string;
  export default content;
}
declare module "*.css" {
  const content: string;
  export default content;
}
