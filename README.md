<p align="center">
  <img src="assets/logo.svg" alt="miru" width="88">
</p>

<p align="center">
  <b>English</b> · <a href="README.ja.md">日本語</a>
</p>

# miru

miru (見る, "to see") is a local tool for inline review of AI-generated Markdown / HTML, as rendered in the browser.
Select body text or `Alt`+click an element to leave a comment right there.
Fully local — nothing is sent externally.

## Features

- **Built with Bun, single binary**: users need no runtime such as Bun (`bun build --compile` bundles the runtime itself).
- **Two anchor types**: text ranges (`text`) and elements (`element`). They track the original file across minor edits; when they can't be restored they are set aside as `stale`.
- **suggestion**: a comment can carry a fix proposal (replacement text), which can be passed straight to an LLM as a correction instruction.
- **Human↔AI review loop**: `miru review` blocks until you press "Approve," then prints the unresolved comments as JSON. You can reply or resolve from the browser or headless CLI, and whenever the file changes the open page updates in place (SSE) — the document is swapped without a reload, so your scroll position, the panel, and a half-typed reply all survive, and what changed flashes briefly. Keyboard shortcuts: `j` / `k` to move, `r` to resolve, `Esc` to cancel a draft.
- **Security**: binds only to `127.0.0.1`, gates `/api/*` on a per-launch token (the SSE feed at `/api/events` is excepted — it only pushes content-free update hints), validates Host and Origin (CSRF and DNS rebinding protection), applies a strict CSP, and sanitizes input HTML server-side. The default sanitization keeps the document's own presentation (CSS, static SVG, media) while stripping everything executable; `--strict` reduces it to typography only. The review panel renders in a shadow root, out of reach of the document's CSS.
- **Fully local**: comments are saved to `<file>.miru.json`. No sharing, external transmission, or telemetry.

## Installation

### Homebrew (macOS / Linux)

```sh
brew tap 22mb/miru
brew trust 22mb/miru   # required on Homebrew 6.x+ (third-party tap)
brew install miru
```

The `brew trust` step is a no-op on older Homebrew where third-party taps load without it.

### Binary

Download the OS / arch binary (win / macOS / linux) from GitHub Releases and run it.

### Skill

miru ships a [skill](skills/miru/SKILL.md) that teaches an AI agent (Claude Code, etc.) to drive the comment → fix → reply loop. Pick either route:

```sh
# via the gh skill extension
gh skill install 22mb/miru

# via miru itself
miru install
```

Both drop `SKILL.md` at `~/.claude/skills/miru/SKILL.md`. Only `claude-code` is supported today.

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
| `--strict` | Typography-only sanitization: drop the document's own CSS / SVG / media (max spoofing resistance for untrusted files) |
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
| `miru install [claude-code]` | Install the bundled skill into `~/.claude/skills/miru/SKILL.md`. |
| `miru --version` (`-v`) | Print the embedded build version and exit. |

### Use with an AI agent

Once the [skill](skills/miru/SKILL.md) is installed (see [Skill](#skill)), the agent runs `miru review`, reads the JSON, applies fixes, and replies — repeating until you approve with zero comments.

## Alternatives

If **code review (git diff) is your primary goal**, [difit](https://github.com/yoshiko-pg/difit) is the right tool.
If you want **richer features**, consider [crit](https://crit.md/).
miru focuses narrowly on inline review of rendered md / HTML — no generation, sharing, or PR integration.

## License

[MIT](LICENSE)
