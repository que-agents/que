// Spots the pull requests a session creates itself: a PostToolUse hook for a
// Bash call that ran `gh pr create`, whose output names the new pull request.
// Only a pull request on the project's own origin repository counts.
import type { HookEvent } from '../shared/protocol'
import { type BashCall, decodeBashCall } from './pr-created.decode'

/** `gh pr create` as a command of its own: at the start, after a separator, or by path. */
const PR_CREATE = /(?:^|[\s;&|(/])gh\s+pr\s+create\b/

const PR_URL = /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)\b/g

export interface Repo {
  owner: string
  name: string
}

/** True when a shell command runs `gh pr create`, alone or in a chain. */
export function runsPrCreate(command: string): boolean {
  return PR_CREATE.test(command)
}

/** The Bash call a hook event reports when it ran `gh pr create`; null for any other. */
export function prCreateCall(event: HookEvent): BashCall | null {
  const call = decodeBashCall(event)

  return call && runsPrCreate(call.command) ? call : null
}

/** The owner and name of a GitHub remote (https, ssh or scp form); null for any other. */
export function githubRepo(remote: string): Repo | null {
  const m =
    /^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?|[^@/\s]+@)github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(
      remote.trim()
    )

  return m?.[1] && m[2] ? { owner: m[1], name: m[2] } : null
}

const sameRepo = (a: Repo, b: Repo): boolean =>
  a.owner.toLowerCase() === b.owner.toLowerCase() && a.name.toLowerCase() === b.name.toLowerCase()

/**
 * The pull requests a hook event shows the session creating on `origin`'s repository, in the
 * order they appear, each once: a Bash PostToolUse that ran `gh pr create`, with the URL found
 * anywhere in its response (stdout, stderr, or a plain string). None for any other event.
 */
export function createdPullRequests(event: HookEvent, origin: string): string[] {
  const call = prCreateCall(event)
  const repo = githubRepo(origin)

  if (!call || !repo) return []
  const urls: string[] = []

  for (const text of call.output) {
    for (const m of text.matchAll(PR_URL)) {
      const [, owner = '', name = '', number = ''] = m
      const url = `https://github.com/${owner}/${name}/pull/${number}`

      if (sameRepo({ owner, name }, repo) && !urls.includes(url)) urls.push(url)
    }
  }

  return urls
}
