// The PATH a login shell would have. An app launched from Finder gets
// launchd's `/usr/bin:/bin:/usr/sbin:/sbin`, which has neither Homebrew nor
// `~/.local/bin`; the daemon inherits it, so it must be fixed before the
// daemon starts.
import { execFile } from 'node:child_process'
import { cleanSpawnEnv } from './env'

/** The user's login shell, `$SHELL`, or zsh when it is unset: what every terminal starts. */
export function loginShell(): string {
  return process.env.SHELL || '/bin/zsh'
}

/** Login entries first (deduplicated, empties dropped), then the rest of `current`. */
export function mergePath(current: string | undefined, login: string | null): string {
  if (!login) return current ?? ''
  const seen = new Set<string>()
  const out: string[] = []

  for (const entry of [...login.split(':'), ...(current ?? '').split(':')]) {
    if (!entry || seen.has(entry)) continue
    seen.add(entry)
    out.push(entry)
  }

  return out.join(':')
}

/** What `$PATH` is in a login shell, or null when it cannot be read. Never rejects. */
export function loginShellPath(
  opts: { shell?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}
): Promise<string | null> {
  const shell = opts.shell ?? loginShell()

  return new Promise((resolve) => {
    try {
      const child = execFile(
        shell,
        ['-lc', 'printf %s "$PATH"'],
        {
          encoding: 'utf8',
          env: cleanSpawnEnv(opts.env ?? process.env),
          timeout: opts.timeoutMs ?? 5000,
          maxBuffer: 64 * 1024
        },
        (err, stdout) => {
          const out = String(stdout ?? '').trim()
          resolve(err || !out.includes('/') ? null : out)
        }
      )

      child.stdin?.end()
    } catch {
      resolve(null)
    }
  })
}
