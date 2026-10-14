// Paths to the subprocess fakes and readers for their call logs.
import fs from 'node:fs'
import { resolve } from 'node:path'

export const REPO_ROOT = resolve(__dirname, '../..')
export const FAKES_BIN = resolve(REPO_ROOT, 'tests/fakes/bin')
/** Another tool's claude wrapper (tests/fakes/wrappers/claude), for PATH ahead of the fakes. */
export const FAKE_WRAPPERS = resolve(REPO_ROOT, 'tests/fakes/wrappers')

/** One recorded invocation of a fake `claude`, `gh`, or `code`. */
export interface FakeCall {
  argv: string[]
  cwd: string
  /** Recorded by the fake `claude` (and `caffeinate`). */
  pid?: number
  /** Recorded by the fake `claude`: the CLAUDE*, TERM* and QUE_* variable names it saw. */
  env?: string[]
  ts: string
}

/** Reads QUE_FAKE_CLAUDE_LOG / QUE_FAKE_GH_LOG / QUE_FAKE_CODE_LOG back; [] if nothing ran. */
export function readFakeLog(path: string): FakeCall[] {
  if (!fs.existsSync(path)) return []
  return fs
    .readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as FakeCall)
}

/** One run of tests/fakes/wrappers/claude: its pid and the arguments it passed on. */
export interface WrapperRun {
  pid: number
  args: string
}

/** Reads QUE_FAKE_WRAPPER_LOG back; [] if the wrapper never ran. */
export function readWrapperLog(path: string): WrapperRun[] {
  if (!fs.existsSync(path)) return []
  return fs
    .readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const [pid, args = ''] = line.split('\t')
      return { pid: Number(pid), args }
    })
}
