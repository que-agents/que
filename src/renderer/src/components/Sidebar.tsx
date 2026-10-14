import { useEffect, useRef, useState } from 'react'
import type { Project, Task, Workspace } from '../../../preload/index.d'
import { isLiveTask } from '../format'
import { SCRATCH, useQue, useStore } from '../store'
import { StatusBadge, TaskBadge } from './StatusBadge'

interface MenuItem {
  label: string
  testId: string
  action: () => void
}

interface Point {
  x: number
  y: number
}

/** Which row's menu is open, and where: under its ⋯ button, or at the pointer. */
type OpenMenu = { kind: 'project' | 'workspace'; id: string; at?: Point }

const MENU_WIDTH = 180
const MENU_ITEM_HEIGHT = 28

/**
 * A row's actions. Anchored under the row's ⋯ button, or placed at the pointer
 * for a right-click (kept inside the window). The first item takes focus;
 * Escape or a click elsewhere closes it.
 */
function ActionMenu({
  label,
  testId,
  items,
  at,
  onClose
}: {
  label: string
  testId: string
  items: MenuItem[]
  at?: Point
  onClose: () => void
}): React.JSX.Element {
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

  const style = at
    ? {
        left: Math.max(0, Math.min(at.x, window.innerWidth - MENU_WIDTH)),
        top: Math.max(0, Math.min(at.y, window.innerHeight - MENU_ITEM_HEIGHT * items.length - 12)),
        right: 'auto'
      }
    : undefined

  return (
    <div
      className={at ? 'menu at-pointer' : 'menu'}
      role="menu"
      aria-label={label}
      ref={ref}
      style={style}
    >
      {items.map((item) => (
        <button
          key={item.testId}
          type="button"
          role="menuitem"
          data-testid={`${testId}-${item.testId}`}
          disabled={!connected}
          onClick={() => {
            onClose()
            item.action()
          }}
        >
          {item.label}
        </button>
      ))}
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
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  const closeMenu = useRef(() => setMenu(null)).current
  const selected = view.kind === 'terminals' ? view.key : null
  const scratchCount = terminals.filter((t) => t.key === SCRATCH && t.alive).length

  const toggle = (id: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const toggleMenu = (kind: OpenMenu['kind'], id: string): void =>
    setMenu(menu?.kind === kind && menu.id === id && !menu.at ? null : { kind, id })

  const menuAtPointer = (e: React.MouseEvent, kind: OpenMenu['kind'], id: string): void => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ kind, id, at: { x: e.clientX, y: e.clientY } })
  }

  const projectItems = (p: Project): MenuItem[] => [
    {
      label: 'New workspace…',
      testId: 'new-workspace',
      action: () => store.openDialog({ kind: 'new-workspace', projectId: p.id })
    },
    {
      label: 'Open in editor',
      testId: 'open-editor',
      action: () => void store.openInEditor(p.path)
    },
    {
      label: 'Remove project…',
      testId: 'remove',
      action: () => store.openDialog({ kind: 'remove-project', projectId: p.id })
    }
  ]

  const workspaceItems = (w: Workspace): MenuItem[] => [
    {
      label: 'Open in editor',
      testId: 'open-editor',
      action: () => void store.openInEditor(w.path)
    },
    {
      label: 'Remove…',
      testId: 'remove',
      action: () => store.openDialog({ kind: 'remove-workspace', workspaceId: w.id })
    }
  ]

  const menuFor = (kind: OpenMenu['kind'], id: string): OpenMenu | null =>
    menu?.kind === kind && menu.id === id ? menu : null

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
          const projectMenu = menuFor('project', p.id)
          return (
            <div key={p.id} className="project" data-testid={`sidebar-project-${p.id}`}>
              <div className="project-head">
                <button
                  type="button"
                  className="disclosure"
                  data-testid={`sidebar-project-${p.id}-toggle`}
                  aria-expanded={open}
                  title={p.path}
                  onClick={() => toggle(p.id)}
                  onContextMenu={(e) => menuAtPointer(e, 'project', p.id)}
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
                <button
                  type="button"
                  className="ghost more"
                  data-testid={`sidebar-project-${p.id}-menu`}
                  aria-label={`More actions for ${p.name}`}
                  aria-haspopup="menu"
                  aria-expanded={projectMenu !== null}
                  onClick={() => toggleMenu('project', p.id)}
                >
                  ⋯
                </button>
                {projectMenu && (
                  <ActionMenu
                    label={`Actions for ${p.name}`}
                    testId={`sidebar-project-${p.id}-menu`}
                    items={projectItems(p)}
                    at={projectMenu.at}
                    onClose={closeMenu}
                  />
                )}
              </div>
              {open && (
                <ul>
                  {list.map((w) => {
                    const workspaceMenu = menuFor('workspace', w.id)
                    return (
                      <li
                        key={w.id}
                        className="workspace"
                        data-testid={`sidebar-workspace-${w.id}`}
                        onContextMenu={(e) => menuAtPointer(e, 'workspace', w.id)}
                      >
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
                          aria-expanded={workspaceMenu !== null}
                          onClick={() => toggleMenu('workspace', w.id)}
                        >
                          ⋯
                        </button>
                        {workspaceMenu && (
                          <ActionMenu
                            label={`Actions for ${w.name}`}
                            testId={`sidebar-workspace-${w.id}-menu`}
                            items={workspaceItems(w)}
                            at={workspaceMenu.at}
                            onClose={closeMenu}
                          />
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )
        })}
      </nav>
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
