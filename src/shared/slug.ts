// Workspace naming: one slug drives the workspace name, the default branch,
// and the worktree directory.

export const WORKSPACE_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/

/** Lowercases, turns spaces and underscores into `-`, and drops anything else. */
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9._-]/g, '')
}

/** The slug if it is a valid workspace name, otherwise null. */
export function workspaceSlug(name: string): string | null {
  const slug = slugify(name)
  return WORKSPACE_NAME_RE.test(slug) ? slug : null
}
