import { useEffect, useState } from 'react'
import Terminal from './components/Terminal'

export default function App(): React.JSX.Element {
  const [cwd, setCwd] = useState<string | null>(null)

  useEffect(() => {
    void window.que.app.homedir().then(setCwd)
  }, [])

  async function openFolder(): Promise<void> {
    const dir = await window.que.app.openFolder()
    if (dir) setCwd(dir)
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="cwd" title={cwd ?? ''}>
          {cwd ?? '…'}
        </span>
        <button type="button" onClick={() => void openFolder()}>
          Open folder…
        </button>
      </header>
      {/* Keyed by cwd so choosing a folder tears down and respawns the terminal. */}
      {cwd && <Terminal key={cwd} cwd={cwd} />}
    </div>
  )
}
