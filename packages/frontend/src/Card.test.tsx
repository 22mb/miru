import "./register-dom.ts";
import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { HydratedComment } from "@miru/contract";
import { Card } from "./Card.tsx";
import { makeComment, makeReply } from "./fixtures.ts";

// Light component coverage: rendering of stale/resolved/suggestion state and the handler
// wiring (activate / toggle / remove / reply). user-event drives real DOM events, so the
// controlled-input reply flow is covered here rather than deferred to a manual browser pass.
// Queries come from render()'s return (bound at call time) rather than the global `screen`.

type Handlers = {
  onActivate?: () => void;
  onRemove?: () => void;
  onToggle?: () => void;
  onReply?: (body: string) => Promise<boolean> | boolean;
};

const noop = () => {};

function renderCard(
  comment: Partial<HydratedComment>,
  h: Handlers = {},
  stale = false,
  fresh = false,
) {
  return render(
    <Card
      comment={makeComment(comment)}
      active={false}
      stale={stale}
      fresh={fresh}
      onActivate={h.onActivate ?? noop}
      onHover={noop}
      onRemove={h.onRemove ?? noop}
      onToggle={h.onToggle ?? noop}
      onReply={h.onReply ?? (() => true)}
    />,
  );
}

// Restore the scrollIntoView patch (the "becoming active" test below) so it can't leak
// into later tests in this file — same discipline as anchor.test.tsx's Range patch.
const realScrollIntoView = HTMLElement.prototype.scrollIntoView;
afterEach(() => {
  cleanup();
  HTMLElement.prototype.scrollIntoView = realScrollIntoView;
});

describe("Card", () => {
  test("renders body html, stale badge, resolved state, and suggestion", () => {
    const { container, getByRole, getByText } = renderCard(
      { resolved: true, bodyHtml: "<em>note</em>", suggestion: { replacement: "use this" } },
      {},
      true,
    );
    expect(getByText("stale")).toBeDefined();
    expect(getByText("use this")).toBeDefined();
    expect(getByRole("button", { name: "reopen" })).toBeDefined();
    expect(container.querySelector(".miru-card")!.hasAttribute("data-resolved")).toBe(true);
    expect(container.querySelector(".miru-card__body")!.innerHTML).toContain("<em>note</em>");
  });

  test("clicking resolve calls onToggle", async () => {
    const user = userEvent.setup();
    let toggles = 0;
    const { getByRole } = renderCard({ resolved: false }, { onToggle: () => toggles++ });
    await user.click(getByRole("button", { name: "resolve" }));
    expect(toggles).toBe(1);
  });

  test("clicking Delete calls onRemove", async () => {
    const user = userEvent.setup();
    let removed = 0;
    const { getByRole } = renderCard({}, { onRemove: () => removed++ });
    await user.click(getByRole("button", { name: "Delete" }));
    expect(removed).toBe(1);
  });

  test("clicking the card body calls onActivate", async () => {
    const user = userEvent.setup();
    let activated = 0;
    const { container } = renderCard({}, { onActivate: () => activated++ });
    await user.click(container.querySelector<HTMLElement>(".miru-card")!);
    expect(activated).toBe(1);
  });

  test("action buttons don't bubble a card activation", async () => {
    const user = userEvent.setup();
    let activated = 0;
    const { getByRole } = renderCard({}, { onActivate: () => activated++, onToggle: noop });
    await user.click(getByRole("button", { name: "resolve" }));
    expect(activated).toBe(0);
  });

  test("composing a reply: type, submit, onReply gets the trimmed text, form closes", async () => {
    const user = userEvent.setup();
    const replies: string[] = [];
    const { container, getByRole } = renderCard(
      {},
      {
        onReply: (b) => {
          replies.push(b);
          return true;
        },
      },
    );

    await user.click(getByRole("button", { name: "Reply" }));
    const form = container.querySelector<HTMLFormElement>(".miru-reply-form")!;
    await user.type(within(form).getByRole("textbox"), "  looks good  ");
    await user.click(within(form).getByRole("button", { name: "Reply" }));

    expect(replies).toEqual(["looks good"]);
    expect(container.querySelector(".miru-reply-form")).toBeNull();
  });

  test("a failed reply (onReply resolves false) keeps the form open with its text", async () => {
    const user = userEvent.setup();
    const { container, getByRole } = renderCard({}, { onReply: () => Promise.resolve(false) });

    await user.click(getByRole("button", { name: "Reply" }));
    const form = container.querySelector<HTMLFormElement>(".miru-reply-form")!;
    await user.type(within(form).getByRole("textbox"), "keep me");
    await user.click(within(form).getByRole("button", { name: "Reply" }));

    // The parent toasts; the reviewer's words survive for a retry.
    expect(container.querySelector(".miru-reply-form")).not.toBeNull();
    expect(within(form).getByRole<HTMLTextAreaElement>("textbox").value).toBe("keep me");
  });

  test("reply submit stays disabled until non-whitespace text is entered", async () => {
    const user = userEvent.setup();
    const { container, getByRole } = renderCard({});
    await user.click(getByRole("button", { name: "Reply" }));
    const form = container.querySelector<HTMLFormElement>(".miru-reply-form")!;
    const submit = within(form).getByRole<HTMLButtonElement>("button", { name: "Reply" });
    expect(submit.disabled).toBe(true);
    await user.type(within(form).getByRole("textbox"), "ok");
    expect(submit.disabled).toBe(false);
  });

  test("a staged draft comment shows a draft badge and dashed card", () => {
    const { container, getByText } = renderCard({ status: "draft" });
    expect(getByText("draft")).toBeDefined();
    expect(container.querySelector(".miru-card")!.hasAttribute("data-draft")).toBe(true);
  });

  test("a fresh agent reply renders the data-fresh pulse hook", () => {
    const { container } = renderCard({}, {}, false, true);
    expect(container.querySelector(".miru-card")!.hasAttribute("data-fresh")).toBe(true);
  });

  test("an answered, unresolved comment shows the 'replied' pill", () => {
    const { getByText } = renderCard({ status: "answered", resolved: false });
    expect(getByText("replied")).toBeDefined();
  });

  test("an answered, resolved comment does not show the 'replied' pill", () => {
    const { queryByText } = renderCard({ status: "answered", resolved: true });
    expect(queryByText("replied")).toBeNull();
  });

  test("replies render a per-author label so human vs agent reads at a glance", () => {
    const { getByText } = renderCard({
      replies: [makeReply({ id: "r1", author: "human" }), makeReply({ id: "r2", author: "agent" })],
    });
    expect(getByText("You")).toBeDefined();
    expect(getByText("Agent")).toBeDefined();
  });

  test("becoming active scrolls the card into the panel viewport", () => {
    const scrollIntoView = mock(() => {});
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    const { rerender } = render(
      <Card
        comment={makeComment({})}
        active={false}
        stale={false}
        fresh={false}
        onActivate={noop}
        onHover={noop}
        onRemove={noop}
        onToggle={noop}
        onReply={() => true}
      />,
    );
    expect(scrollIntoView).not.toHaveBeenCalled();
    rerender(
      <Card
        comment={makeComment({})}
        active={true}
        stale={false}
        fresh={false}
        onActivate={noop}
        onHover={noop}
        onRemove={noop}
        onToggle={noop}
        onReply={() => true}
      />,
    );
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" });
  });

  test("Cmd/Ctrl+Enter in the reply textarea submits the reply", async () => {
    const user = userEvent.setup();
    const replies: string[] = [];
    const { container, getByRole } = renderCard(
      {},
      {
        onReply: (b) => {
          replies.push(b);
          return true;
        },
      },
    );

    await user.click(getByRole("button", { name: "Reply" }));
    const form = container.querySelector<HTMLFormElement>(".miru-reply-form")!;
    const textbox = within(form).getByRole("textbox");
    await user.type(textbox, "lgtm");
    // Either modifier should work; covers both macOS (Meta) and other platforms (Control).
    await user.type(textbox, "{Meta>}{Enter}{/Meta}");

    expect(replies).toEqual(["lgtm"]);
    expect(container.querySelector(".miru-reply-form")).toBeNull();
  });
});
