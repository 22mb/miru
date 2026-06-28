# miru Agent Skill

A skill that teaches AI agents how to use miru.

`miru install <agent>` places `SKILL.md` into the agent's skill directory (mirroring crit's `crit install <agent>`). Today only `claude-code` is supported — it installs to `~/.claude/skills/miru/SKILL.md`.

- Supported now: `claude-code`
- Planned: `cursor` / `codex`, etc. Until then, place `SKILL.md` manually into the tool's skill directory.

The skill drives the human↔AI loop through the headless CLI: `miru next` blocks until comments await the agent (or you approve), then the agent applies fixes and answers with `miru comment` (`miru comments --json` lists the open items). All are available today.
