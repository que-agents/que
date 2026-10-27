// Every branch a worktree has had checked out, oldest first: kept as the
// daemon sees the branch change, and seeded once from the worktree's own
// HEAD reflog for a workspace stored before the list was kept.

/** `list` with `branch` at the end, unless it is already in it. */
export function withBranch(list: readonly string[], branch: string): string[] {
  return list.includes(branch) ? [...list] : [...list, branch]
}

/** True for a name a checkout entry may hold that is not a branch: a sha, HEAD, or a revision expression. */
function notABranch(name: string): boolean {
  return (
    name === '' ||
    name === 'HEAD' ||
    name.startsWith('-') ||
    /^[0-9a-f]{7,40}$/.test(name) ||
    /[\s~^:?*[\\]|@\{/.test(name)
  )
}

/**
 * The branches in `git reflog show --format=%gs HEAD` output (newest first, as git prints it),
 * oldest first: both sides of each `checkout: moving from <a> to <b>`, a rename
 * (`Branch: renamed refs/heads/<a> to refs/heads/<b>`) replacing its old name. Detached
 * checkouts (a sha, a revision expression) are left out.
 */
export function reflogBranches(out: string): string[] {
  let list: string[] = []

  for (const line of out.split('\n').reverse()) {
    const moved = /^checkout: moving from (\S+) to (\S+)$/.exec(line.trim())

    if (moved) {
      for (const name of [moved[1], moved[2]]) {
        if (name && !notABranch(name)) list = withBranch(list, name)
      }

      continue
    }

    const renamed = /^Branch: renamed refs\/heads\/(\S+) to refs\/heads\/(\S+)$/.exec(line.trim())

    if (renamed?.[1] && renamed[2]) {
      const [, from, to] = renamed
      list = list.includes(to)
        ? list.filter((b) => b !== from)
        : list.map((b) => (b === from ? to : b))
    }
  }

  return list
}
