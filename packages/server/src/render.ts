import sanitizeHtml from "sanitize-html";

export type SourceKind = "markdown" | "html";

// Sanitization tiers for the reviewed document:
//   strict  — typography-only presentation (the old default): layout/positioning CSS
//             and everything beyond basic markup + <img> is filtered. Maximum
//             visual-spoofing resistance for reviewing untrusted committed files.
//   default — presentation-permissive: <style>, inline CSS, media and a static SVG
//             subset pass through; executable bits (script / iframe / on* /
//             javascript:) stay closed. Arbitrary CSS is acceptable because the
//             perimeter carries it: the CSP closes every network channel and the
//             panel lives in a shadow root + the browser's top layer.
//   raw     — no sanitization at all (--unsafe-raw; trusted input only).
export type SanitizeTier = "strict" | "default" | "raw";

export function detectKind(filePath: string): SourceKind {
  return /\.html?$/i.test(filePath) ? "html" : "markdown";
}

// Force rel="noopener noreferrer" on target="_blank" links (tab-nabbing guard).
const transformAnchor: sanitizeHtml.Transformer = (tagName, attribs) => {
  if (attribs["target"] === "_blank") attribs["rel"] = "noopener noreferrer";
  return { tagName, attribs };
};

// sanitize-html's default nonTextTags plus <title>: a disallowed tag is dropped but
// its text is kept, so a document's <title> used to leak as stray body text — discard
// the subtree instead. Allowed tags are unaffected (the default tier allows <style>
// and <title>; their contents pass through).
const NON_TEXT_TAGS = ["script", "style", "textarea", "option", "title"];

// Typographic tags both tiers allow on top of the sanitize-html defaults.
const BASE_EXTRA_TAGS = [
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
];

const GLOBAL_ATTRS = [
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
];

// Static SVG subset for the default tier. No <script>, no <foreignObject> (HTML
// smuggling), no SMIL (<animate>/<set> can rewrite href/attribute values at runtime —
// the classic javascript: rewrite vector). Lowercased names are fine: the browser's
// HTML parser restores case via its SVG adjustment tables.
const SVG_TAGS = [
  "svg",
  "g",
  "defs",
  "symbol",
  "use",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "title",
  "desc",
  "lineargradient",
  "radialgradient",
  "stop",
  "clippath",
  "mask",
  "pattern",
  "marker",
];
const SVG_ATTRS = [
  "viewbox",
  "preserveaspectratio",
  "xmlns",
  "width",
  "height",
  "d",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "points",
  "dx",
  "dy",
  "offset",
  "transform",
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "opacity",
  "fill-opacity",
  "stroke-opacity",
  "stop-color",
  "stop-opacity",
  "text-anchor",
  "font-size",
  "font-family",
  "clip-path",
  "gradientunits",
  "gradienttransform",
  "patternunits",
];

// Presentation-permissive default tier. Executable bits stay closed (script / iframe /
// on* / javascript: are all outside the allowlist, and the CSP double-covers script
// with a nonce). <style> and style="" pass verbatim: a CSS rewriting filter would be
// bypassable theater while breaking legitimate modern CSS — the real containment is
// the CSP (no network channel) and the panel's shadow root (no reachable UI).
const defaultSanitizeOptions: sanitizeHtml.IOptions = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat([
    ...BASE_EXTRA_TAGS,
    "style",
    "picture",
    "source",
    "video",
    "audio",
    "track",
    ...SVG_TAGS,
  ]),
  // Acknowledge <style> to silence sanitize-html's stderr warning — the CSP keeps it
  // network-silent and non-executable (see the tier comment above).
  allowVulnerableTags: true,
  allowedAttributes: {
    "*": GLOBAL_ATTRS,
    a: ["href", "name", "target", "rel"],
    img: ["src", "srcset", "sizes", "alt", "width", "height", "loading", "decoding"],
    input: ["type", "checked", "disabled"], // GFM task list
    td: ["colspan", "rowspan"],
    th: ["colspan", "rowspan", "scope"],
    source: ["src", "srcset", "sizes", "type", "media"],
    video: [
      "src",
      "poster",
      "controls",
      "muted",
      "loop",
      "playsinline",
      "preload",
      "width",
      "height",
    ],
    audio: ["src", "controls", "muted", "loop", "preload"],
    track: ["src", "kind", "srclang", "label", "default"],
    ...Object.fromEntries(SVG_TAGS.map((t) => [t, SVG_ATTRS])),
    // After the SVG spread so it wins: <use> carries only the fragment-gated href
    // (see transformTags below).
    use: ["href"],
  },
  // No `data` here so <a href="data:text/html,…"> can't slip through. Per-tag override
  // below keeps inline data: media.
  allowedSchemes: ["http", "https", "mailto"],
  // Inline data: only, like img — remote src is stripped so an untrusted document
  // can't leak "opened" + IP via markup (matches the CSP img-src/media-src). srcset
  // and poster are outside sanitize-html's scheme checks; the CSP blocks those fetches.
  allowedSchemesByTag: {
    img: ["data"],
    video: ["data"],
    audio: ["data"],
    source: ["data"],
    track: ["data"],
  },
  allowProtocolRelative: false,
  // Keep style="" symmetric with <style>: filtering one while the other passes
  // verbatim would be inconsistency, not security.
  parseStyleAttributes: false,
  nonTextTags: NON_TEXT_TAGS,
  transformTags: {
    a: transformAnchor,
    // <use> may only reference in-document fragments — external use-href stays closed.
    use: (tagName, attribs) => {
      const href = attribs["href"] ?? attribs["xlink:href"] ?? "";
      return { tagName, attribs: href.startsWith("#") ? { href } : {} };
    },
  },
};

// Typography-only profile, kept verbatim as the --strict tier: presentation is limited
// to safe typographic properties so an untrusted document can't restyle its way into
// looking like miru UI.
const strictSanitizeOptions: sanitizeHtml.IOptions = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat(BASE_EXTRA_TAGS),
  allowedAttributes: {
    "*": GLOBAL_ATTRS,
    a: ["href", "name", "target", "rel"],
    img: ["src", "alt", "width", "height"],
    input: ["type", "checked", "disabled"], // GFM task list
    td: ["colspan", "rowspan"],
    th: ["colspan", "rowspan", "scope"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["data"] },
  allowProtocolRelative: false,
  nonTextTags: NON_TEXT_TAGS,
  transformTags: { a: transformAnchor },
  // Restrict inline `style` to typographic properties — drop layout / positioning so
  // an untrusted document can't overlay the review UI via position:fixed, z-index,
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
  tier: SanitizeTier = "default",
): string {
  const raw = kind === "markdown" ? Bun.markdown.html(content) : content;
  if (tier === "raw") return raw;
  return sanitizeHtml(raw, tier === "strict" ? strictSanitizeOptions : defaultSanitizeOptions);
}

export function renderCommentBody(markdown: string): string {
  return sanitizeHtml(Bun.markdown.html(markdown), commentSanitizeOptions);
}
