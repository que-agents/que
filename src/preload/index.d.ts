export interface PtyExitInfo {
  exitCode: number
  signal?: number
}

export interface PtyApi {
  spawn(opts: { cwd?: string; cols: number; rows: number }): Promise<{ id: string }>
  write(id: string, data: string): void
  resize(id: string, cols: number, rows: number): void
  kill(id: string): void
  onData(id: string, cb: (data: string) => void): () => void
  onExit(id: string, cb: (info: PtyExitInfo) => void): () => void
}

export interface AppApi {
  homedir(): Promise<string>
  /** Shows a native folder picker; resolves to the chosen path or null. */
  openFolder(): Promise<string | null>
}

export interface QueApi {
  pty: PtyApi
  app: AppApi
}

declare global {
  interface Window {
    que: QueApi
  }
}
