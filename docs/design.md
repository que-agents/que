# Design

que is a tool you look at all day and glance at all night, so it is drawn like a
technical drawing: black and dark grey surfaces, hairline borders, dashed guide
lines between regions, small mono labels in brackets, and one warm accent.
Nothing shouts, and nothing is tinted: the greys are neutral. Status is a dot and
a word, not a coloured block.

The tokens live in `src/renderer/src/styles.css` under `:root`. Components use
them; nothing sets a colour, font, or radius inline.

## Surfaces

| Token             | Value     | Use                                                   |
| ----------------- | --------- | ----------------------------------------------------- |
| `--bg-side`       | `#111111` | The sidebar.                                          |
| `--bg`            | `#181818` | The main area, the terminal, the quiet board, windows. |
| `--bg-input`      | `#0e0e0e` | Text fields.                                          |
| `--bg-raised`     | `#202020` | Buttons, menus, dialogs, banners.                     |
| `--bg-hover`      | `#262626` | Hover on rows, buttons, menu items.                   |
| `--bg-active`     | `#2c2c2c` | The selected row; scrollbar thumbs.                   |
| `--border`        | `#272727` | Hairlines and dashed guides.                          |
| `--border-strong` | `#363636` | Menus, dialogs, hovered buttons.                      |

Surfaces step up by one token per layer: the sidebar is darker than the main
area, raised things (menus, dialogs) sit one step above it. Regions are divided
by a 1px hairline; the top bar uses the dashed
guide (`--dash`, 6px on, 6px off) instead, so the eye reads them as sections of
one drawing rather than separate panels. The sidebar's bottom group (Report, Tickets, Settings) is pinned to
the window's bottom edge above a solid hairline.

## Text

| Token            | Value     | Use                                                   |
| ---------------- | --------- | ----------------------------------------------------- |
| `--fg`           | `#eeeeee` | Names, titles, the selected row, anything primary.    |
| `--fg-secondary` | `#c9c9c9` | Rows at rest, buttons, menu items.                    |
| `--fg-muted`     | `#9b9b9b` | Hints, form labels, totals, the branch.               |
| `--fg-faint`     | `#6f6f6f` | Section labels, paths, counts, breadcrumbs, empties.  |

Body text is the system sans at 13px. Anything that is a label, an identifier,
or a measurement is mono at 10–11px: section labels, branch names, paths,
counts, short ids, costs, the unlock countdown. Section labels are uppercase,
letter-spaced, and bracketed (`[ PROJECTS ]`), drawn with `::before`/`::after`
so the DOM keeps the plain word.

## Accent and tones

| Token              | Value     | Use                                                                   |
| ------------------ | --------- | --------------------------------------------------------------------- |
| `--accent`         | `#c26157` | Links, the active tab's underline, focus rings, the terminal cursor.  |
| `--accent-2`       | `#ffb162` | Quiet-hours state: the unlock countdown, paused, needs input on the board. |
| `--inverse`        | `#e6e6e6` | The one primary button on a screen, light on dark.                    |
| `--tone-busy`      | `#4f8cf5` | working, running, preparing.                                          |
| `--tone-attention` | `#f99c00` | needs input, paused.                                                  |
| `--tone-bad`       | `#fb2c36` | stuck, failed, exited badly; the danger button.                       |
| `--tone-good`      | `#34c26b` | done, idle after work.                                                |
| `--tone-neutral`   | `#7a7a7a` | idle, queued.                                                         |
| `--tone-muted`     | `#5a5a5a` | stopped, exited.                                                      |

The accent is the only warm colour and it is used sparingly, so it keeps
meaning "this is the thing" (the active tab, a link, the cursor). A status
badge (`.status.tone-*`) is a 5px dot and a mono word, tinted at 12% with a
32% border of its tone. It never fills with colour: at a glance the dot tells
the story, and a wall of filled pills is exactly the noise que exists to
remove. The quiet board uses the same tones as plain text.

## Shapes

- Corners are nearly square: 2px on buttons, inputs, dialogs and fieldsets; 4px
  (`--radius`) on rows and menus. Nothing is a pill except the status dot.
- Borders are 1px. Shadows appear only under things that float (menus, dialogs).
- Dialogs carry four small corner points, the marks of a drawing's frame.
- Icons are 16px line drawings at a 1.5px stroke, inline SVG from
  `components/icons.tsx`, drawn in the current text colour: faint in a ghost
  button, bright on hover. The button carries the accessible name. No icon
  font or library.
- Two panes are divided by a 7px track like the sidebar's: invisible until hover,
  focus or drag, then a 1px accent line. The focused pane's tab strip carries a
  1px accent line at its top; with one pane there is none.
- The review pane is a full-height column at the right of the window, the sidebar's
  mirror: it runs from the window's top edge to the bottom on `--bg-side` behind a 1px
  hairline, and the top bar spans only the middle column. It is 320px wide, dragged
  between 240 and 520px on a 7px track like the sidebar's (double-click resets, arrow
  keys move it), and remembered with its tab. Its strip is 40px tall, lined up with the
  top bar above a solid hairline, and holds two tabs, Changes and Pull request, drawn
  like a pane's tabs, and a close button at the right end. One icon button at the right
  end of the top bar (a frame with a divider toward its right edge, filled while open)
  toggles the pane on its remembered tab, and so does ⌘B. `Open in editor` is a ghost
  button in the Changes header beside Refresh; `Create draft PR` is in the Pull request
  footer while the workspace has no pull request. Clicking a file in Changes opens that
  file's diff as a tab in the middle, in the focused pane's strip beside the session
  tabs: a line icon and the file's name, never a status dot, closed with ⌘W like a
  terminal tab. Nothing replaces or hides the terminals.
- Row actions (the ⋯ button) show on hover, focus, or while their menu is open.
- The window has no native title bar. The traffic lights sit in the 40px strip
  above the sidebar's content; that strip, the top bar's empty space and the review
  pane strip's empty space drag the window.
- The sidebar's divider drags between 180 and 520px, double-click resets it, and
  the arrow keys move it when it has focus; the width is remembered.
- Search is an icon in the title strip (`button.ghost.icon`, a magnifier), in line
  with the window buttons at the strip's right end; it takes `--accent` while the
  field is open. Click or ⌘K pops out a field in the first row: a mono 12px input on
  `--bg-raised` with a 1px `--border` (`--accent` on focus). Escape, or leaving it
  empty, folds it away and clears the narrowing; text keeps it open. The Projects head
  carries a sort toggle (`button.ghost.icon`, three lines of decreasing length)
  between name and last activity; the choice is remembered.
- The top bar reads `project / workspace`, with the branch after it only when
  the branch is not the workspace's own name, then the status, the pull request chip
  and the working directory; at its right end, split or join and the review pane
  toggle, all icon buttons. The title truncates with an ellipsis before the buttons
  give way. The pull request chip is `PR #n · state`; failing
  checks and a requested change are its tone, and its tooltip spells them out.

## Adding something

Pick the surface by layer, the text colour by role, and the tone by meaning.
If a new element needs a colour that is not a token, the design is probably
wrong rather than the palette. Check the screenshots the e2e specs leave in
`test-results/` after `npm run e2e`.
