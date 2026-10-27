// Writing a file whole: a reader sees the old content or the new, never half.
import fs from 'node:fs'

/** Writes `content` to a temp file beside `path` with `mode`, then renames it over `path`. */
export function writeFileAtomic(path: string, content: string, mode: number): void {
  const tmp = `${path}.${process.pid}.tmp`
  fs.writeFileSync(tmp, content, { mode })
  fs.chmodSync(tmp, mode)
  fs.renameSync(tmp, path)
}
