export const BUNDLE_ID: string
export const DEFAULT_DEST: string

export function locateBundle(releaseDir: string): string | undefined
export function parseArgs(argv: string[]): {
  build: boolean
  link: boolean
  launch: boolean
  from: string | undefined
  dest: string
}
export function bundleVersion(app: string): string | undefined
export function swapBundle(
  src: string,
  dest: string,
  copy?: (src: string, to: string) => void
): void
export function quitRunningApp(timeoutMs?: number): Promise<boolean>
export function main(argv: string[]): Promise<void>
