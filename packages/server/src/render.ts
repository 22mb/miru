import sanitizeHtml from "sanitize-html";

export type SourceKind = "markdown" | "html";

export function detectKind(filePath: string): SourceKind {
  return /\.html?$/i.test(filePath) ? "html" : "markdown";
}

// Force rel="noopener noreferrer" on target="_blank" links (tab-nabbing guard).
const transformAnchor: sanitizeHtml.Transformer = (tagName, attribs) => {
  if (attribs["target"] === "_blank") attribs["rel"] = "noopener noreferrer";
  return { tagName, attribs };
};

// Loose sanitization: keep presentation but strip executable bits (script/iframe/on*).
const docSanitizeOptions: sanitizeHtml.IOptions = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat([
    "img",
    "h1",
    "h2",
    "details",
    "summary",
    "figure",
    "figcaption",
    "del",
    "ins",
    "mark",
    "input",
    "span",
    "abbr",
    "sup",
    "sub",
  ]),
  allowedAttributes: {
    "*": [
      "id",
      "class",
      "style",
      "title",
      "role",
      "align",
      "lang",
      "dir",
      "aria-label",
      "aria-hidden",
      "aria-describedby",
    ],
    a: ["href", "name", "target", "rel"],
    img: ["src", "alt", "width", "height"],
    input: ["type", "checked", "disabled"], // GFM task list
    td: ["colspan", "rowspan"],
    th: ["colspan", "rowspan", "scope"],
  },
  // No `data` here so <a href="data:text/html,…"> can't slip through. Per-tag override
  // below keeps inline data: images.
  allowedSchemes: ["http", "https", "mailto"],
  // Inline data: images only — strip remote img src so an untrusted document can't
  // leak "opened" + IP via a tracking pixel. Matches the CSP img-src ('self' data:).
  allowedSchemesByTag: { img: ["data"] },
  allowProtocolRelative: false,
  transformTags: { a: transformAnchor },
  // Restrict inline `style` to typographic properties — drop layout / positioning so
  // an untrusted document can't overlay the review panel via position:fixed, z-index,
  // transform, etc. Unlisted properties are filtered out by sanitize-html.
  allowedStyles: {
    "*": {
      color: [/.*/],
      "background-color": [/.*/],
      "text-align": [/^(left|right|center|justify|start|end)$/],
      "font-weight": [/.*/],
      "font-style": [/.*/],
      "font-family": [/.*/],
      "font-size": [/.*/],
      "text-decoration": [/.*/],
      "list-style-type": [/.*/],
    },
  },
};

const commentSanitizeOptions: sanitizeHtml.IOptions = {
  allowedTags: [
    "p",
    "br",
    "strong",
    "em",
    "del",
    "code",
    "pre",
    "a",
    "ul",
    "ol",
    "li",
    "blockquote",
    "h1",
    "h2",
    "h3",
    "h4",
    "span",
    "hr",
  ],
  allowedAttributes: { a: ["href", "title", "target", "rel"], code: ["class"], span: ["class"] },
  allowedSchemes: ["http", "https", "mailto"],
  transformTags: { a: transformAnchor },
};

export function renderDocument(
  content: string,
  kind: SourceKind,
  opts: { unsafeRaw?: boolean } = {},
): string {
  const raw = kind === "markdown" ? Bun.markdown.html(content) : content;
  return opts.unsafeRaw ? raw : sanitizeHtml(raw, docSanitizeOptions);
}

export function renderCommentBody(markdown: string): string {
  return sanitizeHtml(Bun.markdown.html(markdown), commentSanitizeOptions);
}
