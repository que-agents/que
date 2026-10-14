// The finisher: after a successful run, commit what the agent left
// uncommitted, then push the task branch and open a draft pull request.
// Nothing is ever pushed to the project's default branch or a protected one.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import type { Project, Task, Workspace } from '../shared/types'
import { git } from './workspaces'

export type FinishResult = { ok: true; prUrl: string | null } | { ok: false; step: string }

export interface FinishOptions {
  task: Task
  workspace: Workspace
  project: Project
  /** Config `protected_branches`. */
  protectedBranches: readonly string[]
  /** Where the pull request body is written before `gh pr create --body-file`. */
  bodyFile: string
  /** Appends a line to the task log. */
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

/** The pull request description: the agent's summary and where it came from. */
export function prBody(resultText: string | null, workspaceName: string): string {
  const summary = (resultText ?? '').trim()
  return `${summary ? `${summary}\n\n` : ''}Opened by que from workspace ${workspaceName}.\n`
}

const PR_URL = /https?:\/\/\S+\/pull\/\d+/

function gh(cwd: string, args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      'gh',
      args,
      { cwd, encoding: 'utf8', timeout: 120_000, env: { ...process.env, GH_PROMPT_DISABLED: '1' } },
      (err, stdout, stderr) =>
        resolve({
          ok: !err,
          stdout: stdout ?? '',
          stderr: `${stderr ?? ''}${err && !stderr ? err.message : ''}`
        })
    ).stdin?.end()
  })
}

export async function finishTask(o: FinishOptions): Promise<FinishResult> {
  const cwd = o.workspace.path
  const branch = o.workspace.branch
  const fail = (step: string, stderr: string): FinishResult => {
    o.log(`finisher: ${step} failed: ${stderr.trim()}`)
    return { ok: false, step }
  }

  const status = await git(cwd, ['status', '--porcelain'])
  if (!status.ok) return fail('status', status.stderr)
  if (status.stdout !== '') {
    const added = await git(cwd, ['add', '-A'])
    if (!added.ok) return fail('add', added.stderr)
    const committed = await git(cwd, ['commit', '-m', o.task.title])
    if (!committed.ok) return fail('commit', committed.stderr || committed.stdout)
    o.log(`finisher: committed the remaining changes as "${o.task.title}"`)
  }

  const def = o.project.defaultBranch
  const hasOrigin = (
    await git(cwd, ['show-ref', '--verify', '--quiet', `refs/remotes/origin/${def}`])
  ).ok
  const base = hasOrigin ? `origin/${def}` : def
  const ahead = await git(cwd, ['rev-list', '--count', `${base}..HEAD`])
  if (!ahead.ok) return fail('rev-list', ahead.stderr)
  if (Number(ahead.stdout) === 0) {
    o.log(`finisher: no commits ahead of ${base}; nothing to push`)
    return { ok: true, prUrl: null }
  }

  if (isProtectedBranch(branch, def, o.protectedBranches)) {
    return fail('protected_branch', `refusing to push protected branch ${branch}`)
  }
  const pushed = await git(cwd, ['push', '-u', 'origin', branch], 300_000)
  if (!pushed.ok) return fail('push', pushed.stderr)
  o.log(`finisher: pushed ${branch} (${ahead.stdout} commits ahead of ${base})`)

  fs.writeFileSync(o.bodyFile, prBody(o.task.resultText, o.workspace.name))
  const pr = await gh(cwd, [
    'pr',
    'create',
    '--draft',
    '--title',
    o.task.title,
    '--body-file',
    o.bodyFile
  ])
  if (!pr.ok) return fail('pr', pr.stderr)
  const url = PR_URL.exec(pr.stdout)?.[0]
  if (!url) return fail('pr', `no pull request URL in gh output: ${pr.stdout}`)
  o.log(`finisher: opened ${url}`)
  return { ok: true, prUrl: url }
}
