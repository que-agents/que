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

A rebuilt daemon bundle does not reach a daemon that is already running, so
each side names the build it has. The daemon hashes its own bundle at start
(the first 12 hex characters of a sha256, `src/shared/build-id.ts`) and answers
`daemon.ping` with it as `buildId`; the app and the CLI hash the bundle they
would start. Only the daemon bundle counts, so a change to the window never
asks for a restart, and an unknown id on either side never does either.
`que daemon status` and `que doctor` show both ids and recommend `que daemon
upgrade`, with `que daemon restart` as the fallback. The app shows an Update
control beside Settings in the sidebar, which hands the terminals to the new
build in place (see below) and keeps every one running. If that fails (the
running daemon is too old to hand off, or the successor did not start), the
old daemon still serves, the error line says why, and the control stays for
another try. The app never restarts the daemon, since that ends every
terminal; only `que daemon restart` does. Both are always the user's click,
never automatic.

When the connection drops, the window says it is reconnecting and asks the
main process for the daemon's state, which reconnects or starts a daemon (after
the old one has exited). Once it is back (`daemon.reconnected`), the store
loads everything again, attaches the terminals that still exist, marks the
rest exited, sends `workspace.watch` for the shown workspace again (watches
belong to a connection), and lets a visited workspace open a fresh shell. A
failed reconnect shows its error and waits for the user's Reconnect.

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
terminal, pick up exactly where the screen was. A terminal handed over by a
previous daemon (see below) is an `AdoptedTerminal` over the inherited master
fd; `PtyHost` holds both kinds behind one interface.

Each terminal also reports two facts in its row (`TermInfo`): `title`, the
last title its program set with OSC 0 or 2, raw (an empty title clears it),
and `process`, the name of the program in its foreground (`zsh`, `claude`,
`cat`), kept after the terminal exits. The foreground program is read with
node-pty's native call on the master fd on every title change and once a
second; the kernel's name can be a versioned file the launcher points at, so
when it changes, `ps` on the terminal's tty finds the foreground group's
leader and its argv[0]. `term.updated` carries the row whenever either fact
changes, and only then.

The renderer's xterm sends what a terminal sends, with one addition. xterm
cannot tell Shift+Enter from Enter (both are a bare carriage return), so the
app sends a line feed for Shift+Enter: the Ctrl+J newline Claude Code accepts
in any terminal, and plain Enter to a shell or anything else that reads lines.

## Upgrading the daemon without ending terminals

A PTY is a file descriptor, so a terminal can change owners without the shell
noticing. `que daemon upgrade`, and the sidebar's Update through the app's main
process, ask the running daemon for `daemon.handoff` (the renderer cannot call
it directly), naming the daemon bundle and runtime of the que that asks,
normally the newly installed app's. Both go through `src/shared/upgrade.ts`,
which reports a failure as an answer, not a throw, and puts what it means into
words for both surfaces (`handOffFailedText`). The running daemon then:

1. stops reading every live terminal at the handle, so what the shells print
   from then on waits in the kernel, and serializes each mirror;
2. writes a versioned snapshot under `QUE_HOME` (per terminal: id, workspace,
   name, cwd, pid, size, its fd index, title, foreground program, and the
   serialized screen and scrollback) and spawns the new bundle detached, as `connectOrStart` would,
   with `--handoff --snapshot <file>`, the IPC channel at fd 3 and the master
   fds from fd 4.

The successor deletes the snapshot, adopts each fd (a tty stream for reading,
direct writes, node-pty's own native binding for resizing, the pid for
signals, end of stream as exit), rebuilds each mirror from the serialized
state and answers `adopted`. The old daemon stops its services, drops every
connection but the caller's and removes the socket, then says `bind`. The
successor binds the socket, writes the pid file, starts its services, starts
reading the terminals and answers `ready`. The old daemon answers the caller
with the new pid and exits without signalling any terminal, leaving the socket
and pid file to its successor. Clients reconnect and attach to the same
terminal ids; the attach replays the rebuilt mirror.

Carried over: every live terminal, with its id, shell, screen and scrollback.
Not carried over: task runs (the old daemon stops them as it lets go of the
socket, and the successor's queue recovery takes them up as after any
restart), file watches and pollers (they start fresh), exited terminals, the
start time (it is a new daemon), and an adopted terminal's exit code (the new
daemon is not the shell's parent, so an ended terminal reports 0).

Every wait on the successor has a timeout. If it fails, exits or does not
answer before `adopted`, the old daemon reads its terminals again and answers
with the error; after it has let go of the socket, it also kills the successor
(SIGKILL, so no shutdown of its runs), listens again with fresh services and
then answers. Either way no terminal ends; the error reaches the app's error
line or the CLI's stderr, and the fallback is `que daemon restart`.

After an Update the app reconnects as after any drop (the reconnect contract
above): the old connection closes as that daemon exits, the next one reaches
the successor, and `daemon.reconnected` fires. The terminal ids are the same,
so every pane attaches its terminal again and none is marked exited.
The sender lives in the running daemon, so the first upgrade to a que that has
this is still a restart.

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

The app resolves the login shell's PATH once at start (`src/shared/login-path.ts`)
and merges it in front of its own, and the daemon and editor launches inherit
it, so a Finder launch finds the same tools a terminal does. `que doctor`
reports what is on the daemon's PATH.

## The status engine

`status-engine.ts` is a set of pure functions: a hook event, a terminal exit,
a clock tick, or a `claude agents --json` entry goes in with the previous
status and `now`; the next status comes out. A prompt or tool use means
working, a stop means idle, a permission prompt means needs input, and no sign
of life for `stall_timeout_minutes` (a transcript file growing counts as life)
means stuck. A stop with agent-like background tasks (subagents, workflows,
teammates) still running keeps it working; a shell or monitor does not.
`status.ts` runs those rules per workspace, persists transitions,
and emits `workspace.updated` with the full row. Nothing in the rules reads the clock, so they are
tested exhaustively as plain functions.

The same hooks keep a record of the sessions that are live in workspace
terminals (`live-sessions.ts`). Every terminal carries its own id
(`QUE_TERMINAL_ID`), which `que hook` passes along, so a session start names
the terminal it runs in. An entry is written on the session's start and cleared
when Claude ends the session, when the terminal exits, or when it is killed;
headless task runs are never recorded, since the queue recovers those. The
record is saved in the store as it changes and frozen when shutdown begins, so
a crash leaves it as current as a clean stop. At start the next daemon consumes
each entry once and, unless the workspace is gone or archived, opens a terminal
in it that types `claude --resume <session>` once setup is done. An entry whose terminal is
alive in the new daemon came over with it and stays live rather than being resumed
again. While quiet
hours are locked the entries wait for the unlock. If a resume fails, the shell
shows the error and nothing else is typed; the daemon log names each session
it resumed or skipped.

## The sessions report

Every change of a workspace's status or reason is also appended to the
`workspace_status_log` table (and its creation, as `preparing`); rows older than
30 days are pruned as new ones arrive, and a workspace's rows go with it. The
morning report, `que report` and the morning summary build on that log alone:
`report-service.ts` gathers every open workspace's rows for the window (by
default the last 24 hours) and `report.ts` turns the digests into the report and
its count line. `digest.ts` turns one
workspace's log rows for the window (plus the last row before it, so time already
spent in a state when the window opened counts) into a `WorkspaceDigest`: time
spent working, how many times it asked for input, whether it is still waiting and
since when, how many times it got stuck, its pull request, and its commits ahead
of base. Commits ahead are counted against `origin/<default branch>` when that
ref exists, else the base the workspace was created from. Workspaces that did
nothing in the window and are not working, waiting or stuck are left out; the
rest are sorted with those needing input first, then stuck, then working.

## Pull request tracking

`prs.ts` keeps `Workspace.pr` fresh. Every `pr_poll_seconds` (default 60) it
asks `gh pr list --head <branch> --state all --limit 1` in each unarchived,
unprotected workspace, one call at a time; a merged or closed pull request is
re-checked only every fifth time. `pr-state.ts` maps the answer to state
(draft, open, merged, closed), checks (none, pending, passing, failing) and
review decision. When the result differs from the stored one (ignoring
`checkedAt`) it is saved in `pr_json` and `workspace.updated` is emitted. A
failed `gh` keeps the stored value and logs one line until a call succeeds
again. A successful `workspace.createPr` and a task reaching `done` trigger an
immediate check of that workspace.

Each check run and commit status from the rollup is kept too, as
`PullRequest.checkRuns`: name, workflow, state (failing, pending, passing,
skipped), link and times, failing first. The `checks` summary is derived from
them, and a run that changes counts as a change, so `workspace.updated` fires
when a check finishes even though `updatedAt` stays put.

`workspace.prThread` (`que ws pr`) answers the conversation: issue comments and
reviews from `gh pr view <n> --json comments,reviews`, line comments from
`gh api repos/{owner}/{repo}/pulls/<n>/comments --paginate`, parsed by
`pr-thread.ts` and sorted oldest first. Threads are fetched on demand, never
polled: each workspace's thread is cached with the pull request number and
`updatedAt` it was fetched for, and reused until the tracker stores a different
one (or the caller passes `refresh`). Concurrent calls share one fetch. A failed
`gh` raises `gh_failed` and caches nothing; the cache entry goes when the
workspace is removed or its pull request disappears.

## The diff view

`workspace.diff` (`que ws diff`) compares a workspace against its base: `origin/<default>` when that remote ref exists, else the default branch, unless the caller names another ref as `base` (`--base`), which must resolve to a commit. Everything is measured from the merge base of the base and `HEAD`, so committed and uncommitted changes appear together, and untracked files are listed too. Each file carries its status, line counts, whether it is still uncommitted, and a unified patch (null for binary files and patches over 200,000 characters). The result also lists the branch's commits past the base, newest first (at most 200), and the refs worth comparing against: the base, the default branch here and on origin, then the other local and origin branches, never the workspace's own (at most 50). Given a `commit` (`--commit`) that is on the branch and not on the base, the files narrow to that commit's own changes, against its parent (or the empty tree for a root commit), with nothing from the working tree; the commit count and list still describe the whole branch. A base or commit that does not qualify is a `bad_request`. It only reads: `git diff`, `git status`, `git log`, `git ls-files`, and `git for-each-ref`. Quiet hours refuse it like any other workspace read.

`workspace.files` (`que ws files`) lists every file of a workspace's worktree that git would show: tracked and untracked, never ignored (`git ls-files --cached --others --exclude-standard`), deduplicated and sorted, cut at 20,000 paths with `truncated` set; a missing worktree lists nothing. `workspace.readFile` reads one of them for the file view. The path must be relative and strictly inside the worktree: an absolute path, the root itself, or any empty, `.` or `..` segment is a `bad_request`, and so is a path whose real location, symlinks followed, falls outside the worktree's real root, or a directory. A missing path is `not_found`. A NUL byte in the first 8 KB marks the file binary and its content null; text is decoded as UTF-8 and cut at 500,000 characters with `truncated` set; `size` is always the byte size on disk. Both only read, and quiet hours refuse them like any other workspace read.

In the app, Changes and Files follow `workspace.changed` for the workspace on screen: while the review pane or one of its diff or file tabs is open, the store fetches the diff again in its scope (the base and commit stay), and while Files or a file tab is open, the listing and every open file tab too. A change that arrives during that fetch is followed once more after it lands; a closed pane with no view tabs fetches nothing until it opens, and a failure is kept for the views as any other. The Files tree keeps the directories the user opened and closed, except that a directory that newly holds a changed file opens.
`workspace.changed { id }` tells clients a workspace's worktree changed, so they can ask for the diff or the files again; the event carries nothing else and the daemon computes nothing for it. The daemon watches a workspace only while a window shows it or some connection is attached to one of its live terminals. The app says which workspace a window shows with `workspace.watch { id }` when it shows one and `workspace.unwatch { id }` when it leaves it, so the watch holds while a diff or a file tab covers the terminal; the daemon keeps the ids per connection. A watch or an attach starts the watch, and it stops when no connection wants the workspace any more: an unwatch, the last detach, the terminal's exit or kill, the connection closing, or the workspace's removal; shutdown closes every watch. Each watched workspace has two recursive watches. One is the worktree, ignoring the `.git` entry and everything under it. The other is the gitdir: a linked worktree's `.git` is a file whose `gitdir:` line points into the repository's `.git/worktrees/<name>`, which is where a commit, checkout or reset writes, and a main worktree's `.git` is the gitdir itself. Only `HEAD`, `ORIG_HEAD`, `index`, `packed-refs` and anything under `logs/` and `refs/` count there, so object writes do not. The first change that counts opens a 300 ms window and the event goes out when it closes, once per window per workspace however many changes it held.

## The ticket queue

`tickets.ts` keeps the tickets assigned to the user in the `tickets` table, the
way the pull request service keeps pull requests. It never writes to the
tracker. The tracker is read through the user's own `acli` (already signed in):
every `jira.poll_minutes` (first run a second after the daemon starts) it runs
`acli jira workitem search --jql <jira.jql> --json --fields key,summary,status,priority,issuetype,assignee,labels`
(the search refuses any other field, so the project comes from the key's prefix and there is
no updated time), upserts what came back,
drops tickets that vanished unless a workspace was started for them, and emits
`tickets.synced`. The queue keeps the order the search returned (a `position` column), so the
JQL's `ORDER BY` decides it. A failure stores the first line of stderr in the `kv` table as
the sync error (the list stays), logs once, and is cleared by the next success.
`tickets.list` only reads the cache.

Ticket links are `https://<site>/browse/<key>`, with the site from `[jira] site` or else from
`acli jira auth status` (read once per sync and cached; the search's `self` URLs point at an
internal API host). The search cannot return a ticket's parent, so after it the daemon runs
`workitem view KEY --fields parent` for every non-epic ticket whose parent was never checked
or was checked over a day ago (at most four at a time; a failure is logged and retried next
sync) and stores `parent_key` and `parent_checked_at`. A parent the search did not return is
kept as a synthesized ticket (`assigned = false`) built from the view's parent fields; it takes
the position of its first child, just before it, and is dropped when no ticket points at it any
more. Epics are overviews: `tickets.start` refuses them, and a started ticket's brief ends
with its parent's summary and description.

`tickets.start` fetches the full ticket with `acli jira workitem view`, flattens
its description (`adf-text.ts`) and renders a brief. The ticket's tracker project
picks the que project through `[jira.projects]`; with no mapping the daemon
answers `needs_project` and does nothing, and once the caller passes a project
the choice is written back to the config. The workspace is named
`<key>-<summary slug>`; the brief goes to `<worktree>/.que/ticket.md` (with
`.que/` added to the repository's `info/exclude`), and a terminal in the
workspace is typed `claude '<jira.start_prompt>'`. A second start reuses the
workspace. A loose session instead gets the brief at `<QUE_HOME>/tickets/<KEY>.md`
and a terminal in the home directory. Starting is refused in quiet hours.

A workspace can also start from a brief. `workspace.create` without a `name`
draws a random three-word name (`adjective-adjective-noun`, `names.ts`) for the
workspace, branch and folder, drawing again on a clash up to 50 times; an
explicit name is refused on a clash instead. The new-workspace dialog prefills
such a name and lets the user draw another or type their own, which it sends as
the explicit name. Tasks get random names too; tickets pass their own name. The
title is the given one, else the brief's first line (`brief.ts`), and is what the
sidebar shows; the brief goes verbatim to `<worktree>/.que/brief.md`.
`workspace.start` opens the workspace's first terminal when it has none, answers
with it, and once setup has ended types the command that starts Claude. By
default the brief is the first prompt: `claude "$(cat '<worktree>/.que/brief.md')"`,
so the shell hands it over verbatim. With `start_prompt` set, that text is sent
instead (`claude '<start_prompt>'`; it can tell Claude to read `.que/brief.md`),
and a workspace without a brief gets a bare `claude`. `workspace.rename`
changes the title and, for a branch with no `origin/<branch>`, can rename the
branch to a name the user gives; the folder keeps its name.

Once a session is running, the title is the session's own. Claude Code names a
session from its first prompt (or `/rename`) and writes the name to the terminal
title, `✳ <name>` when idle and `◐ <name>` while busy; `session-label.ts` drops
the glyph, the unnamed placeholder `Claude Code` and the empty exit title. The
daemon reads it on every `term.updated` and on each `SessionStart` hook (a
resumed session writes its name before the hook lands), but only from a
terminal the live-session record holds, so a shell's own title never counts. A
new name is stored with `title_source = 'terminal'` and announced with
`workspace.updated`; the empty title on exit leaves it in place. A title the
user gave, at creation or with `workspace.rename` (`title_source = 'user'`),
pins it: later session titles never replace it.

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

A manual quiet (`quiet.start`, `que quiet start [minutes]`) is a second source
of windows for the same enforcement: a start and a required end, at most 12
hours out, persisted in `quiet_manual` so it survives a daemon restart. The
scheduled window wins whenever both cover a moment, and one that starts during
a manual quiet ends it for good. Starting again replaces the window (and ends
any unlock); `quiet.end` ends it at once. It holds with quiet hours disabled,
config edits never end it, and the apply-tonight guardrail covers only the
scheduled windows. Unlocks inside it work the same and reach the daemon log,
but the unlock log (`quiet.log`, the report's unlocks line) keeps only the
night's. Its end, by expiry or `quiet.end`, emits the same summary with `kind:
'manual'`, worded for the day and skipped when nothing ran or waits; one that
quiet hours end leaves the night to the morning summary.

## The app

The main process proxies an allow-list of methods and forwards events to the
renderer, keeps the menu-bar title (`● 3 ▸ 1 ✕ 0`), shows the quiet board window
while locked, and checks once a day for a newer release. The renderer only
ever talks to `window.que`, which is why its component tests can run against
an in-memory fake of that bridge.
