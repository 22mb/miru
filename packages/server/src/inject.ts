import type { SourceKind } from "./render.ts";

function template(title: string, body: string, lang: string, kind: SourceKind): string {
  // Markdown gets miru's typographic decoration via the `--md` modifier; HTML keeps
  // the plain wrap and renders with its own / UA styles — "what a normal browser tab
  // shows" is the fidelity target for HTML input.
  const cls = kind === "markdown" ? "miru-doc miru-doc--md" : "miru-doc";
  return `<!DOCTYPE html>
<html lang="${Bun.escapeHTML(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${Bun.escapeHTML(title)}</title>
</head>
<body>
<main class="${cls}">
${body}
</main>
</body>
</html>`;
}

/** Markdown is always wrapped in the template. For HTML, wrap the body content in
 *  .miru-doc so the anchoring root is limited to the document (excludes the panel, etc.). */
export function wrapIfFragment(
  html: string,
  kind: SourceKind,
  title: string,
  lang: string,
): string {
  // Sanitized output never contains <body> (the sanitizer drops it), so both tiers
  // always take the template branch — only --unsafe-raw full documents keep their own.
  if (kind === "markdown" || !/<body[\s>]/i.test(html)) return template(title, html, lang, kind);
  return html.replace(
    /(<body[^>]*>)([\s\S]*?)(<\/body>)/i,
    (_m, open: string, inner: string, close: string) =>
      `${open}\n<div class="miru-doc">${inner}</div>\n${close}`,
  );
}

/** Insert the token meta before </head> and miru.css/js before </body>. */
export function injectUI(html: string, opts: { token: string; nonce: string }): string {
  const meta = `<meta name="miru-token" content="${opts.token}">`;
  const assets =
    `<link rel="stylesheet" href="/__miru__/miru.css">\n` +
    `<script src="/__miru__/miru.js" nonce="${opts.nonce}" defer></script>`;
  let out = html;
  out = /<\/head>/i.test(out) ? out.replace(/<\/head>/i, `${meta}\n</head>`) : `${meta}\n${out}`;
  out = /<\/body>/i.test(out)
    ? out.replace(/<\/body>/i, `${assets}\n</body>`)
    : `${out}\n${assets}`;
  return out;
}
