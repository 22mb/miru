import { describe, expect, test } from "bun:test";
import { wrapIfFragment } from "./inject.ts";

describe("wrapIfFragment", () => {
  test("markdown gets the --md decoration class", () => {
    const out = wrapIfFragment("<h1>t</h1>", "markdown", "t.md", "en");
    expect(out).toContain('<main class="miru-doc miru-doc--md">');
  });

  test("sanitized html gets the plain wrap — no decoration", () => {
    const out = wrapIfFragment("<h1>t</h1>", "html", "t.html", "en");
    expect(out).toContain('<main class="miru-doc">');
    expect(out).not.toContain("miru-doc--md");
  });

  test("a full document (unsafe-raw) keeps its body and gets a .miru-doc div", () => {
    const out = wrapIfFragment("<html><body><p>x</p></body></html>", "html", "t.html", "en");
    expect(out).toContain('<div class="miru-doc">');
    expect(out).not.toContain("miru-doc--md");
    expect(out).not.toContain("<main");
  });
});
