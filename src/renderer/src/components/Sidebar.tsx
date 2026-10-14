import { useEffect, useRef, useState } from 'react'
import type { Task, Workspace } from '../../../preload/index.d'
import { isLiveTask } from '../format'
import { SCRATCH, useQue, useStore } from '../store'
import { StatusBadge, TaskBadge } from './StatusBadge'
import TasksPanel from './TasksPanel'

function WorkspaceMenu({
  workspace,
  onClose
}: {
  workspace: Workspace
  onClose: () => void
}): React.JSX.Element {
  const store = useStore()
  const { connected } = useQue()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus()
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const item = (label: string, testId: string, action: () => void, disabled = false) => (
    <button
      type="button"
      role="menuitem"
      data-testid={`sidebar-workspace-${workspace.id}-menu-${testId}`}
      disabled={disabled || !connected}
      onClick={() => {
        onClose()
        action()
      }}
    >
      {label}
    </button>
  )

  return (
    <div className="menu" role="menu" aria-label={`Actions for ${workspace.name}`} ref={ref}>
      {item('Open in editor', 'open-editor', () => void store.openInEditor(workspace.path))}
      {item('Hand off…', 'handoff', () =>
        store.openDialog({ kind: 'handoff', workspaceId: workspace.id })
      )}
      {item('Remove…', 'remove', () =>
        store.openDialog({ kind: 'remove-workspace', workspaceId: workspace.id })
      )}
    </div>
  )
}

/** The newest task that ran (or runs) in each workspace. */
function latestTasks(tasks: Record<string, Task>): Map<string, Task> {
  const out = new Map<string, Task>()
  for (const t of Object.values(tasks)) {
    if (!t.workspaceId) continue
    const prev = out.get(t.workspaceId)
    if (!prev || t.createdAt > prev.createdAt) out.set(t.workspaceId, t)
  }
  return out
}

/**
 * A task-owned workspace shows its task: the task's state while it is live
 * (not the idle or exited terminal state), and `done` with the PR after.
 */
function WorkspaceBadge({ w, task }: { w: Workspace; task?: Task }): React.JSX.Element {
  const testId = `sidebar-workspace-${w.id}-status`
  const interactive = w.status === 'working' || w.status === 'needs_input'
  if (task && isLiveTask(task.state)) return <TaskBadge state={task.state} testId={testId} />
  if (task?.state === 'done' && !interactive) return <TaskBadge state="done" testId={testId} />
  return <StatusBadge status={w.status} reason={w.statusReason} testId={testId} />
}

export default function Sidebar(): React.JSX.Element {
  const store = useStore()
  const { projects, workspaces, terminals, view, connected, loaded, tasks } = useQue()
  const owned = latestTasks(tasks)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const closeMenu = useRef(() => setMenuFor(null)).current
  const selected = view.kind === 'terminals' ? view.key : null
  const scratchCount = terminals.filter((t) => t.key === SCRATCH && t.alive).length

  const toggle = (id: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <aside className="sidebar" data-testid="sidebar" aria-label="Sidebar">
      <nav aria-label="Workspaces">
        <div className="section-head">
          <h2>Projects</h2>
          <button
            type="button"
            className="ghost"
            data-testid="sidebar-add-project"
            aria-label="Add project"
            title="Add a git repository"
            disabled={!connected}
            onClick={() => void store.addProject()}
          >
            + Project
          </button>
        </div>
        <button
          type="button"
          className="row-button"
          data-testid="sidebar-scratch"
          aria-current={selected === SCRATCH ? 'page' : undefined}
          onClick={() => store.showTerminals(SCRATCH)}
        >
          <span className="name">Terminals</span>
          <span className="count">{scratchCount}</span>
        </button>
        {loaded && projects.length === 0 && (
          <p className="empty-note" data-testid="sidebar-empty">
            Add a git repository to start a workspace.
          </p>
        )}
        {projects.map((p) => {
          const open = !collapsed.has(p.id)
          const list = Object.values(workspaces).filter((w) => w.projectId === p.id)
          return (
            <div key={p.id} className="project" data-testid={`sidebar-project-${p.id}`}>
              <div className="project-head">
                <button
                  type="button"
                  className="disclosure"
                  aria-expanded={open}
                  title={p.path}
                  onClick={() => toggle(p.id)}
                >
                  <span aria-hidden="true">{open ? '▾' : '▸'}</span> {p.name}
                </button>
                <button
                  type="button"
                  className="ghost"
                  data-testid={`sidebar-project-${p.id}-add-workspace`}
                  aria-label={`New workspace in ${p.name}`}
                  disabled={!connected}
                  onClick={() => store.openDialog({ kind: 'new-workspace', projectId: p.id })}
                >
                  +
                </button>
              </div>
              {open && (
                <ul>
                  {list.map((w) => (
                    <li key={w.id} className="workspace" data-testid={`sidebar-workspace-${w.id}`}>
                      <button
                        type="button"
                        className="row-button"
                        data-testid={`sidebar-workspace-${w.id}-open`}
                        aria-current={selected === w.id ? 'page' : undefined}
                        title={w.path}
                        onClick={() => store.showTerminals(w.id)}
                      >
                        <span className="name">{w.name}</span>
                        <WorkspaceBadge w={w} task={owned.get(w.id)} />
                      </button>
                      {owned.get(w.id)?.state === 'done' && owned.get(w.id)?.prUrl && (
                        <a
                          className="pr-link"
                          href={owned.get(w.id)?.prUrl ?? undefined}
                          target="_blank"
                          rel="noreferrer"
                          data-testid={`sidebar-workspace-${w.id}-pr`}
                        >
                          PR #{owned.get(w.id)?.prUrl?.split('/').pop()}
                        </a>
                      )}
                      <button
                        type="button"
                        className="ghost more"
                        data-testid={`sidebar-workspace-${w.id}-menu`}
                        aria-label={`More actions for ${w.name}`}
                        aria-haspopup="menu"
                        aria-expanded={menuFor === w.id}
                        onClick={() => setMenuFor(menuFor === w.id ? null : w.id)}
                      >
                        ⋯
                      </button>
                      {menuFor === w.id && <WorkspaceMenu workspace={w} onClose={closeMenu} />}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </nav>
      <TasksPanel />
      <button
        type="button"
        className="row-button report-entry"
        data-testid="sidebar-report"
        aria-current={view.kind === 'report' ? 'page' : undefined}
        onClick={() => store.showReport()}
      >
        <span className="name">Report</span>
      </button>
      <button
        type="button"
        className="row-button report-entry"
        data-testid="sidebar-settings"
        aria-current={view.kind === 'settings' ? 'page' : undefined}
        onClick={() => store.showSettings()}
      >
        <span className="name">Settings</span>
      </button>
    </aside>
  )
}
