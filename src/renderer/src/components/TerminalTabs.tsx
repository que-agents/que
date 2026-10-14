import { useQue, useStore } from '../store'
import Terminal from './Terminal'

/** The tabs of one workspace (or of the loose terminals) and the active xterm. */
export default function TerminalTabs({ termKey }: { termKey: string }): React.JSX.Element {
  const store = useStore()
  const { connected, error } = useQue()
  const tabs = store.tabs(termKey)
  const active = store.activeTab(termKey)

  return (
    <>
      <div className="tabbar">
        <div className="tabs" role="tablist" aria-label="Terminals">
          {tabs.map((t) => (
            <span
              key={t.id}
              className={`tab${t.id === active?.id ? ' active' : ''}`}
              data-testid={`terminal-tab-${t.id}`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={t.id === active?.id}
                data-term-id={t.id}
                data-testid={`terminal-tab-${t.id}-select`}
                title={t.cwd}
                onClick={() => store.selectTerminal(termKey, t.id)}
              >
                {t.name} <span className="short-id">{t.id.slice(0, 4)}</span>
                {!t.alive && (
                  <span className="badge exited" data-testid={`terminal-tab-${t.id}-exited`}>
                    exited
                  </span>
                )}
                {t.reattached && (
                  <span className="badge" data-testid={`terminal-tab-${t.id}-reattached`}>
                    reattached
                  </span>
                )}
              </button>
              <button
                type="button"
                className="close"
                aria-label={`Close ${t.name}`}
                data-testid={`terminal-tab-${t.id}-close`}
                onClick={() => void store.closeTerminal(t.id)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <button
          type="button"
          className="ghost new-tab"
          aria-label="New terminal"
          title="New terminal (⌘T)"
          data-testid="terminal-tabs-new"
          disabled={!connected}
          onClick={() => void store.newTerminal(termKey)}
        >
          +
        </button>
      </div>
      {active ? (
        <Terminal key={active.id} id={active.id} />
      ) : (
        <div className="empty" data-testid="terminal-empty">
          {tabs.length === 0 && !error ? 'No terminals. Press + to open one.' : ''}
        </div>
      )}
    </>
  )
}
