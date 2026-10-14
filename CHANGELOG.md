# Changelog

All notable changes to que are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and que uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Add project is a folder-plus line icon, and the other add buttons (session,
  workspace, terminal tab) use a matching plus; icons are inline SVG.
- The sidebar starts with a Sessions section: one row per terminal outside a
  workspace, a + to open another, and the selected one marked. It replaces
  the single Terminals row, and the view it opens is titled Sessions.
- The window no longer has a native title bar: the app's chrome runs to the
  top, the traffic lights sit over the sidebar, and that strip and the top
  bar's empty space drag the window.
- A new look: a black-and-grey dark theme with hairline borders and
  dashed guide lines between regions, system sans for reading and mono for
  labels and metadata, one coral accent, and status shown as a dot and a
  word. The top bar reads project / workspace. `docs/design.md` records the
  tokens and the rules.
- Settings no longer shows the overnight queue's defaults (concurrency, turn
  and dollar caps, default permission mode); they live in the config file.
  Protected branches, which also guard Create draft PR, sit under a Pull
  requests heading.

### Added

- The sidebar is resizable: drag the divider (180 to 520px), double-click it
  to reset, or use the arrow keys when it has focus. The width is remembered.
  The app's own data (such as this) now lives under `QUE_HOME/app`, so a test
  `QUE_HOME` isolates it too.
- Right-click a project or a workspace in the sidebar for its actions (the ⋯
  button offers the same). Projects can now be removed from the app; their
  workspaces go with them, worktrees deleted and branches kept.

### Removed

- The Tonight panel in the sidebar (add task, queue control, task list) and
  the hand-off of a live session to the queue (`que handoff`, the Hand off…
  actions, `handoff.create`). Sessions keep running in their own worktrees;
  overnight tasks are queued and run with `que add` and `que run`, show in
  the sidebar as the workspaces they run in, and in the report.

### Fixed

- Terminals and headless runs start with a cleaned environment: the markers a
  running coding-agent session leaves in its shells are removed (a session in
  que is a top-level one again, with transcripts saved), and the launching
  terminal emulator's identity is removed (programs no longer try keyboard
  protocols the embedded terminal cannot serve, so Tab accepts prompt
  suggestions). `QUE_TERMINAL=1` marks a que terminal.
- The `claude` wrapper in workspace terminals no longer hangs when another
  `claude` wrapper on `PATH` hands the command back to it. The chain now ends
  at the real executable with `--settings` added once, and a wrapper that
  keeps spawning instead fails with a message. `QUE_REAL_CLAUDE` pins the
  executable when `PATH` resolution is not what you want.

## [0.1.0] - 2026-10-14

The first release.

### Added

- A daemon that owns every terminal (node-pty with a headless mirror for
  reattach), project, workspace, and task, on a unix socket in `~/.que`; the
  app and the CLI are clients, so sessions outlive the app.
- Workspaces: git worktrees on their own branch, with per-repo setup and
  teardown from `que.toml` and `.worktreeinclude`.
- A status engine fed by Claude Code hooks through a per-session wrapper (the
  user's settings are never written): working, idle, needs input, stuck.
- The work-mode app: a sidebar of projects and workspaces with live status,
  terminal tabs, a tasks panel, and a menu-bar title.
- Overnight tasks: `que add` and `que run` queue briefs that run headless in
  their own workspaces with turn and dollar caps, a stall timeout, rate-limit
  pauses, and a keep-awake; the finisher pushes the branch and opens a draft
  pull request; `que report` and the app show the morning report.
- Quiet mode: quiet hours enforced by the daemon, a quiet board that only says
  what is running and whether it is stuck, unlocks with a reason log, chimes,
  a morning summary, and settings.
- The `que` CLI, `que doctor`, and an opt-in launchd agent.
- Packaging: an unsigned macOS app (DMG and zip) with the daemon, CLI and
  node-pty outside the asar, an "Install 'que' command in PATH" menu item, and
  a daily check for a newer release.

[Unreleased]: https://github.com/rquellh/que/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/rquellh/que/releases/tag/v0.1.0
