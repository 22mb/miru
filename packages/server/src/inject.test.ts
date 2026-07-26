import { describe, expect, test } from "bun:test";
import { wrapDocument } from "./inject.ts";

describe("wrapDocument", () => {
  test("markdown gets the --md decoration class", () => {
    const out = wrapDocument("<h1>t</h1>", "markdown", "t.md", "en");
    expect(out.html).toContain('<main class="miru-doc miru-doc--md">');
  });

  test("sanitized html gets the plain wrap — no decoration", () => {
    const out = wrapDocument("<h1>t</h1>", "html", "t.html", "en");
    expect(out.html).toContain('<main class="miru-doc">');
    expect(out.html).not.toContain("miru-doc--md");
  });

  test("a full document (unsafe-raw) keeps its body and gets a .miru-doc div", () => {
    const out = wrapDocument("<html><body><p>x</p></body></html>", "html", "t.html", "en");
    expect(out.html).toContain('<div class="miru-doc">');
    expect(out.html).not.toContain("miru-doc--md");
    expect(out.html).not.toContain("<main");
  });

  test("a template-owned page hands back its body for in-place swaps", () => {
    expect(wrapDocument("<h1>t</h1>", "markdown", "t.md", "en").doc).toBe("<h1>t</h1>");
    expect(wrapDocument("<h1>t</h1>", "html", "t.html", "en").doc).toBe("<h1>t</h1>");
  });

  test("a full document has no swappable body — its <head>/<script> need a reload", () => {
    const out = wrapDocument("<html><body><p>x</p></body></html>", "html", "t.html", "en");
    expect(out.doc).toBeNull();
  });
});
