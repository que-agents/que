// Paths to the subprocess fakes and a reader for their call logs.
import fs from 'node:fs'
import { resolve } from 'node:path'

export const REPO_ROOT = resolve(__dirname, '../..')
export const FAKES_BIN = resolve(REPO_ROOT, 'tests/fakes/bin')

/** One recorded invocation of a fake `gh` or `code`. */
export interface FakeCall {
  argv: string[]
  cwd: string
  ts: string
}

/** Reads QUE_FAKE_GH_LOG / QUE_FAKE_CODE_LOG back; [] if nothing ran. */
export function readFakeLog(path: string): FakeCall[] {
  if (!fs.existsSync(path)) return []
  return fs
    .readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as FakeCall)
}
