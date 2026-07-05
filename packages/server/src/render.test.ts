import { describe, expect, test } from "bun:test";
import { detectKind, renderCommentBody, renderDocument } from "./render.ts";

describe("detectKind", () => {
  test.each([
    ["foo.md", "markdown"],
    ["foo.MD", "markdown"],
    ["foo.html", "html"],
    ["foo.HTM", "html"],
    ["foo.txt", "markdown"], // anything not .htm[l] is treated as markdown
    ["no-extension", "markdown"],
  ] as const)("%s → %s", (path, expected) => {
    expect(detectKind(path)).toBe(expected);
  });
});

describe("renderDocument — executable bits stay closed in every sanitizing tier", () => {
  test.each(["default", "strict"] as const)("strips <script> (%s)", (tier) => {
    const out = renderDocument("<p>hi</p><script>alert(1)</script>", "html", tier);
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert");
  });

  test.each(["default", "strict"] as const)("strips <iframe> (%s)", (tier) => {
    const out = renderDocument("<iframe src='x'></iframe><p>hi</p>", "html", tier);
    expect(out).not.toContain("<iframe");
  });

  test.each(["default", "strict"] as const)("strips on*= event handler attributes (%s)", (tier) => {
    const out = renderDocument(`<p onclick="evil()">click</p>`, "html", tier);
    expect(out).not.toMatch(/onclick=/i);
    expect(out).not.toContain("evil()");
  });

  test.each(["default", "strict"] as const)("javascript: href is dropped (%s)", (tier) => {
    const out = renderDocument(`<a href="javascript:alert(1)">x</a>`, "html", tier);
    expect(out).not.toMatch(/javascript:/i);
  });

  test("data: href on <a> is dropped (media-only allowance)", () => {
    const out = renderDocument(`<a href="data:text/html,<script>alert(1)</script>">x</a>`, "html");
    expect(out).not.toContain("data:");
  });

  test("remote img src is stripped (CSP img-src parity)", () => {
    const out = renderDocument(`<img src="https://evil.example/pixel.gif">`, "html");
    expect(out).not.toContain("evil.example");
  });

  test("data: img src is kept", () => {
    const out = renderDocument(`<img src="data:image/png;base64,AAA" alt="x">`, "html");
    expect(out).toContain("data:image/png;base64,AAA");
  });

  test("target=_blank forces rel=noopener noreferrer", () => {
    const out = renderDocument(`<a href="https://x.test" target="_blank">x</a>`, "html");
    expect(out).toContain('rel="noopener noreferrer"');
  });

  test("markdown input is converted then sanitized", () => {
    const out = renderDocument("# Title\n\n<script>x</script>", "markdown");
    expect(out).toContain("<h1");
    expect(out).not.toContain("<script");
  });

  test("<title> text no longer leaks as stray body text", () => {
    // <title> is dropped in strict and allowed (UA-hidden) in default; in neither
    // tier may its text end up as naked body text.
    expect(renderDocument("<title>Doc Title</title><h1>x</h1>", "html", "strict")).not.toContain(
      "Doc Title",
    );
    expect(renderDocument("<title>Doc Title</title><h1>x</h1>", "html")).toContain(
      "<title>Doc Title</title>",
    );
  });
});

describe("renderDocument — default tier is presentation-permissive", () => {
  test("<style> survives with its text unescaped", () => {
    // Regression guard: sanitize-html must not entity-escape style text — <style> is
    // a raw-text element, so `a &gt; b` would kill the selector.
    const out = renderDocument("<style>a > b { color: red }</style><p>x</p>", "html");
    expect(out).toContain("a > b { color: red }");
  });

  test("</style> breakout cannot smuggle a script", () => {
    const out = renderDocument("<style>x { }</style><script>alert(1)</script><p>y</p>", "html");
    expect(out).not.toContain("<script");
    expect(out).toContain("<p>y</p>");
  });

  test("inline style passes verbatim (no property filter)", () => {
    const out = renderDocument(`<p style="color: red; position: fixed; z-index: 9">x</p>`, "html");
    expect(out).toContain("position: fixed");
  });

  test("static SVG passes; self-closing tags don't swallow following content", () => {
    const out = renderDocument(
      `<svg viewBox="0 0 10 10"><path d="M0 0"/><rect x="1" fill="red"/></svg><p>after</p>`,
      "html",
    );
    expect(out).toContain("<svg");
    expect(out).toContain('d="M0 0"');
    expect(out).toMatch(/<\/svg>\s*<p>after<\/p>/);
  });

  test("SMIL and foreignObject are stripped from SVG", () => {
    const out = renderDocument(
      `<svg><rect><animate attributeName="href" to="javascript:x"/></rect>` +
        `<set attributeName="x"/><foreignObject><p>smuggled</p></foreignObject></svg>`,
      "html",
    );
    expect(out).not.toContain("<animate");
    expect(out).not.toContain("<set");
    expect(out).not.toContain("<foreignobject");
    expect(out).not.toContain("javascript:");
  });

  test("<use> keeps fragment refs only", () => {
    const out = renderDocument(
      `<svg><use href="#local"/><use href="https://evil.example/x.svg#f"/></svg>`,
      "html",
    );
    expect(out).toContain('href="#local"');
    expect(out).not.toContain("evil.example");
  });

  test("srcset and media elements pass (fetches are the CSP's job)", () => {
    const out = renderDocument(
      `<img src="data:image/png;base64,AAA" srcset="hi.png 2x">` +
        `<video controls poster="p.png"><source src="clip.mp4" type="video/mp4"></video>`,
      "html",
    );
    expect(out).toContain('srcset="hi.png 2x"');
    expect(out).toContain("<video controls");
    expect(out).toContain('<source src="clip.mp4"');
  });
});

describe("renderDocument — strict tier keeps the typography-only profile", () => {
  test("style attribute keeps typography but drops layout / positioning", () => {
    const out = renderDocument(
      `<p style="color: red; position: fixed; inset: 0; z-index: 9999; transform: scale(2)">x</p>`,
      "html",
      "strict",
    );
    expect(out).toContain("color");
    expect(out).not.toContain("position");
    expect(out).not.toContain("z-index");
    expect(out).not.toContain("transform");
    expect(out).not.toContain("inset");
  });

  test("<style> is discarded, contents included", () => {
    const out = renderDocument("<style>.x { color: red }</style><p>x</p>", "html", "strict");
    expect(out).not.toContain("<style");
    expect(out).not.toContain("color: red");
  });

  test("SVG and media tags are dropped", () => {
    const out = renderDocument(
      `<svg><rect/></svg><video src="v.mp4"></video><p>x</p>`,
      "html",
      "strict",
    );
    expect(out).not.toContain("<svg");
    expect(out).not.toContain("<video");
    expect(out).toContain("<p>x</p>");
  });
});

describe("renderDocument — raw escape hatch (--unsafe-raw)", () => {
  test("bypasses sanitization", () => {
    const evil = `<p>hi</p><script>alert(1)</script>`;
    const out = renderDocument(evil, "html", "raw");
    expect(out).toContain("<script>alert(1)</script>");
  });
});

describe("renderCommentBody", () => {
  test("renders markdown and sanitizes", () => {
    const out = renderCommentBody("**bold** <script>x</script>");
    expect(out).toContain("<strong>bold</strong>");
    expect(out).not.toContain("<script");
  });

  test("drops disallowed top-level tags (e.g. iframe)", () => {
    const out = renderCommentBody("<iframe src='x'></iframe>after");
    expect(out).not.toContain("<iframe");
    expect(out).toContain("after");
  });

  test("links get noopener on _blank", () => {
    const out = renderCommentBody("[x](https://example.test){target=_blank}");
    // The markdown extension may or may not honor that attribute syntax,
    // but for plain links the transform still applies — test the case we control:
    const out2 = renderCommentBody(`<a href="https://x.test" target="_blank">x</a>`);
    expect(out2).toContain('rel="noopener noreferrer"');
    // smoke: at least the link href survives:
    expect(out).toContain("https://example.test");
  });
});
