import { useEffect, useRef } from 'react'
import { basename } from '../diff'
import {
  diffPathOf,
  filePathOf,
  RATIO_DEFAULT,
  RATIO_MAX,
  RATIO_MIN,
  useQue,
  useStore
} from '../store'
import { setPaneSource } from '../testHook'
import DiffView from './DiffView'
import FileView from './FileView'
import { DiffIcon, FileIcon, PlusIcon } from './icons'
import Terminal from './Terminal'

const STEP = 0.05

/**
 * The divider between two panes. Drag it to resize, double-click it to go back
 * to an even split, or focus it and use the arrow keys.
 */
export function PaneDivider({
  direction,
  ratio,
  onChange
}: {
  direction: 'row' | 'column'
  ratio: number
  onChange: (ratio: number) => void
}): React.JSX.Element {
  const dragging = useRef(false)
  const row = direction === 'row'

  const apply = (e: React.PointerEvent<HTMLHRElement>): void => {
    if (!dragging.current) return
    const box = e.currentTarget.parentElement?.getBoundingClientRect()
    const size = row ? box?.width : box?.height
    if (!box || !size) return
    onChange((row ? e.clientX - box.left : e.clientY - box.top) / size)
  }

  const end = (e: React.PointerEvent<HTMLHRElement>): void => {
    if (!dragging.current) return
    dragging.current = false
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    document.body.classList.remove('resizing')
  }

  return (
    <hr
      className={`pane-divider ${direction}`}
      aria-orientation={row ? 'vertical' : 'horizontal'}
      aria-label="Resize panes"
      aria-valuemin={Math.round(RATIO_MIN * 100)}
      aria-valuemax={Math.round(RATIO_MAX * 100)}
      aria-valuenow={Math.round(ratio * 100)}
      tabIndex={0}
      data-testid="pane-divider"
      title="Drag to resize; double-click to reset"
      onPointerDown={(e) => {
        if (e.button !== 0) return
        dragging.current = true
        e.currentTarget.setPointerCapture?.(e.pointerId)
        document.body.classList.add('resizing')
      }}
      onPointerMove={apply}
      onPointerUp={(e) => {
        // The last move can be coalesced away under load; the release point is final.
        apply(e)
        end(e)
      }}
      onPointerCancel={end}
      onDoubleClick={() => onChange(RATIO_DEFAULT)}
      onKeyDown={(e) => {
        const back = row ? 'ArrowLeft' : 'ArrowUp'
        const forward = row ? 'ArrowRight' : 'ArrowDown'
        const next =
          e.key === back
            ? ratio - STEP
            : e.key === forward
              ? ratio + STEP
              : e.key === 'Home'
                ? RATIO_MIN
                : e.key === 'End'
                  ? RATIO_MAX
                  : null
        if (next === null) return
        e.preventDefault()
        onChange(next)
      }}
    />
  )
}

function Pane({ termKey, index }: { termKey: string; index: 0 | 1 }): React.JSX.Element {
  const store = useStore()
  const { connected, error } = useQue()
  const tabs = store.paneTabs(termKey, index)
  const views = store.paneViews(termKey, index)
  const activeId = store.paneActiveId(termKey, index)
  const active = store.paneActive(termKey, index)
  const activeDiff = diffPathOf(activeId)
  const activeFile = filePathOf(activeId)
  const focused = store.focusedPane(termKey) === index

  return (
    <div
      className="pane"
      data-testid={`pane-${index}`}
      data-focused={focused}
      data-active-term={active?.id ?? ''}
      data-active-tab={activeId ?? ''}
      onPointerDownCapture={() => store.focusPane(termKey, index)}
    >
      <div className="tabbar">
        <div className="tabs" role="tablist" aria-label="Tabs">
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
          {views.map((id) => {
            const filePath = filePathOf(id)
            const kind = filePath === null ? 'diff' : 'file'
            const path = filePath ?? diffPathOf(id) ?? id
            const label = basename(path)
            const selected = id === activeId
            return (
              <span
                key={id}
                className={`tab view-tab${selected ? ' active' : ''}`}
                data-testid={`view-tab-${kind}`}
                data-path={path}
                data-active={selected}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  title={path}
                  data-testid={`view-tab-${kind}-select`}
                  data-path={path}
                  onClick={() => store.selectTerminal(termKey, id)}
                >
                  {kind === 'file' ? <FileIcon /> : <DiffIcon />}
                  {label}
                </button>
                <button
                  type="button"
                  className="close"
                  aria-label={`Close ${label}`}
                  data-testid={`view-tab-${kind}-close`}
                  data-path={path}
                  onClick={() => store.closeView(termKey, id)}
                >
                  ×
                </button>
              </span>
            )
          })}
        </div>
        <button
          type="button"
          className="ghost icon new-tab"
          aria-label="New terminal"
          title="New terminal (⌘T)"
          data-testid={`pane-${index}-new`}
          disabled={!connected}
          onClick={() => {
            store.focusPane(termKey, index)
            void store.newTerminal(termKey)
          }}
        >
          <PlusIcon />
        </button>
      </div>
      {activeDiff !== null ? (
        <DiffView termKey={termKey} path={activeDiff} />
      ) : activeFile !== null ? (
        <FileView key={activeFile} termKey={termKey} path={activeFile} />
      ) : active ? (
        // An inactive tab's terminal is detached; it reattaches (and replays) when selected.
        <Terminal key={active.id} id={active.id} focused={focused} />
      ) : (
        <div className="empty" data-testid="terminal-empty">
          {tabs.length === 0 && !error ? 'No terminals. Press + to open one.' : ''}
        </div>
      )}
    </div>
  )
}

/** One workspace's (or the loose sessions') terminals, in one pane or two. */
export default function Panes({ termKey }: { termKey: string }): React.JSX.Element {
  const store = useStore()
  const { layouts } = useQue()
  const layout = layouts[termKey] ?? store.layout(termKey)
  const split = layout.split

  // Tell the e2e test hook where the panes are.
  useEffect(() => {
    setPaneSource(() => {
      const count = store.layout(termKey).split ? 2 : 1
      const focused = store.focusedPane(termKey)
      return Array.from({ length: count }, (_, index) => ({
        index,
        activeTermId: store.paneActive(termKey, index as 0 | 1)?.id ?? null,
        activeTab: store.paneActiveId(termKey, index as 0 | 1),
        focused: focused === index
      }))
    })
    return () => setPaneSource(null)
  }, [store, termKey])

  const template = split
    ? `${split.ratio}fr 7px ${Math.round((1 - split.ratio) * 1000) / 1000}fr`
    : undefined
  const style = split
    ? split.direction === 'row'
      ? { gridTemplateColumns: template }
      : { gridTemplateRows: template }
    : undefined

  return (
    <div
      className="panes"
      data-testid="panes"
      data-split={split ? split.direction : 'none'}
      data-ratio={split?.ratio}
      style={style}
    >
      <Pane termKey={termKey} index={0} />
      {split && (
        <>
          <PaneDivider
            direction={split.direction}
            ratio={split.ratio}
            onChange={(r) => store.setRatio(termKey, r)}
          />
          <Pane termKey={termKey} index={1} />
        </>
      )}
    </div>
  )
}
