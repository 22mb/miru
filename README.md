<p align="center">
  <img src="assets/logo.svg" alt="miru" width="88">
</p>

<p align="center">
  <b>English</b> · <a href="README.ja.md">日本語</a>
</p>

# miru

A local tool for inline review of AI-generated Markdown / HTML, as rendered in the browser.
Select body text or `Alt`+click an element to leave a comment right there.
Fully local — nothing is sent externally.

## Features

- **Built with Bun, single binary**: users need no runtime such as Bun (`bun build --compile` bundles the runtime itself).
- **Two anchor types**: text ranges (`text`) and elements (`element`). They track the original file across minor edits; when they can't be restored they are set aside as `stale`.
- **suggestion**: a comment can carry a fix proposal (replacement text), which can be passed straight to an LLM as a correction instruction.
- **Human↔AI review loop**: `miru review` blocks until you press "Approve," then prints the unresolved comments as JSON. You can reply or resolve from the browser or headless CLI, and the open page live-reloads (SSE) whenever the file changes. Keyboard shortcuts: `j` / `k` to move, `r` to resolve, `Esc` to cancel a draft.
- **Markdown export**: bundle all unresolved comments and suggestions into a fix-instruction markdown (`miru export`, or the panel's **Export** button) to hand to an LLM.
- **Security**: binds only to `127.0.0.1`, gates `/api/*` on a per-launch token (the SSE feed at `/api/events` is excepted — it only pushes content-free reload hints), validates Host and Origin (CSRF and DNS rebinding protection), applies a strict CSP, and sanitizes input HTML server-side.
- **Fully local**: comments are saved to `<file>.miru.json`. No sharing, external transmission, or telemetry.

## Installation

### Binary

Download the OS / arch binary (win / macOS / linux) from GitHub Releases and run it.

## Usage

```sh
miru review <file.md|.html>
```

A browser opens.
Select body text to comment, or `Alt`+click to comment on elements such as images and code blocks.
Comments are saved to `<file>.miru.json` alongside the target file.

| Option | Description |
|---|---|
| `--port <n>` | Specify the port (default: random) |
| `--no-open` | Don't open the browser automatically |
| `--unsafe-raw` | Disable sanitization of input HTML (trusted input only) |
| `--lang <code>` | `lang` attribute of the rendered document (default: `en`) |

### Commands

| Command | Description |
|---|---|
| `miru review <file>` | Open the browser review. Blocks until "Approve," then prints `{ approved, comments }` JSON to stdout (one round of the human↔AI loop). |
| `miru comments <file> [--json]` | Print unresolved comments without starting a server. |
| `miru comment <file> --reply-to <id> "<body>"` | Reply to a comment. |
| `miru comment <file> --resolve <id>` | Mark a comment resolved. |
| `miru next <file>` | Block until comments await the agent (or you approve), then print them as JSON — the agent loop (`next` → fix → reply). |
| `miru export <file>` | Print all unresolved comments and suggestions as fix-instruction markdown to hand to an LLM. |
| `miru install [claude-code]` | Install the bundled skill into `~/.claude/skills/miru/SKILL.md`. |

### Use with an AI agent

miru ships a [skill](skills/miru/SKILL.md) that teaches an AI agent to drive the loop (comment → fix → reply → next round).
Install it with `miru install`; the agent then runs `miru review`, reads the JSON, applies fixes, and replies — repeating until you approve with zero comments.

## Alternatives

If **code review (git diff) is your primary goal**, [difit](https://github.com/yoshiko-pg/difit) is the right tool.
If you want **richer features**, consider [crit](https://github.com/).
miru focuses narrowly on inline review of rendered md / HTML — no generation, sharing, or PR integration.

## License

[MIT](LICENSE)
