# Contributing to que

Thanks for helping. que is small on purpose; a good change keeps it that way.

## Setup

You need macOS on Apple Silicon, Node 24, and git. Then:

```sh
git clone https://github.com/rquellh/que.git
cd que
npm ci          # also rebuilds node-pty for Electron (postinstall)
npm run dev     # the app with hot reload, using ~/.que
```

To try things without touching your real state, set `QUE_HOME` (and
`QUE_CONFIG`) to a scratch directory first; every test and script does.

## Before you open a pull request

```sh
npm run verify
```

runs typecheck, lint, build, the Vitest suites, the smoke check, and the
Playwright specs in that order and stops at the first failure. CI runs the
same steps split into five checks, one workflow each: Typecheck, Lint, Unit
tests, E2E tests, and Packaged app (`npm run smoke:packaged`). Lint also fails
if the generated docs are stale. If you changed a CLI command or a
config default, run `npm run docs` and commit the regenerated `docs/` files.

A Semgrep check also runs on every pull request (registry rules plus `.semgrep/que.yml`). To run the
custom rules locally, install `semgrep` and run `semgrep scan --config .semgrep/que.yml --error .`.

## Lint and format

`npm run lint` runs oxlint (with the vendored rules in `tools/oxlint/`, see its README) and an oxfmt format check; `npm run format` writes the formatting. `npm ci` installs a pre-commit hook (husky and lint-staged) that lints and formats the staged files.

## Tests

The repository carries three testing guides in `.claude/skills/` that apply to
everyone, human or not:

- `test-planning`: which behavior to test at which layer (logic, daemon or
  renderer integration, end to end), without testing the same thing twice;
- `vitest-testing`: how to write logic, daemon integration, and renderer tests;
- `e2e-testing`: how to write the Playwright specs.

The short version: fake the subprocesses (`tests/fakes/bin` first on `PATH`),
never internal modules; a fresh temp `QUE_HOME` for every test; no sleeps, wait
on a condition; inject the clock into anything time-dependent.
`npm run test:flaky -- 10` runs the Vitest suites ten times when you suspect a
flaky test.

`npm run test:coverage` runs the Vitest suites with coverage and writes the
report to `coverage/index.html`. Every pull request's "Unit tests" step summary
shows the same four percentages (lines, statements, branches, functions) and
links the full report. The floor is 75% of lines, statements and functions and
70% of branches (#107): a run below it fails, locally and in the Unit tests
check. The CLI integration tests run the built CLI as a subprocess, so
`src/cli` shows as uncovered, and the Playwright specs are not measured.

Two mechanical commits (the oxfmt reformat and the blank-line autofix) are
listed in `.git-blame-ignore-revs`; run
`git config blame.ignoreRevsFile .git-blame-ignore-revs` once so `git blame`
skips them.

## Pull requests

- One change per pull request, with tests at the layer the change lives in.
- Explain the why in the description; the diff shows the what.
- Keep `npm run verify` green, and update `CHANGELOG.md` under `Unreleased`.
- Code, comments, and docs describe que on its own terms.

By contributing you agree that your contribution is licensed under the
Apache License 2.0 (see `LICENSE`), and to follow the
[code of conduct](CODE_OF_CONDUCT.md).
