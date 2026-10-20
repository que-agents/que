# Roadmap

What comes after 0.1.0, roughly in order. Nothing here is promised; open an
issue to argue for something, or against it.

## Workspaces from GitHub issues

`que work` takes a brief from the command line, and `que tickets start` makes a
workspace from a tracker ticket. Next: GitHub issues the same way, so a
workspace starts from an issue and the morning report links each pull request
back to the issue it came from.

## Split panes

More than one terminal visible at once in a workspace: a session beside a test
watcher or a dev server, with the same reattach guarantees as tabs.

## A diff view

See what a workspace changed without leaving the app: the
branch's diff against its base, file by file, before opening the pull request.

## An editor status-bar extension

A small VS Code extension that shows the status of the workspace the editor has
open (working, needs input, stuck) and opens its terminal in que.

## Signed and notarized builds

Releases are unsigned today, so macOS asks before the first launch. With an
Apple Developer ID, `electron-builder.yml` and the release workflow switch to
signed, notarized builds (see the comments in both).

## Auto-update

The app already says when a newer release exists. Once builds are signed, it
can download and install updates itself.
