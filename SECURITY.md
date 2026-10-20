# Security

que runs terminals and coding sessions on your machine, so a flaw in
it matters. If you find one, please report it privately rather than in a
public issue.

## Reporting

Use GitHub's private vulnerability reporting on this repository
(Security → Report a vulnerability). You will get an acknowledgement within a
few days and a fix or a reason before anything is disclosed.

## Scope

- the daemon's unix socket and what the CLI and app can ask it to do
- the `claude` wrapper and the hooks it passes per session
- the Electron app: preload bridge, window options, external links
- Create draft PR: what it commits and pushes, and the credentials it uses

Out of scope: vulnerabilities in Claude Code, git, or GitHub themselves; report
those upstream.

## Supported versions

Only the latest release is supported.
