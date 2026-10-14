// "Install 'que' command in PATH": symlinks the app's Resources/cli/que
// launcher into /usr/local/bin when that is writable, else ~/.local/bin, and
// never asks for privileges. The decisions are pure (planCliInstall); the
// filesystem work is a few lines in installCli().
import fs from 'node:fs'
import { join } from 'node:path'

export const SYSTEM_BIN = '/usr/local/bin'

export type Existing = 'none' | 'our-link' | 'other-link' | 'file'

export interface CliInstallPlan {
  /** Where the link goes. */
  link: string
  dir: string
  /** create: nothing there; replace: an old symlink; refuse: a real file we must not clobber. */
  action: 'create' | 'replace' | 'refuse'
  /** The line to add to a shell profile, when `dir` is the per-user fallback. */
  pathHint: string | null
}

export interface PlanInput {
  home: string
  /** Whether /usr/local/bin exists and this user can write to it. */
  systemBinWritable: boolean
  /** What is at the link path in the chosen directory now. */
  existing: (link: string) => Existing
}

export function planCliInstall(input: PlanInput): CliInstallPlan {
  const system = input.systemBinWritable
  const dir = system ? SYSTEM_BIN : join(input.home, '.local', 'bin')
  const link = join(dir, 'que')
  const existing = input.existing(link)
  const action = existing === 'none' ? 'create' : existing === 'file' ? 'refuse' : 'replace'
  return {
    link,
    dir,
    action,
    pathHint: system ? null : 'export PATH="$HOME/.local/bin:$PATH"'
  }
}

/** What the result dialog says. */
export function describeCliInstall(plan: CliInstallPlan): { message: string; detail: string } {
  if (plan.action === 'refuse') {
    return {
      message: `${plan.link} already exists`,
      detail: `It is not a link que made, so it was left alone. Remove it and try again.`
    }
  }
  const message = `Installed 'que' at ${plan.link}`
  if (!plan.pathHint) return { message, detail: 'Open a new terminal and run `que doctor`.' }
  return {
    message,
    detail: `${plan.dir} is not writable system-wide, so que went into your home folder. If your shell does not already look there, add this line to ~/.zshrc and open a new terminal:\n\n${plan.pathHint}`
  }
}

function existingAt(link: string, target: string): Existing {
  let st: fs.Stats
  try {
    st = fs.lstatSync(link)
  } catch {
    return 'none'
  }
  if (!st.isSymbolicLink()) return 'file'
  return fs.readlinkSync(link) === target ? 'our-link' : 'other-link'
}

function writable(dir: string): boolean {
  try {
    fs.accessSync(dir, fs.constants.W_OK)
    return fs.statSync(dir).isDirectory()
  } catch {
    return false
  }
}

/** Links `launcher` (Resources/cli/que) into PATH. Throws on a filesystem error. */
export function installCli(launcher: string, home: string): CliInstallPlan {
  const plan = planCliInstall({
    home,
    systemBinWritable: writable(SYSTEM_BIN),
    existing: (link) => existingAt(link, launcher)
  })
  if (plan.action === 'refuse') return plan
  fs.mkdirSync(plan.dir, { recursive: true })
  if (plan.action === 'replace') fs.rmSync(plan.link, { force: true })
  fs.symlinkSync(launcher, plan.link)
  return plan
}
