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

describe("renderDocument — sanitization (security boundary)", () => {
  test("strips <script>", () => {
    const out = renderDocument("<p>hi</p><script>alert(1)</script>", "html");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert");
  });

  test("strips <iframe>", () => {
    const out = renderDocument("<iframe src='x'></iframe><p>hi</p>", "html");
    expect(out).not.toContain("<iframe");
  });

  test("strips on*= event handler attributes", () => {
    const out = renderDocument(`<p onclick="evil()">click</p>`, "html");
    expect(out).not.toMatch(/onclick=/i);
    expect(out).not.toContain("evil()");
  });

  test("javascript: href is dropped", () => {
    const out = renderDocument(`<a href="javascript:alert(1)">x</a>`, "html");
    expect(out).not.toMatch(/javascript:/i);
  });

  test("data: href on <a> is dropped (img-only allowance)", () => {
    const out = renderDocument(`<a href="data:text/html,<script>alert(1)</script>">x</a>`, "html");
    expect(out).not.toContain("data:");
  });

  test("style attribute keeps typography but drops layout / positioning", () => {
    const out = renderDocument(
      `<p style="color: red; position: fixed; inset: 0; z-index: 9999; transform: scale(2)">x</p>`,
      "html",
    );
    expect(out).toContain("color");
    expect(out).not.toContain("position");
    expect(out).not.toContain("z-index");
    expect(out).not.toContain("transform");
    expect(out).not.toContain("inset");
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
});

describe("renderDocument — unsafeRaw escape hatch", () => {
  test("bypasses sanitization", () => {
    const evil = `<p>hi</p><script>alert(1)</script>`;
    const out = renderDocument(evil, "html", { unsafeRaw: true });
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
