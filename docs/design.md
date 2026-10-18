# Design

que is a tool you look at all day and glance at all night, so it is drawn like a
technical drawing: black and dark grey surfaces, hairline borders, dashed guide
lines between regions, small mono labels in brackets, and one cool accent.
Nothing shouts, and nothing is tinted: the greys are neutral. Status is a dot and
a word, not a coloured block.

The tokens live in `src/renderer/src/styles.css` under `:root`. Components use
them; nothing sets a colour, font, or radius inline.

## Surfaces

| Token             | Value     | Use                                            |
| ----------------- | --------- | ---------------------------------------------- |
| `--bg-side`       | `#111111` | The sidebar, the review pane, the quiet board. |
| `--bg`            | `#181818` | The main area, the terminal, windows.          |
| `--bg-input`      | `#0e0e0e` | Text fields.                                   |
| `--bg-raised`     | `#202020` | Buttons, menus, dialogs, banners.              |
| `--bg-hover`      | `#262626` | Hover on rows, buttons, menu items.            |
| `--bg-active`     | `#2c2c2c` | The selected row; scrollbar thumbs.            |
| `--border`        | `#272727` | Hairlines and dashed guides.                   |
| `--border-strong` | `#363636` | Menus, dialogs, hovered buttons.               |

Surfaces step up by one token per layer: the sidebar is darker than the main
area, raised things (menus, dialogs) sit one step above it. Regions are divided
by a 1px hairline; the top bar uses the dashed
guide (`--dash`, 6px on, 6px off) instead, so the eye reads them as sections of
one drawing rather than separate panels. The sidebar's bottom group (Report, Tickets, Settings) is pinned to
the window's bottom edge above a solid hairline.

## Text

| Token            | Value     | Use                                                  |
| ---------------- | --------- | ---------------------------------------------------- |
| `--fg`           | `#eeeeee` | Names, titles, the selected row, anything primary.   |
| `--fg-secondary` | `#c9c9c9` | Rows at rest, buttons, menu items.                   |
| `--fg-muted`     | `#9b9b9b` | Hints, form labels, totals, the branch.              |
| `--fg-faint`     | `#6f6f6f` | Section labels, paths, counts, breadcrumbs, empties. |

Body text is the system sans at 13px. Anything that is a label, an identifier,
or a measurement is mono at 10–11px: section labels, branch names, paths,
counts, short ids, costs, the unlock countdown. Section labels are uppercase,
letter-spaced, and bracketed (`[ PROJECTS ]`), drawn with `::before`/`::after`
so the DOM keeps the plain word.

## Accent and tones

| Token              | Value     | Use                                                                                                           |
| ------------------ | --------- | ------------------------------------------------------------------------------------------------------------- |
| `--accent`         | `#3fcdb4` | Links, the active tab's underline, focus rings, the cursor, the unlock countdown, the sidebar's working mark. |
| `--accent-hover`   | `#6adcc7` | The accent under the pointer.                                                                                 |
| `--inverse`        | `#e6e6e6` | The one primary button on a screen, light on dark.                                                            |
| `--tone-busy`      | `#4f8cf5` | working, running, preparing (outside the sidebar, which draws the working mark).                              |
| `--tone-attention` | `#f99c00` | needs input, paused.                                                                                          |
| `--tone-bad`       | `#fb2c36` | stuck, failed, exited badly; the danger button.                                                               |
| `--tone-good`      | `#34c26b` | done, idle after work: a sidebar row that finished since you last looked at it.                               |
| `--tone-neutral`   | `#7a7a7a` | idle, queued.                                                                                                 |
| `--tone-muted`     | `#5a5a5a` | stopped, exited.                                                                                              |

The accent is a teal, apart in hue from both the done green and the working
blue, and it is used sparingly, so it keeps meaning "this is the thing" (the
active tab, a link, the cursor, an unlock while it runs). It is the same colour
in the mark (the icon's dot), the UI and the quiet board. Status is a tone,
never the accent, with one exception: the sidebar's working mark (see Sidebar),
since teal already marks the live thing. A status
badge (`.status.tone-*`) is a 5px dot and a mono word, tinted at 12% with a
32% border of its tone. It never fills with colour: at a glance the dot tells
the story, and a wall of filled pills is exactly the noise que exists to
remove. The quiet board uses the same tones on a dot or a word, never a badge.

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
  top bar above a solid hairline, and holds three tabs, Changes, Files and Pull request,
  drawn like a pane's tabs, and a close button at the right end. One icon button at the right
  end of the top bar (a frame with a divider toward its right edge, filled while open)
  toggles the pane on its remembered tab, and so does ⌘B. The Changes header is one
  line, `Commits n vs base` (the count and `vs` muted, the full counts in its tooltip),
  with refresh and open-in-editor icon buttons at its right end. Each half of the line
  opens a menu: `Commits n` lists the commits, newest first with their age, and narrows
  the files to one (the line then reads `Commit <sha>`, its subject in the tooltip), and
  `vs base` picks the ref to compare against, remembered per workspace; the current
  choice is marked with the active fill; `Create draft PR` is
  in the Pull request footer while the workspace has no pull request. Clicking a file in Changes opens that
  file's diff as a tab in the middle, in the focused pane's strip beside the session
  tabs: a line icon and the file's name, never a status dot, closed with ⌘W like a
  terminal tab. The Files header is one line too, `Files n · m changed` (both counts
  muted, the full detail in its tooltip), with the same two icon buttons. Below it the
  worktree is a tree: directories first, then files, each sorted without regard to case,
  12px of indent per level, a chevron on each directory that turns while it is open, and
  a directory holding only another directory folded into one row (`src/renderer/src`).
  A file Changes lists carries its glyph and reads `--fg`, an unchanged one `--fg-muted`,
  a deleted one `--fg-faint`; a directory reads `--fg-secondary` and counts the changed
  files beneath it at its right end in mono `--fg-faint`. Directories with changes start
  open, the rest closed; after that the user's clicks stand for the session. A changed
  file opens its diff tab; an unchanged one opens a read-only file tab the same way (a
  page icon and the name): the path in mono `--fg-faint` above the text in mono 12px
  with faint line numbers, unwrapped, scrolling both ways. Nothing replaces or hides
  the terminals.
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

## Sidebar

The sidebar is a list you glance at: a dot per row, a word only when asked, controls
only under the pointer.

- **The rail.** `.sidebar` is padded `40px 6px 0`. Every row is 26px tall with a
  `0 8px` inset and `--radius`; section heads are 24px with the same inset. Each row
  starts with a 16px icon column and a 6px gap, so every name sits on one rail, 36px
  from the edge, and the dots line up under the folders. A project head carries a
  folder (`--fg-faint`) and its name in sans 12px 500 `--fg-muted` (`--fg-secondary`
  under the pointer); a session carries `›_` in mono; a workspace carries its dot.
- **The dot.** A workspace row is a 5px dot in its tone and the name, nothing else:
  the tone is the live task's state when there is one, else the workspace status. A
  workspace that is working, or has a task preparing, running or finishing, shows the
  working mark instead: four 3px `--accent` dots on a 2×2 grid at a 5px pitch, with a
  diagonal ripple across them (the top-left first, the top-right and bottom-left 120ms
  later, the bottom-right 120ms after that; each grows over 0.36s, holds 0.3s, shrinks
  over 0.36s, in a 1.2s loop, so the mark is never empty). It is a CSS animation, no
  timers, and under `prefers-reduced-motion` the four dots stand still at full size.
  This is the one place status takes the accent, so `--tone-busy` never appears in the
  sidebar. The quiet board keeps its still blue dots: nothing moves at night.
- **The weight of a name.** `--fg` when the row needs you (finished since you last
  looked, needs input, or stuck); `--fg-secondary` while it works; `--fg-faint` once you have
  looked and nothing is new, and the same faint for an exited workspace, told apart by
  its `--tone-muted` dot. The selected row reads `--fg` on `--bg-active` whatever its
  state. Most rows sit faint most of the time; the few that need you are two steps
  brighter.
- **Finished, not looked at.** A workspace whose turn ended (working to idle) or whose
  task finished since the app last had it selected in a focused window shows the done
  tone, `--tone-good` (the tone table's "idle after work"), on its dot and its name at
  `--fg`. Selecting it returns it to its own dot and the faint weight. Needs input and
  stuck keep their tones: orange and red already mean "now", green means "fresh". A
  collapsed project head counts these before its total, `1 done · 3`, the `done` in
  `--tone-good`; otherwise it shows its count alone, mono 11px `--fg-faint`. The daemon
  keeps the two timestamps (`finishedAt`, `seenAt`); the quiet board ignores the state.
- **Under the pointer** (and on keyboard focus, and while the row's menu is open) a
  row shows an overlay at its right end, painted on the row's own hover background:
  the status word in mono 11px `--fg-faint` (its tone for needs input and stuck), then
  ⋯. For a fresh finish the word is `done · 12m ago`, or the task's ask, `done · draft
  PR #12` or `done · no changes`. The overlay covers the end of a long name rather
  than reflowing it, so nothing jumps. A project head under the pointer turns its
  folder into its chevron and shows `+` and ⋯; the section heads' buttons (Sessions
  `+`, Projects add and sort) likewise stay at opacity 0 until the head is under the
  pointer, holds the keyboard focus, or has its menu open. Clicking anywhere on a
  project head folds it. An exited session reads faint, with `exited` as its word.
- **The foot.** Report, Tickets and Settings are 26px rows in `--fg-muted`, `--fg`
  under the pointer. During an unlock a row above them carries the open lock at 12px
  and `m:ss left` in mono 11px `--accent`, and `lock now` in mono 11px `--fg-faint` at
  its right end (`--fg-muted` under the pointer), always visible: locking again is the
  behaviour we want. The row is a `role="status"` region.

## Quiet board

The quiet board is the only window during quiet hours, and its one question is
"running and not stuck?". It answers from across the room without pulling you
in, so nothing on it may read as a message or a call to action: no sentences,
no large type, no filled badges, no emoji. It is a dim instrument panel on
`--bg-side` with the four corner points (3px, `--fg-faint`): a 24px strip with
the q mark at 18px (`--fg-muted`, its dot the board's one use of the accent),
the `[ QUIET HOURS ]` label and the clock in mono `--fg-muted` with `· until
HH:MM` faint; one faint mono count line (`.count-line`) that lists only the
non-zero counts, where only `stuck` takes a tone (`--tone-bad`) and `running`
reads `--fg-muted`; 30px dot rows (`.dot-row`) one notch dimmer than the
sidebar, the name in `--fg-secondary` and everything else in mono
`--fg-faint`; and a footer holding only the Unlock button, the one control,
drawn not to tempt: a word and the open-lock icon in the same
mono `--fg-faint`, no border and no fill, with a `--border` hairline and
`--fg-muted` only under the pointer. The window end appears once, as `until
HH:MM` in the strip.
Needs input is not a night state: it reads `waiting`, faint, with a neutral
dot, and the locked tray title leaves its count out (`● 3 ✕ 0`).

## Report

The report is the morning page (what the night did, what needs a look, what it
cost) and reads in the quiet board's language: a left-aligned 720px column;
`since 19:00 yesterday` in the topbar in mono `--fg-faint` beside a refresh
icon; one count line with only the non-zero items (`2 done · 1 stuck · 1 PR ·
1h 07m · $1.20`, or `nothing ran since 19:00`), built by the same function as
the morning notification so both say the same words; a faint unlocks line
(`2 unlocks · 23:40 for 20 min · 01:12 for 11 min`) when there were any; then
the bracketed section labels over 30px dot rows. Unlike the board, needs
input keeps its tone in the morning, since that is when it is acted on; still
one tone per row, on the dot and the state, never a filled block. The pull
request is a mono `--accent` link that reads `#67 draft` (`· checks failing`
when they are), never its URL.

## Adding something

Pick the surface by layer, the text colour by role, and the tone by meaning.
If a new element needs a colour that is not a token, the design is probably
wrong rather than the palette. Check the screenshots the e2e specs leave in
`test-results/` after `npm run e2e`.
