# Subprocess fakes

`tests/fakes/bin/` holds stand-ins for the external programs que spawns. Tests put
the directory **first on `PATH`** (`vi.stubEnv('PATH', ...)` in Vitest, `testEnv()`
in Playwright), so the daemon, the CLI, and the app find these instead of the real
binaries. `git` is never faked: tests use real repos in temp dirs. All three are
dependency-free Node scripts.

## `claude`

Parses the flags que uses (`-p`, `--output-format text|json|stream-json`, `--verbose`,
`--include-hook-events`, `--settings`, `--session-id`, `--resume`, `--max-turns`,
`--max-budget-usd`, `--permission-mode`, `--permission-prompts`, `--allowedTools`,
`--append-system-prompt-file`, `--model`, `--version`) and `agents --json`. Unknown
flags are ignored. Like the real CLI, `-p` with `stream-json` requires `--verbose`.

**Hooks.** Every `command` hook in the `--settings` `hooks` map (inline JSON or a
file) runs through `/bin/sh -c` with the session cwd and the inherited env, with
the hook JSON on stdin (`hook_event_name`, `session_id`, `cwd`, `transcript_path`,
`permission_mode`, plus the per-event fields). Matchers are honoured. A
`PreToolUse` hook exiting 2 blocks the tool.

**Headless scenarios** (`QUE_FAKE_CLAUDE_SCENARIO`, default `success`), one
message every `QUE_FAKE_CLAUDE_DELAY_MS` (default 30):

| Scenario      | Stream / hooks                                                                                     | Exit           |
| ------------- | -------------------------------------------------------------------------------------------------- | -------------- |
| `success`     | init, SessionStart, UserPromptSubmit, assistant + `Write` of `que-fake-change.txt`, Stop, `result` | 0              |
| `stall`       | init, SessionStart, UserPromptSubmit, one assistant, then hangs                                    | 143 on SIGTERM |
| `rate_limit`  | init, hooks, `rate_limit_event`, `system/api_retry`, StopFailure (`rate_limit`), then hangs        | 143 on SIGTERM |
| `max_turns`   | init, hooks, one assistant, `result` `error_max_turns`                                             | 1              |
| `crash`       | init, SessionStart, `fake claude: simulated crash` on stderr                                       | 1              |
| `needs_input` | init, hooks, Notification `permission_prompt`, then hangs                                          | 143 on SIGTERM |

`rate_limit` behaves as `success` when `QUE_FAKE_CLAUDE_RESUME_OK=1` and
`--resume` was passed.

**Interactive mode** (no `-p`): prints a banner and `> `; each line fires
UserPromptSubmit, a fake `Read` (Pre/PostToolUse), a reply, and Stop.
`/needs-input` fires the permission Notification and waits for `y`; `/exit` fires
SessionEnd and exits 0.

Other knobs: `QUE_FAKE_CLAUDE_TRANSCRIPT_DIR` (where `<session_id>.jsonl`
transcripts go; default under the OS temp dir), `QUE_FAKE_CLAUDE_AGENTS_JSON` (a
file whose contents `agents --json` prints instead of `[]`),
`QUE_FAKE_CLAUDE_VERSION`.

## `gh` and `code`

Each invocation appends one JSON line `{ "argv": [...], "cwd": "...", "ts": "..." }`
to `$QUE_FAKE_GH_LOG` / `$QUE_FAKE_CODE_LOG` when set. `gh auth status` reports
a logged-in account; `gh pr create ...` prints
`https://github.com/rquellh/que/pull/<n>`, where `n` counts the `pr create` calls
already in the log. Everything else exits 0 silently. Read the logs back with
`readFakeLog()` from `src/testing/fakes.ts` (Vitest) or `launched.ghCalls()` (E2E).
