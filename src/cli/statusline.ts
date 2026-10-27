// `que statusline`: the status line command que passes each session. Claude
// Code runs it with the session's JSON on stdin after each reply; it reports
// the plan usage windows (`rate_limits`) to the daemon, and runs the user's
// own status line with the same stdin, passing its output and exit status
// through. A missing daemon or a bad payload never fails or delays the line.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import { chooseUserStatusLine, statusLineSettingsFiles } from '../shared/statusline'
import { parseStatusLine, type StatusLineInput } from '../shared/usage.decode'
import { readStdin, requestOnce, sessionSocket } from './hook'

/** How long the usage report may take. */
const REPORT_BUDGET_MS = 1000

/** How long the user's own status line may run. */
const USER_LINE_TIMEOUT_MS = 5000

function readOrNull(path: string): string | null {
  try {
    return fs.readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/** Sends usage.report when the payload carried a window; at most REPORT_BUDGET_MS. */
async function report(windows: StatusLineInput['windows']): Promise<void> {
  if (!windows.fiveHour && !windows.sevenDay) return

  const sent = requestOnce(sessionSocket(), 'usage.report', {
    ...windows,
    at: Date.now(),
    workspaceId: process.env.QUE_WORKSPACE_ID || undefined
  })

  await Promise.race([sent, new Promise((r) => setTimeout(r, REPORT_BUDGET_MS).unref())])
}

/** Runs the user's own status line with the same stdin; resolves with its exit code (0 with none). */
function runUserLine(text: string, projectDir: string): Promise<number> {
  const texts = statusLineSettingsFiles(projectDir, os.homedir()).map(readOrNull)
  const command = chooseUserStatusLine(texts)

  if (!command) return Promise.resolve(0)

  return new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', command], {
      cwd: fs.existsSync(projectDir) ? projectDir : undefined,
      stdio: ['pipe', 'pipe', 'inherit']
    })

    const timer = setTimeout(() => child.kill('SIGKILL'), USER_LINE_TIMEOUT_MS)
    child.stdout.pipe(process.stdout)
    child.stdin.on('error', () => {})
    child.stdin.end(text)
    child.once('error', () => {
      clearTimeout(timer)
      resolve(1)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      resolve(code ?? 1)
    })
  })
}

/** Returns the exit code for the line: the user's own status line's, else 0. */
export async function runStatusLine(): Promise<number> {
  const text = await readStdin()
  const { windows, projectDir } = parseStatusLine(text)

  const [, code] = await Promise.all([
    report(windows).catch(() => {}),
    runUserLine(text, projectDir ?? process.cwd())
  ])

  return code
}
