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
const elementDraft: Draft = {
  anchor: {
    type: "element",
    selector: "pre",
    tagChain: ["pre"],
    role: null,
    accessibleName: null,
    landmark: null,
    textHint: null,
    index: 0,
  },
  top: 0,
  left: 0,
};

describe("DraftForm", () => {
  test("'Send' submits immediately (draft = false)", async () => {
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
    await user.click(getByRole("button", { name: "Send" }));
    expect(calls).toEqual([["now", "", false]]);
  });

  test("'Save draft' stages it (draft = true)", async () => {
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
    await user.click(getByRole("button", { name: "Save draft" }));
    expect(calls).toEqual([["later", "", true]]);
  });

  test("submit buttons stay disabled until either the body or the suggestion has non-whitespace text", async () => {
    const user = userEvent.setup();
    const { getByRole } = render(<DraftForm draft={draft} onCancel={noop} onSubmit={noop} />);
    const send = getByRole("button", { name: "Send" }) as HTMLButtonElement;
    const stage = getByRole("button", { name: "Save draft" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(stage.disabled).toBe(true);
    await user.type(getByRole("textbox", { name: "Comment (markdown)" }), "ok");
    expect(send.disabled).toBe(false);
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
    const send = getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    // Suggestion is collapsed by default — open it first, then type.
    await user.click(getByRole("button", { name: "+ suggest a fix" }));
    await user.type(getByRole("textbox", { name: "Suggested replacement (markdown)" }), "replaced");
    expect(send.disabled).toBe(false);
    await user.click(send);
    expect(calls).toEqual([["", "replaced", false]]);
  });

  test("closing the suggestion toggle discards it from the submission (state is retained on reopen)", async () => {
    const user = userEvent.setup();
    const calls: Array<[string, string, boolean]> = [];
    const { getByRole, queryByRole } = render(
      <DraftForm
        draft={draft}
        onCancel={noop}
        onSubmit={(b, s, d) => {
          calls.push([b, s, d]);
        }}
      />,
    );
    await user.type(getByRole("textbox", { name: "Comment (markdown)" }), "note");
    await user.click(getByRole("button", { name: "+ suggest a fix" }));
    await user.type(getByRole("textbox", { name: "Suggested replacement (markdown)" }), "replaced");
    // Collapse — suggestion should drop out of the submission.
    await user.click(getByRole("button", { name: "− remove suggestion" }));
    expect(queryByRole("textbox", { name: "Suggested replacement (markdown)" })).toBeNull();
    await user.click(getByRole("button", { name: "Send" }));
    expect(calls).toEqual([["note", "", false]]);
    // Reopen — the text is still there for a rethink, not silently wiped.
    await user.click(getByRole("button", { name: "+ suggest a fix" }));
    expect(
      (getByRole("textbox", { name: "Suggested replacement (markdown)" }) as HTMLTextAreaElement)
        .value,
    ).toBe("replaced");
  });

  test("element anchors don't get the suggestion toggle (no natural 'before' text)", () => {
    const { queryByRole } = render(
      <DraftForm draft={elementDraft} onCancel={noop} onSubmit={noop} />,
    );
    expect(queryByRole("button", { name: "+ suggest a fix" })).toBeNull();
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

  test("Escape mid-IME-composition is not treated as a form cancel", () => {
    let cancelled = 0;
    const { getByRole } = render(
      <DraftForm draft={draft} onCancel={() => cancelled++} onSubmit={noop} />,
    );
    const body = getByRole("textbox", { name: "Comment (markdown)" });
    body.focus();
    // user-event can't flag isComposing — dispatch the raw event an IME cancel produces.
    body.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(cancelled).toBe(0);
  });

  test("Cmd/Ctrl+Shift+Enter in the body stages it (draft = true)", async () => {
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
    await user.type(body, "stage it");
    await user.type(body, "{Meta>}{Shift>}{Enter}{/Shift}{/Meta}");
    expect(calls).toEqual([["stage it", "", true]]);
  });

  test("Cmd/Ctrl+Enter in the body submits as Send (draft = false)", async () => {
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
