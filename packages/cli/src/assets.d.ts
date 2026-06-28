// The bundled skill markdown, imported via `import ... with { type: "text" }`.
declare module "*.md" {
  const content: string;
  export default content;
}
