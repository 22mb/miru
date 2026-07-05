import "./register-dom.ts";
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type Draft, DraftForm } from "./DraftForm.tsx";

afterEach(cleanup);

const noop = () => {};
const draft: Draft = {
  anchor: { type: "text", quote: "q", prefix: "", suffix: "", start: 0, end: 1 },
  top: 0,
  left: 0,
};

describe("DraftForm", () => {
  test("'Comment' submits immediately (draft = false)", async () => {
    const user = userEvent.setup();
    const calls: Array<[string, string, boolean]> = [];
    const { getByRole } = render(
      <DraftForm
        draft={draft}
        onCancel={noop}
        onSubmit={(b, s, d) => {
          calls.push([b, s, d]);
        }}
      />,
    );
    await user.type(getByRole("textbox", { name: "Comment (markdown)" }), "now");
    await user.click(getByRole("button", { name: "Comment" }));
    expect(calls).toEqual([["now", "", false]]);
  });

  test("'Add to review' stages it (draft = true)", async () => {
    const user = userEvent.setup();
    const calls: Array<[string, string, boolean]> = [];
    const { getByRole } = render(
      <DraftForm
        draft={draft}
        onCancel={noop}
        onSubmit={(b, s, d) => {
          calls.push([b, s, d]);
        }}
      />,
    );
    await user.type(getByRole("textbox", { name: "Comment (markdown)" }), "later");
    await user.click(getByRole("button", { name: "Add to review" }));
    expect(calls).toEqual([["later", "", true]]);
  });

  test("submit buttons stay disabled until either the body or the suggestion has non-whitespace text", async () => {
    const user = userEvent.setup();
    const { getByRole } = render(<DraftForm draft={draft} onCancel={noop} onSubmit={noop} />);
    const comment = getByRole("button", { name: "Comment" }) as HTMLButtonElement;
    const stage = getByRole("button", { name: "Add to review" }) as HTMLButtonElement;
    expect(comment.disabled).toBe(true);
    expect(stage.disabled).toBe(true);
    await user.type(getByRole("textbox", { name: "Comment (markdown)" }), "ok");
    expect(comment.disabled).toBe(false);
    expect(stage.disabled).toBe(false);
  });

  test("suggestion-only submit is allowed (no body text)", async () => {
    const user = userEvent.setup();
    const calls: Array<[string, string, boolean]> = [];
    const { getByRole } = render(
      <DraftForm
        draft={draft}
        onCancel={noop}
        onSubmit={(b, s, d) => {
          calls.push([b, s, d]);
        }}
      />,
    );
    const comment = getByRole("button", { name: "Comment" }) as HTMLButtonElement;
    expect(comment.disabled).toBe(true);
    await user.type(
      getByRole("textbox", { name: "Suggestion (optional: replacement text)" }),
      "replaced",
    );
    expect(comment.disabled).toBe(false);
    await user.click(comment);
    expect(calls).toEqual([["", "replaced", false]]);
  });

  test("Cancel fires onCancel", async () => {
    const user = userEvent.setup();
    let cancelled = 0;
    const { getByRole } = render(
      <DraftForm draft={draft} onCancel={() => cancelled++} onSubmit={noop} />,
    );
    await user.click(getByRole("button", { name: "Cancel" }));
    expect(cancelled).toBe(1);
  });

  test("the Comment textarea receives focus as soon as the form mounts", () => {
    const { getByRole } = render(<DraftForm draft={draft} onCancel={noop} onSubmit={noop} />);
    // The popover ref callback focuses the body textarea after showPopover — pre-fix,
    // React's autoFocus fired while the popover was still display:none, so focus
    // silently dropped and users had to click into the composer before typing.
    expect(document.activeElement).toBe(getByRole("textbox", { name: "Comment (markdown)" }));
  });

  test("Escape from the body textarea fires onCancel (matches the Cancel button's kbd hint)", async () => {
    const user = userEvent.setup();
    let cancelled = 0;
    const { getByRole } = render(
      <DraftForm draft={draft} onCancel={() => cancelled++} onSubmit={noop} />,
    );
    const body = getByRole("textbox", { name: "Comment (markdown)" });
    body.focus();
    await user.keyboard("{Escape}");
    expect(cancelled).toBe(1);
  });

  test("Cmd/Ctrl+Enter in the body submits as Comment (draft = false)", async () => {
    const user = userEvent.setup();
    const calls: Array<[string, string, boolean]> = [];
    const { getByRole } = render(
      <DraftForm
        draft={draft}
        onCancel={noop}
        onSubmit={(b, s, d) => {
          calls.push([b, s, d]);
        }}
      />,
    );
    const body = getByRole("textbox", { name: "Comment (markdown)" });
    await user.type(body, "ship it");
    await user.type(body, "{Meta>}{Enter}{/Meta}");
    expect(calls).toEqual([["ship it", "", false]]);
  });
});
