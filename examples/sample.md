# miru sample document

This is a paragraph to review. **Select this sentence** to attach a comment. You can also try selecting text that spans multiple paragraphs.

Use the keyboard: `j` / `k` move between comments, `r` resolves, and `Esc` cancels a draft. Anchors follow minor edits — when they cannot be restored they move to a `stale` pile rather than disappear silently.

## Paragraph review

Long-form prose is where text anchors do real work. Try selecting any phrase here — a single word, a span across two sentences, or a chunk that crosses a `<strong>` boundary. The text offset is found by walking the DOM with `TreeWalker`; when the offset drifts after an edit, miru re-searches by the surrounding `prefix` and `suffix`. If even the quote disappears, the anchor is set aside as `stale` instead of being silently dropped.

> "Inline review is about pinning feedback to the rendered surface, not the file's bytes."
>
> — sample blockquote, also `Alt`+clickable as an element

## List

- **Critical**: fix the data-loss bug in the save flow
- **High**: add a filter UI to the comment panel
- **Nice-to-have**: polish keyboard shortcuts for navigation

### Nested list

- Anchors
  - `text` — quote + `prefix` / `suffix` re-search
  - `element` — selector → role + accessible name → tag chain + text hint
- Replies
  - One thread per comment
  - Resolved separately from answered

## Image (Alt+click for element comments)

![Sample figure](data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20width%3D%27240%27%20height%3D%2790%27%3E%3Crect%20width%3D%27240%27%20height%3D%2790%27%20rx%3D%278%27%20fill%3D%27%230969da%27%2F%3E%3Ctext%20x%3D%27120%27%20y%3D%2752%27%20font-size%3D%2722%27%20fill%3D%27white%27%20text-anchor%3D%27middle%27%3Emiru%3C%2Ftext%3E%3C%2Fsvg%3E)

## Code block (Alt+click for element comments)

```ts
export function greet(name: string): string {
  return `Hello, ${name}`;
}
```

You can also drop a text comment on an inline reference like `greet(name)` — it lives in flowing prose, not as a block element.

## Table

| Feature | Anchor | Status |
|---|---|---|
| Text selection | text | Implemented |
| Element click | element | Implemented |
| Suggested edit | suggestion | Implemented |
| Stale fallback | text | Implemented |

## Links

See the [miru repository](https://github.com/22mb/miru) for installation and full documentation. `Alt`+click the link itself to attach an element comment, or select the link text for a text-anchored comment.
