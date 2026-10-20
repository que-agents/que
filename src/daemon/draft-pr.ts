// Opens a draft pull request from a workspace (workspace.createPr): commit what
// is left uncommitted, push the workspace branch, and run `gh pr create --draft`.
// Nothing is ever pushed to the project's default branch or a protected one.
import { run } from '../shared/exec'
import type { Project, Workspace } from '../shared/types'
import { git } from './workspaces'

export type DraftPrResult = { ok: true; prUrl: string | null } | { ok: false; step: string }

export interface DraftPrOptions {
  /** The commit message for leftover changes and the pull request title. */
  title: string
  workspace: Workspace
  project: Project
  /** Config `protected_branches`. */
  protectedBranches: readonly string[]
  /** Reports one line of progress or the failure. */
  log: (line: string) => void
}

/** True for the default branch and every configured protected branch. */
export function isProtectedBranch(
  branch: string,
  defaultBranch: string,
  protectedBranches: readonly string[]
): boolean {
  return branch === defaultBranch || protectedBranches.includes(branch)
}

const PR_URL = /https?:\/\/\S+\/pull\/\d+/

async function gh(
  cwd: string,
  args: string[]
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const r = await run('gh', args, {
    cwd,
    timeoutMs: 120_000,
    env: { ...process.env, GH_PROMPT_DISABLED: '1' }
  })

  return { ok: r.ok, stdout: r.stdout, stderr: `${r.stderr}${!r.ok && !r.stderr ? r.error : ''}` }
}

export async function openDraftPr(o: DraftPrOptions): Promise<DraftPrResult> {
  const cwd = o.workspace.path
  const branch = o.workspace.branch

  const fail = (step: string, stderr: string): DraftPrResult => {
    o.log(`draft PR: ${step} failed: ${stderr.trim()}`)

    return { ok: false, step }
  }

  // Checked before anything is committed: a protected branch is never written to.
  if (isProtectedBranch(branch, o.project.defaultBranch, o.protectedBranches)) {
    return fail(
      'protected_branch',
      `refusing to open a pull request from protected branch ${branch}`
    )
  }

  const status = await git(cwd, ['status', '--porcelain'])

  if (!status.ok) return fail('status', status.stderr)

  if (status.stdout !== '') {
    const added = await git(cwd, ['add', '-A'])

    if (!added.ok) return fail('add', added.stderr)
    const committed = await git(cwd, ['commit', '-m', o.title])

    if (!committed.ok) return fail('commit', committed.stderr || committed.stdout)
    o.log(`draft PR: committed the remaining changes as "${o.title}"`)
  }

  const def = o.project.defaultBranch

  const hasOrigin = (
    await git(cwd, ['show-ref', '--verify', '--quiet', `refs/remotes/origin/${def}`])
  ).ok

  const base = hasOrigin ? `origin/${def}` : def
  const ahead = await git(cwd, ['rev-list', '--count', `${base}..HEAD`])

  if (!ahead.ok) return fail('rev-list', ahead.stderr)

  if (Number(ahead.stdout) === 0) {
    o.log(`draft PR: no commits ahead of ${base}; nothing to push`)

    return { ok: true, prUrl: null }
  }

  const pushed = await git(cwd, ['push', '-u', 'origin', branch], 300_000)

  if (!pushed.ok) return fail('push', pushed.stderr)
  o.log(`draft PR: pushed ${branch} (${ahead.stdout} commits ahead of ${base})`)

  const pr = await gh(cwd, [
    'pr',
    'create',
    '--draft',
    '--title',
    o.title,
    '--body',
    `Opened by que from workspace ${o.workspace.name}.`
  ])

  if (!pr.ok) return fail('pr', pr.stderr)
  const url = PR_URL.exec(pr.stdout)?.[0]

  if (!url) return fail('pr', `no pull request URL in gh output: ${pr.stdout}`)
  o.log(`draft PR: opened ${url}`)

  return { ok: true, prUrl: url }
}
