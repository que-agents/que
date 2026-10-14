// User config (~/.config/que/config.toml or $QUE_CONFIG) and the per-repo
// que.toml. Parsing is pure; loadConfig()/loadRepoConfig() only add file I/O.
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { parse as parseToml } from 'smol-toml'

export interface RepoEntry {
  path: string
  defaultBranch?: string
}

/** Claude Code permission modes que may pass with --permission-mode. */
export const PERMISSION_MODES = [
  'default',
  'acceptEdits',
  'plan',
  'bypassPermissions',
  'dontAsk',
  'auto'
] as const
export type PermissionMode = (typeof PERMISSION_MODES)[number]

export interface UserConfig {
  worktreeRoot: string
  stallTimeoutMinutes: number
  statusPollSeconds: number
  /** Named repositories, so `que work -r <name>` can resolve a name. */
  repos: Record<string, RepoEntry>
  /** How many tasks run at once while the queue is open. */
  concurrency: number
  /** Default caps for a task that does not set its own. */
  maxTurns: number
  maxBudgetUsd: number
  /** Used when a repo's que.toml sets no permission_mode. */
  defaultPermissionMode?: PermissionMode
  /** Required (with the repo opting in) before a task may run with bypassPermissions. */
  allowBypassPermissions: boolean
  /** Branches the finisher never pushes, besides each project's default branch. */
  protectedBranches: string[]
}

export interface ConfigError {
  /** Dotted key path, or '' for a syntax error. */
  key: string
  message: string
}

export type ConfigResult<T> = { ok: true; config: T } | { ok: false; errors: ConfigError[] }

export interface ConfigEnv {
  /** The resolved QUE_HOME. */
  queHome: string
}

export function defaultConfig(env: ConfigEnv): UserConfig {
  return {
    worktreeRoot: join(env.queHome, 'worktrees'),
    stallTimeoutMinutes: 5,
    statusPollSeconds: 10,
    repos: {},
    concurrency: 2,
    maxTurns: 50,
    maxBudgetUsd: 5,
    allowBypassPermissions: false,
    protectedBranches: ['main', 'master', 'release']
  }
}

function parseTable(text: string): ConfigResult<Record<string, unknown>> {
  try {
    return { ok: true, config: parseToml(text) as Record<string, unknown> }
  } catch (err) {
    return { ok: false, errors: [{ key: '', message: (err as Error).message.split('\n')[0] }] }
  }
}

function positive(
  table: Record<string, unknown>,
  key: string,
  errors: ConfigError[]
): number | undefined {
  const v = table[key]
  if (v === undefined) return undefined
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
    errors.push({ key, message: 'must be a positive number' })
    return undefined
  }
  return v
}

function optionalString(
  table: Record<string, unknown>,
  key: string,
  prefix: string,
  errors: ConfigError[]
): string | undefined {
  const v = table[key]
  if (v === undefined) return undefined
  if (typeof v !== 'string' || v.length === 0) {
    errors.push({ key: `${prefix}${key}`, message: 'must be a non-empty string' })
    return undefined
  }
  return v
}

function optionalBool(
  table: Record<string, unknown>,
  key: string,
  errors: ConfigError[]
): boolean | undefined {
  const v = table[key]
  if (v === undefined) return undefined
  if (typeof v !== 'boolean') {
    errors.push({ key, message: 'must be true or false' })
    return undefined
  }
  return v
}

function stringList(
  table: Record<string, unknown>,
  key: string,
  errors: ConfigError[]
): string[] | undefined {
  const v = table[key]
  if (v === undefined) return undefined
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
    errors.push({ key, message: 'must be a list of strings' })
    return undefined
  }
  return v
}

function permissionMode(
  table: Record<string, unknown>,
  key: string,
  errors: ConfigError[]
): PermissionMode | undefined {
  const v = table[key]
  if (v === undefined) return undefined
  if (typeof v !== 'string' || !(PERMISSION_MODES as readonly string[]).includes(v)) {
    errors.push({ key, message: `must be one of ${PERMISSION_MODES.join(', ')}` })
    return undefined
  }
  return v as PermissionMode
}

function expandHome(p: string): string {
  return p === '~' || p.startsWith('~/') ? join(os.homedir(), p.slice(1)) : p
}

/** Parses config.toml text; unknown keys are ignored, bad values reported per key. */
export function parseConfig(text: string, env: ConfigEnv): ConfigResult<UserConfig> {
  const parsed = parseTable(text)
  if (!parsed.ok) return parsed
  const t = parsed.config
  const errors: ConfigError[] = []
  const config = defaultConfig(env)

  const root = optionalString(t, 'worktree_root', '', errors)
  if (root) config.worktreeRoot = expandHome(root)
  config.stallTimeoutMinutes =
    positive(t, 'stall_timeout_minutes', errors) ?? config.stallTimeoutMinutes
  config.statusPollSeconds = positive(t, 'status_poll_seconds', errors) ?? config.statusPollSeconds
  const concurrency = positive(t, 'concurrency', errors)
  if (concurrency !== undefined && !Number.isInteger(concurrency)) {
    errors.push({ key: 'concurrency', message: 'must be a whole number' })
  } else if (concurrency !== undefined) {
    config.concurrency = concurrency
  }
  config.maxTurns = positive(t, 'max_turns', errors) ?? config.maxTurns
  config.maxBudgetUsd = positive(t, 'max_budget_usd', errors) ?? config.maxBudgetUsd
  config.defaultPermissionMode = permissionMode(t, 'default_permission_mode', errors)
  config.allowBypassPermissions =
    optionalBool(t, 'allow_bypass_permissions', errors) ?? config.allowBypassPermissions
  config.protectedBranches = stringList(t, 'protected_branches', errors) ?? config.protectedBranches

  if (t.repos !== undefined) {
    if (typeof t.repos !== 'object' || t.repos === null || Array.isArray(t.repos)) {
      errors.push({ key: 'repos', message: 'must be a table' })
    } else {
      for (const [name, entry] of Object.entries(t.repos as Record<string, unknown>)) {
        const prefix = `repos.${name}.`
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
          errors.push({ key: `repos.${name}`, message: 'must be a table' })
          continue
        }
        const e = entry as Record<string, unknown>
        const path = optionalString(e, 'path', prefix, errors)
        if (e.path === undefined) errors.push({ key: `${prefix}path`, message: 'is required' })
        const defaultBranch = optionalString(e, 'default_branch', prefix, errors)
        if (path) config.repos[name] = { path: expandHome(path), defaultBranch }
      }
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, config }
}

export function configPath(): string {
  return process.env.QUE_CONFIG || join(os.homedir(), '.config', 'que', 'config.toml')
}

/** Reads and parses the user config; a missing file is the defaults. */
export function loadConfig(env: ConfigEnv, path: string = configPath()): ConfigResult<UserConfig> {
  let text: string
  try {
    text = fs.readFileSync(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: true, config: defaultConfig(env) }
    }
    return { ok: false, errors: [{ key: '', message: (err as Error).message }] }
  }
  return parseConfig(text, env)
}

export function formatConfigErrors(errors: ConfigError[]): string {
  return errors.map((e) => (e.key ? `${e.key}: ${e.message}` : e.message)).join('; ')
}

// ---- que.toml ---------------------------------------------------------------

export interface RepoConfig {
  /** Shell command run inside a new worktree. */
  setup?: string
  /** Shell command run inside a worktree before it is removed. */
  teardown?: string
  defaultBranch?: string
  /** Gitignored paths copied from the main checkout into new worktrees. */
  worktreeInclude: string[]
  /** Permission mode for headless task runs. */
  permissionMode?: PermissionMode
  /** Extra instructions appended to every task brief for this repo. */
  instructions?: string
  /** The repo's test command, which a task must make pass. */
  test?: string
  /** Passed to claude as --allowedTools. */
  allowedTools: string[]
}

/** Parses a .worktreeinclude file: one path per line, `#` comments, blanks skipped. */
export function parseWorktreeInclude(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))
}

export function parseRepoConfig(text: string, includeFile = ''): ConfigResult<RepoConfig> {
  const parsed = parseTable(text)
  if (!parsed.ok) return parsed
  const t = parsed.config
  const errors: ConfigError[] = []
  const config: RepoConfig = {
    setup: optionalString(t, 'setup', '', errors),
    teardown: optionalString(t, 'teardown', '', errors),
    defaultBranch: optionalString(t, 'default_branch', '', errors),
    worktreeInclude: [],
    permissionMode: permissionMode(t, 'permission_mode', errors),
    instructions: optionalString(t, 'instructions', '', errors),
    test: optionalString(t, 'test', '', errors),
    allowedTools: stringList(t, 'allowed_tools', errors) ?? []
  }
  const inc = t.worktree_include
  if (inc !== undefined) {
    if (!Array.isArray(inc) || !inc.every((x) => typeof x === 'string')) {
      errors.push({ key: 'worktree_include', message: 'must be a list of strings' })
    } else {
      config.worktreeInclude.push(...inc)
    }
  }
  for (const p of parseWorktreeInclude(includeFile)) {
    if (!config.worktreeInclude.includes(p)) config.worktreeInclude.push(p)
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, config }
}

function readOptional(path: string): string {
  try {
    return fs.readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

/** Reads `<repo>/que.toml` and `<repo>/.worktreeinclude`; both optional. */
export function loadRepoConfig(repo: string): ConfigResult<RepoConfig> {
  return parseRepoConfig(
    readOptional(join(repo, 'que.toml')),
    readOptional(join(repo, '.worktreeinclude'))
  )
}
