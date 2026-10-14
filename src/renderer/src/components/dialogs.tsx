// The work-mode dialogs. Each owns its form state, calls one store action,
// and shows the daemon's error inline instead of closing.
import { type FormEvent, useState } from 'react'
import type { Project, Workspace } from '../../../preload/index.d'
import { workspaceSlug } from '../../../shared/slug'
import { useQue, useStore } from '../store'
import Dialog from './Dialog'

function useSubmit(): {
  busy: boolean
  error: string | null
  run: (fn: () => Promise<void>) => Promise<void>
} {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run }
}

function FormError({ error, testId }: { error: string | null; testId: string }) {
  if (!error) return null
  return (
    <p className="form-error" role="alert" data-testid={`${testId}-error`}>
      {error}
    </p>
  )
}

export function NewWorkspaceDialog({
  project,
  onClose
}: {
  project: Project
  onClose: () => void
}): React.JSX.Element {
  const store = useStore()
  const { connected } = useQue()
  const [name, setName] = useState('')
  const [baseRef, setBaseRef] = useState('')
  const { busy, error, run } = useSubmit()
  const slug = workspaceSlug(name)
  const id = 'dialog-new-workspace'

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    if (!slug) return
    void run(async () => {
      await store.createWorkspace({
        projectId: project.id,
        name: slug,
        ...(baseRef.trim() ? { baseRef: baseRef.trim() } : {})
      })
      onClose()
    })
  }

  return (
    <Dialog title={`New workspace in ${project.name}`} testId={id} onClose={onClose}>
      <form onSubmit={submit}>
        <label>
          Name
          <input
            data-testid={`${id}-name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="HA-1432 retry logic"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <p className="hint" data-testid={`${id}-slug`} aria-live="polite">
          {name.trim() === ''
            ? 'Branch and folder are named after it.'
            : slug
              ? `Branch and folder: ${slug}`
              : "Use letters, digits, '.', '_' or '-' (up to 64)."}
        </p>
        <label>
          Base ref (optional)
          <input
            data-testid={`${id}-base`}
            value={baseRef}
            onChange={(e) => setBaseRef(e.target.value)}
            placeholder={`origin/${project.defaultBranch}`}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <FormError error={error} testId={id} />
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary"
            data-testid={`${id}-submit`}
            disabled={!slug || busy || !connected}
          >
            {busy ? 'Creating…' : 'Create workspace'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

export function AddTaskDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const store = useStore()
  const { projects, workspaces, connected } = useQue()
  const targets = [
    ...projects.map((p) => ({ value: `p:${p.id}`, label: `${p.name} — new workspace` })),
    ...Object.values(workspaces).map((w) => ({
      value: `w:${w.id}`,
      label: `${projects.find((p) => p.id === w.projectId)?.name ?? '?'} / ${w.name}`
    }))
  ]
  const [target, setTarget] = useState(targets[0]?.value ?? '')
  const [brief, setBrief] = useState('')
  const [maxTurns, setMaxTurns] = useState('')
  const [maxBudget, setMaxBudget] = useState('')
  const { busy, error, run } = useSubmit()
  const id = 'dialog-add-task'

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    const [kind, targetId] = [target.slice(0, 1), target.slice(2)]
    void run(async () => {
      await store.addTask({
        ...(kind === 'p' ? { projectId: targetId } : { workspaceId: targetId }),
        brief,
        ...(maxTurns ? { maxTurns: Number(maxTurns) } : {}),
        ...(maxBudget ? { maxBudgetUsd: Number(maxBudget) } : {})
      })
      onClose()
    })
  }

  return (
    <Dialog title="Add a task for tonight" testId={id} onClose={onClose}>
      <form onSubmit={submit}>
        <label>
          Run in
          <select
            data-testid={`${id}-target`}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            {targets.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Brief
          <textarea
            data-testid={`${id}-brief`}
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={6}
            placeholder="What should be done, and how to know it is done."
          />
        </label>
        <div className="row">
          <label>
            Max turns
            <input
              type="number"
              min={1}
              step={1}
              data-testid={`${id}-max-turns`}
              value={maxTurns}
              onChange={(e) => setMaxTurns(e.target.value)}
              placeholder="default"
            />
          </label>
          <label>
            Max budget (USD)
            <input
              type="number"
              min={0.01}
              step={0.01}
              data-testid={`${id}-max-budget`}
              value={maxBudget}
              onChange={(e) => setMaxBudget(e.target.value)}
              placeholder="default"
            />
          </label>
        </div>
        <FormError error={error} testId={id} />
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary"
            data-testid={`${id}-submit`}
            disabled={!target || brief.trim() === '' || busy || !connected}
          >
            Add task
          </button>
        </div>
      </form>
    </Dialog>
  )
}

export function HandoffDialog({
  workspace,
  onClose
}: {
  workspace: Workspace
  onClose: () => void
}): React.JSX.Element {
  const store = useStore()
  const { connected } = useQue()
  const [brief, setBrief] = useState('')
  const { busy, error, run } = useSubmit()
  const id = 'dialog-handoff'

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    void run(async () => {
      await store.handoff(workspace.id, brief)
      onClose()
    })
  }

  return (
    <Dialog title={`Hand off ${workspace.name}`} testId={id} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="hint">
          Its terminals close and the session is finished unattended, ending in a draft PR.
        </p>
        <label>
          Brief
          <textarea
            data-testid={`${id}-brief`}
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={5}
            placeholder="What is left to do."
          />
        </label>
        <FormError error={error} testId={id} />
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary"
            data-testid={`${id}-submit`}
            disabled={brief.trim() === '' || busy || !connected}
          >
            Hand off
          </button>
        </div>
      </form>
    </Dialog>
  )
}

export function CreatePrDialog({
  workspace,
  onClose
}: {
  workspace: Workspace
  onClose: () => void
}): React.JSX.Element {
  const store = useStore()
  const { connected } = useQue()
  const [title, setTitle] = useState('')
  const [prUrl, setPrUrl] = useState<string | null>(null)
  const { busy, error, run } = useSubmit()
  const id = 'dialog-create-pr'

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    void run(async () => {
      setPrUrl(await store.createPr(workspace.id, title.trim()))
    })
  }

  return (
    <Dialog title={`Draft PR from ${workspace.branch}`} testId={id} onClose={onClose}>
      {prUrl ? (
        <>
          <p>
            Opened{' '}
            <a href={prUrl} target="_blank" rel="noreferrer" data-testid={`${id}-url`}>
              {prUrl}
            </a>
          </p>
          <div className="dialog-actions">
            <button type="button" className="primary" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={submit}>
          <label>
            Title
            <input
              data-testid={`${id}-title`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Add retry logic to the uploader"
              autoComplete="off"
            />
          </label>
          <p className="hint">Uncommitted changes are committed with this title, then pushed.</p>
          <FormError error={error} testId={id} />
          <div className="dialog-actions">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="primary"
              data-testid={`${id}-submit`}
              disabled={title.trim() === '' || busy || !connected}
            >
              {busy ? 'Opening…' : 'Create draft PR'}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  )
}

export function RemoveWorkspaceDialog({
  workspace,
  onClose
}: {
  workspace: Workspace
  onClose: () => void
}): React.JSX.Element {
  const store = useStore()
  const { connected } = useQue()
  const [deleteBranch, setDeleteBranch] = useState(false)
  const { busy, error, run } = useSubmit()
  const id = 'dialog-remove-workspace'

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    void run(async () => {
      await store.removeWorkspace(workspace.id, deleteBranch)
      onClose()
    })
  }

  return (
    <Dialog title={`Remove ${workspace.name}?`} testId={id} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="hint">Its terminals are killed and the worktree is deleted.</p>
        <label className="check">
          <input
            type="checkbox"
            data-testid={`${id}-delete-branch`}
            checked={deleteBranch}
            onChange={(e) => setDeleteBranch(e.target.checked)}
          />
          Also delete the branch {workspace.branch}
        </label>
        <FormError error={error} testId={id} />
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="danger"
            data-testid={`${id}-submit`}
            disabled={busy || !connected}
          >
            Remove
          </button>
        </div>
      </form>
    </Dialog>
  )
}
