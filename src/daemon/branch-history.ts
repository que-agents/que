// Every branch a worktree has had checked out, oldest first: kept as the
// daemon sees the branch change, and seeded once from the worktree's own
// HEAD reflog for a workspace stored before the list was kept.

/** `list` with each of `items` not already in it appended, in order, once. */
export function appendNew<T>(list: readonly T[], items: readonly T[]): T[] {
  const out = [...list]

  for (const item of items) if (!out.includes(item)) out.push(item)

  return out
}

/** `list` with `branch` at the end, unless it is already in it. */
export function withBranch(list: readonly string[], branch: string): string[] {
  return appendNew(list, [branch])
}

/**
 * True for the default branch and every configured `protected_branches` entry: que never
 * looks up the pull requests whose head is one of them.
 */
export function isProtectedBranch(
  branch: string,
  defaultBranch: string,
  protectedBranches: readonly string[]
): boolean {
  return branch === defaultBranch || protectedBranches.includes(branch)
}

/** `list` with `from` renamed `to`: in its place, or dropped when `to` is already there. */
export function renameBranch(list: readonly string[], from: string, to: string): string[] {
  return list.includes(to) ? list.filter((b) => b !== from) : list.map((b) => (b === from ? to : b))
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
      list = appendNew(
        list,
        moved.slice(1).filter((name) => !notABranch(name))
      )

      continue
    }

    const [, from, to] =
      /^Branch: renamed refs\/heads\/(\S+) to refs\/heads\/(\S+)$/.exec(line.trim()) ?? []

    if (from && to) list = renameBranch(list, from, to)
  }

  return list
}
