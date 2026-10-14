import { formatCost, isLiveTask, newestFirst } from '../format'
import { useQue, useStore } from '../store'
import { TaskBadge } from './StatusBadge'

function QueueControl(): React.JSX.Element {
  const store = useStore()
  const { queue, connected } = useQue()
  const open = queue?.open ?? false
  return (
    <div className="queue" data-testid="queue-control" data-open={open}>
      <span className={`dot${open ? ' on' : ''}`} aria-hidden="true" />
      <span>
        Queue {open ? 'open' : 'closed'}
        <span className="muted" title="running / concurrency">
          {' '}
          {queue?.running ?? 0}/{queue?.concurrency ?? 0}
        </span>
      </span>
      <span className="spacer" />
      <button
        type="button"
        data-testid="queue-run"
        disabled={open || !connected}
        onClick={() => void store.openQueue()}
      >
        Run
      </button>
      <button
        type="button"
        data-testid="queue-close"
        disabled={!open || !connected}
        onClick={() => void store.closeQueue()}
      >
        Close
      </button>
    </div>
  )
}

export default function TasksPanel(): React.JSX.Element {
  const store = useStore()
  const { tasks, workspaces, projects, connected } = useQue()
  const list = newestFirst(Object.values(tasks))

  return (
    <section className="tasks" data-testid="tasks-panel" aria-labelledby="tasks-title">
      <div className="section-head">
        <h2 id="tasks-title">Tonight</h2>
        <button
          type="button"
          className="ghost"
          data-testid="tasks-add"
          disabled={!connected || projects.length === 0}
          onClick={() => store.openDialog({ kind: 'add-task' })}
        >
          + Task
        </button>
      </div>
      <QueueControl />
      {list.length === 0 ? (
        <p className="empty-note">No tasks queued.</p>
      ) : (
        <ul>
          {list.map((t) => {
            const ws = t.workspaceId ? workspaces[t.workspaceId] : undefined
            return (
              <li key={t.id} className="task" data-testid={`task-${t.id}`}>
                <div className="task-line">
                  <span className="name" title={t.brief}>
                    {t.title}
                  </span>
                  <TaskBadge state={t.state} testId={`task-${t.id}-state`} />
                </div>
                <div className="task-line muted">
                  <span>{ws?.name ?? (t.workspaceId ? 'removed workspace' : 'new workspace')}</span>
                  {t.reason && <span data-testid={`task-${t.id}-reason`}>{t.reason}</span>}
                  <span>{formatCost(t.costUsd)}</span>
                  {t.prUrl && (
                    <a
                      href={t.prUrl}
                      target="_blank"
                      rel="noreferrer"
                      data-testid={`task-${t.id}-pr`}
                    >
                      PR #{t.prUrl.split('/').pop()}
                    </a>
                  )}
                  {isLiveTask(t.state) && (
                    <button
                      type="button"
                      className="ghost"
                      data-testid={`task-${t.id}-stop`}
                      aria-label={`Stop ${t.title}`}
                      disabled={!connected}
                      onClick={() => void store.stopTask(t.id)}
                    >
                      Stop
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
