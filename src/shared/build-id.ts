// The build id names the daemon bundle a process runs or would spawn: the
// first 12 hex characters of a sha256 over the bundle's bytes. The daemon
// takes it from its own file at start; the app and the CLI take it from the
// bundle they would start, so a rebuilt daemon bundle shows up as a mismatch.
import { createHash } from 'node:crypto'
import fs from 'node:fs'

/** The build id of a file, or '' when it cannot be read. */
export function buildIdOf(file: string): string {
  let bytes: Buffer

  try {
    bytes = fs.readFileSync(file)
  } catch {
    return ''
  }

  return createHash('sha256').update(bytes).digest('hex').slice(0, 12)
}

/** True when both ids are known and differ; an unknown id never asks for a restart. */
export function daemonIsStale(daemonId: string, expectedId: string): boolean {
  if (daemonId === '' || expectedId === '') return false

  return daemonId !== expectedId
}

/** What `que daemon status` and `que doctor` say when the daemon runs another build. */
export function staleDaemonHint(daemonId: string, expectedId: string): string {
  return `the daemon runs build ${daemonId}, a different build than this que (${expectedId}); run \`que daemon upgrade\` (every terminal keeps running), or \`que daemon restart\` if that fails (it ends every terminal)`
}
