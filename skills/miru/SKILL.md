---
name: miru
description: Reviews existing Markdown / HTML documents (AI-generated drafts, articles, specs) inline in the browser "as rendered", and drives a continuous human↔AI review loop (comment → fix → reply → repeat) via the local `miru` CLI — `miru next` blocks until comments await you. Use when the user wants to review or get feedback on an .md/.html file, run a browser review session, or read and apply review comments stored in a *.miru.json file. Not for reviewing git diffs or code diffs — use difit for that.
---

# Inline review with miru

miru reviews AI-generated Markdown / HTML "as rendered" in the browser, crit-style: **a human comments in the browser → you reply and fix → repeat.** Fully local; nothing is sent externally.

## Prerequisites

Check that the `miru` binary is on PATH before doing anything else:

```sh
command -v miru
```

If it's missing, tell the human to install it and wait — do not proceed:

- macOS: `brew install 22mb/miru/miru`
- Other: download the OS / arch binary from https://github.com/22mb/miru/releases

## Before you start the loop

Start the review server in the background and keep it running for the whole session — it does not exit per round:

```sh
miru review <file.md|.html>
```

A browser opens. The human comments by selecting text or `Alt`+clicking an element, then either sends each comment immediately ("Comment") or stages several and clicks "Submit review". Editing the source file live re-renders the open browser, so the human sees your fixes as they land.

Do not call `miru review` more than once for the same file — re-running it will fail to bind the port.

## The review loop

Repeat until the human approves or ends the session:

```
- [ ] 1. `miru next <file>` — block until comments await you (or human approves)
- [ ] 2. If `approved` is true → stop.
- [ ] 3. For each comment in the JSON, edit the source file to apply the fix
- [ ] 4. `miru comment <file> --reply-to <id> "<what you did>"` for each
- [ ] 5. Go to 1
```

### 1. Wait

```sh
miru next <file>
```

**Blocks** until comments await you, or the human clicks "Approve", then prints JSON to stdout (logs go to stderr, so stdout parses cleanly):

```json
{ "approved": false, "comments": [ { "id": "c_…", "anchor": {…}, "body": "…", "suggestion": {…} } ] }
```

### 2. Stop on approval

**If `approved` is `true`, the human accepted the document — stop the loop.** Do not reply to anything; the session is over.

### 3. Apply each fix

For each returned comment, edit the source file:

- `anchor.type === "text"` → find the spot matching `anchor.quote`. If `quote` appears more than once in the file, use `anchor.prefix` and `anchor.suffix` to disambiguate (they are the text immediately before/after the quoted span).
- `anchor.type === "element"` → fix the element at `anchor.selector` (a CSS selector against the rendered HTML). `textHint` is the element's text at comment time — use it to confirm you're editing the right thing if the selector is ambiguous.
- If `suggestion.replacement` is present, apply it as-is unless the `body` says otherwise.

### 4. Reply

```sh
miru comment <file> --reply-to <id> "<what you did>"
```

This marks the comment **answered** so `miru next` won't hand it back. If the human isn't satisfied they reply in the browser, which re-opens the thread — `miru next` will return it again. The human **resolves** threads they're happy with; you do not resolve them.

## Examples

### Text anchor

Input (one comment from `miru next`):

```json
{
  "id": "c_a1",
  "anchor": { "type": "text", "quote": "perfomance", "prefix": "improve ", "suffix": " of the" },
  "body": "typo",
  "suggestion": { "replacement": "performance" }
}
```

You: edit the source, replacing `perfomance` with `performance` at the spot preceded by `improve ` and followed by ` of the`. Then:

```sh
miru comment doc.md --reply-to c_a1 "fixed typo: perfomance → performance"
```

### Element anchor

Input:

```json
{
  "id": "c_b2",
  "anchor": { "type": "element", "selector": "h2:nth-of-type(3)", "textHint": "Setup" },
  "body": "this section is too long, split it",
  "suggestion": null
}
```

You: locate the third `<h2>` (text "Setup") in the rendered output, find the corresponding heading in the source, split the section. Then:

```sh
miru comment doc.md --reply-to c_b2 "split Setup into Setup / Configuration"
```

## Commands

```sh
miru review <file>                            # Start the review server (run once, keep running)
miru next <file>                              # Block until comments await; print {approved, comments} JSON
miru comment <file> --reply-to <id> "<body>"  # Reply (marks comment answered)
miru comment <file> --resolve <id>            # Resolve a thread (normally the human does this)
miru comments <file> [--json]                 # List open (sent, unresolved) comments without a server
```

Use `miru next` for the interactive loop.

## Comment shape

Comments live in `<file>.miru.json`. Each has:

- `id` — identifier (use with `--reply-to` / `--resolve`).
- `anchor` — where it points: `{type:"text", quote, prefix, suffix}` or `{type:"element", selector, textHint}`.
- `body` — the reviewer's note.
- `suggestion` — `{replacement}` with proposed text, or `null`.
- `status` — `draft` (staged, not yet sent — ignore it), `sent` (awaiting you — `miru next` returns these), `answered` (you've replied).
- `resolved` — whether the human has closed the thread.
- `replies[]` — the discussion thread.

## Notes

- Fully local: no sharing, no URLs, no PR integration, no telemetry.
- stdout is reserved for command output (JSON / markdown); all logs go to stderr — safe to pipe stdout into `jq`.
