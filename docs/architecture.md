# Architecture

que is three kinds of process around one long-lived daemon. The daemon owns
everything that must outlive a window: terminals, workspaces, the overnight
queue, statuses, and quiet hours. The app and the `que` CLI hold no state of
their own; they are clients of the daemon's unix socket and can come and go.

```
  que.app (Electron)                          que CLI          Claude Code session
  ┌───────────────────────────┐            ┌──────────┐      ┌──────────────────────┐
  │ renderer (React, xterm)   │            │ commander│      │ hooks → `que hook`   │
  │   │ window.que (preload)  │            └────┬─────┘      └──────────┬───────────┘
  │ main: proxy, tray, board  │                 │                       │
  └────────────┬──────────────┘                 │                       │
               │   newline-delimited JSON over ~/.que/daemon.sock        │
               └───────────────┬────────────────┴───────────────────────┘
                               ▼
  ┌──────────────────────────────────────────────────────────────────────────────┐
  │ daemon (Electron binary as Node: ELECTRON_RUN_AS_NODE=1)                       │
  │  DaemonServer ─ quiet gate ─┬─ PtyHost: node-pty + headless xterm mirrors     │
  │                             ├─ Workspaces: projects, git worktrees, setup     │
  │                             ├─ Status engine: hooks + ticks → workspace status│
  │                             ├─ Task queue: dispatcher, runner, finisher       │
  │                             └─ Store: SQLite (node:sqlite) in QUE_HOME        │
  └──────────────────────────────────────────────────────────────────────────────┘
          │ spawns                         │ spawns                    │ spawns
      login shells                 claude -p (stream-json)         git, gh, caffeinate
```

## The daemon

`src/daemon/index.ts` starts once per `QUE_HOME`. Clients find it through the
socket; if the socket is missing or stale, `DaemonClient.connectOrStart()`
spawns the daemon detached and waits for `daemon.ping`. It runs under the
Electron binary with `ELECTRON_RUN_AS_NODE=1`, so `node-pty` is the one native
module and it is built once, for Electron's ABI. In the packaged app the daemon,
CLI and client bundles live in `que.app/Contents/Resources/{daemon,cli,client}`
and `node-pty` in `Resources/daemon/node_modules`, outside the asar archive.
`que daemon install` adds an opt-in launchd agent that starts it at login.

Quitting the app closes a socket connection and nothing more: terminals and
tasks keep running, and the next window reattaches.

## The protocol

`src/shared/protocol.ts` is the contract. Requests are `{ id, method, params }`,
responses echo the `id` with `result` or a structured `error` (`code`,
`message`), and events are `{ event, data }` pushed to every connection. The
`Methods` and `Events` maps type every call end to end: the daemon's handlers,
`DaemonClient.request()`, the CLI, the main process allow-list, and the preload
bridge the renderer sees (`src/preload/index.d.ts`). Framing is a line splitter
that copes with chunks split anywhere, including inside a multi-byte character.

## Terminals

`PtyHost` runs each terminal as a node-pty process and feeds every byte into a
headless xterm as well as to subscribers. Attaching takes a serialized snapshot
of that mirror (screen, scrollback, modes) and then streams live data, with
anything that arrives during the snapshot buffered so nothing is lost or
duplicated. That is what lets a relaunched app, or `que attach` in another
terminal, pick up exactly where the screen was.

## Workspaces and the hooks wrapper

A project is a registered git repository; a workspace is a git worktree on its
own branch under `worktree_root`, with the repo's `que.toml` setup command run
inside it. Workspace terminals start with `<QUE_HOME>/bin` first on `PATH`.
That directory holds two small scripts the daemon writes at startup:

- `claude` runs the `claude` the daemon resolved (`QUE_REAL_CLAUDE`, else the
  next one down `PATH`) and, inside a que workspace, adds
  `--settings <QUE_HOME>/hooks.json`. Outside one it is transparent. The
  user's own settings files are never written. If what it runs is another
  tool's wrapper that hands the command back (wrappers exec, so the pid is the
  same), it skips what it already tried and does not add `--settings` twice;
  a chain that keeps going fails with a message instead of looping.
- `que` runs the bundled CLI (with the app's own binary in a packaged build).

`hooks.json` registers `que hook` for every hook event, so each event a session
fires arrives at the daemon as JSON on stdin, tagged with the workspace it ran in.

## What a process que starts can see

The daemon, every terminal, and every headless run get a cleaned copy of the
environment (`src/shared/env.ts`): the markers a running coding-agent session
leaves in the shells it spawns are removed, so a session started in que is a
normal top-level one; the identity of whichever terminal emulator launched que
is removed, so programs pick generic terminal features that an embedded xterm
serves; app internals go too. `QUE_TERMINAL=1` is set. The user's own
configuration (an alternate config directory, provider selectors, limits) is
kept.

## The status engine

`status-engine.ts` is a set of pure functions: a hook event, a terminal exit,
a clock tick, or a `claude agents --json` entry goes in with the previous
status and `now`; the next status comes out. A prompt or tool use means
working, a stop means idle, a permission prompt means needs input, and no sign
of life for `stall_timeout_minutes` (a transcript file growing counts as life)
means stuck. `status.ts` runs those rules per workspace, persists transitions,
and emits `workspace.status`. Nothing in the rules reads the clock, so they are
tested exhaustively as plain functions.

## The task machine

An overnight task moves `queued → preparing → running → finishing → done`, and
may end `stuck`, `failed`, or `stopped`, or rest `paused` while a rate limit
lasts. `task-machine.ts` is one pure function from a task and an event (a
stream-json message, a hook, an exit, a tick) to the next task. Around it:

- the **dispatcher** starts queued tasks up to `concurrency` while the queue is open;
- the **runner** prepares a fresh workspace, runs `claude -p` with stream-json
  output, turn and dollar caps, and que's system prompt, and kills the run when
  the machine says so (caps, stall, stop);
- the **finisher** commits what the agent left, pushes the task branch (never
  the default or a protected branch), and opens a draft pull request with `gh`;
- a **keep-awake** (`caffeinate -i -w <daemon pid>`) is held while any task is
  active, and the clock tick resumes paused tasks when their limit resets;
- the **report** groups the night's tasks by outcome for `que report` and the app.

## Quiet enforcement

Quiet hours are enforced in the daemon, not the UI, so no client can see past
them. While a window is in progress and not unlocked, the server refuses the
detail methods (terminal attach and snapshot, reports, new tasks and
terminals) with a `quiet_hours` error and drops every live terminal
subscription the moment the window starts. Status, counts and the queue keep
working, which is all the quiet board needs: it answers "is it running, and is
it stuck?" and nothing else. An unlock lasts `unlock_minutes`, is logged with
its reason, and ends on its own. A config edit made during a window never
shortens tonight's window unless asked to. When the window ends, the daemon
emits one morning summary.

## The app

The main process proxies an allow-list of methods and forwards events to the
renderer, keeps the menu-bar title (`● 3 ▸ 1 ✕ 0`), shows the quiet board window
while locked, and checks once a day for a newer release. The renderer only
ever talks to `window.que`, which is why its component tests can run against
an in-memory fake of that bridge.
