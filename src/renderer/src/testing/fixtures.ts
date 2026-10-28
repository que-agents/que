// Fixture factories for renderer tests. The entity factories both sides share
// come from the fs-free src/testing/entities.ts; the rest are renderer-only.
import type {
  DiffFile,
  DiffHunk,
  DiffLine,
  DiffToken,
  Project,
  QuietState,
  TermInfo,
  TokenKind,
  UserConfig,
  WorkspaceDiff,
  WorkspaceDiffFile,
  DiffCommit,
  WorkspaceFiles,
  WorkspaceFile
} from '../../../preload/index.d'
import { configDefaults } from '../../../shared/config-defaults'
import { parseHunks } from '../../../shared/diff-parse'

export {
  makeBackgroundTask,
  makePrCheck,
  makePrThreadEntry,
  makePullRequest,
  makeTicket,
  makeWorkspace,
  makeWorkspaceDigest
} from '../../../testing/entities'

let termCounter = 0

/** The uploader repository, the project every fixture workspace belongs to by default. */
export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'prj_01hzw7q2m4nb',
    name: 'uploader',
    path: '/Users/dev/code/uploader',
    defaultBranch: 'main',
    createdAt: '2026-10-13T20:58:00.000Z',
    ...overrides
  }
}

/** A live terminal as term.list reports it, with a daemon-style UUID id. */
export function makeTermInfo(overrides: Partial<TermInfo> = {}): TermInfo {
  termCounter += 1
  const n = termCounter.toString(16).padStart(4, '0')

  return {
    id: `6f1c2a7e-${n}-4b8d-9a3e-5c0d7e21${n}`,
    name: 'zsh',
    cwd: '/Users/dev/code/uploader',
    cols: 80,
    rows: 24,
    pid: 51_200 + termCounter,
    alive: true,
    createdAt: `2026-10-13T21:${(10 + termCounter).toString().padStart(2, '0')}:00.000Z`,
    ...overrides
  }
}

/** Work hours: quiet hours on, the next window starting at 19:00 local. */
export function makeQuietState(overrides: Partial<QuietState> = {}): QuietState {
  const state = {
    enabled: true,
    inQuietHours: false,
    windowStart: null,
    windowEnd: null,
    nextBoundary: new Date(2026, 9, 13, 19, 0).toISOString(),
    unlockedUntil: null,
    unlockMinutes: 20,
    ...overrides
  }

  // Locked unless said otherwise: quiet hours on and no unlock running; a
  // window is a scheduled one unless said otherwise.
  return {
    locked: state.inQuietHours && !state.unlockedUntil,
    kind: state.inQuietHours ? 'scheduled' : null,
    ...state
  }
}

/** The parsed defaults, as config.get reports them. */
export function makeUserConfig(overrides: Partial<UserConfig> = {}): UserConfig {
  return { ...configDefaults('/Users/dev/.que/worktrees'), ...overrides }
}

/** One changed file, as workspace.diff reports it. */
export function makeDiffFile(overrides: Partial<DiffFile> = {}): DiffFile {
  return {
    path: 'src/upload/put.ts',
    from: null,
    status: 'modified',
    additions: 12,
    deletions: 3,
    dirty: false,
    patch:
      'diff --git a/src/upload/put.ts b/src/upload/put.ts\n--- a/src/upload/put.ts\n+++ b/src/upload/put.ts\n@@ -1,3 +1,4 @@\n-const retries = 1\n+const retries = 3\n+const backoffMs = 250\n export {}\n',
    ...overrides
  }
}

/** One changed file as workspace.diffFile reports it: one line changed, with its word marks. */
export function makeWorkspaceDiffFile(
  overrides: Partial<WorkspaceDiffFile> = {}
): WorkspaceDiffFile {
  return {
    workspaceId: 'ws_01hzx3k9c2qf',
    path: 'src/upload/put.ts',
    from: null,
    status: 'modified',
    base: 'origin/main',
    head: 'APP-1432-retry-logic',
    commit: null,
    whitespace: 'show',
    fullContext: true,
    language: 'typescript',
    skipped: null,
    additions: 1,
    deletions: 1,
    hunks: [
      {
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 2,
        label: '',
        lines: [
          {
            kind: 'removed',
            old: 1,
            new: null,
            tokens: [
              { text: 'const', kind: 'decl' },
              { text: ' ', kind: 'plain' },
              { text: 'retries', kind: 'var' },
              { text: ' = ', kind: 'punct' },
              { text: '1', kind: 'num', mark: true }
            ]
          },
          {
            kind: 'added',
            old: null,
            new: 1,
            tokens: [
              { text: 'const', kind: 'decl' },
              { text: ' ', kind: 'plain' },
              { text: 'retries', kind: 'var' },
              { text: ' = ', kind: 'punct' },
              { text: '3', kind: 'num', mark: true }
            ]
          },
          {
            kind: 'context',
            old: 2,
            new: 2,
            tokens: [
              { text: 'export', kind: 'ctrl' },
              { text: ' ', kind: 'plain' },
              { text: '{', kind: 'punct', depth: 0 },
              { text: '}', kind: 'punct', depth: 0 }
            ]
          }
        ]
      }
    ],
    ...overrides
  }
}

/** A token of a fixture line. */
function tok(text: string, kind: TokenKind, extra: Partial<DiffToken> = {}): DiffToken {
  return { text, kind, ...extra }
}

/**
 * A whole TypeScript file's diff with whole-file context: a comment, a changed constant whose
 * number is marked on both sides, an added line with nothing beside it, then a 28-line
 * unchanged run inside `withRetry` (it folds; new line 20 is hidden in it), brackets four
 * deep, and a last change that marks an inserted `await `.
 */
export function makeRetryDiffFile(overrides: Partial<WorkspaceDiffFile> = {}): WorkspaceDiffFile {
  const lines: DiffLine[] = []
  let o = 1
  let n = 1

  const ctx = (tokens: DiffToken[]): void => {
    lines.push({ kind: 'context', old: o++, new: n++, tokens })
  }

  const del = (tokens: DiffToken[]): void => {
    lines.push({ kind: 'removed', old: o++, new: null, tokens })
  }

  const add = (tokens: DiffToken[]): void => {
    lines.push({ kind: 'added', old: null, new: n++, tokens })
  }

  const max = (value: string): DiffToken[] => [
    tok('const', 'decl'),
    tok(' ', 'plain'),
    tok('MAX_RETRIES', 'var'),
    tok(' = ', 'punct'),
    tok(value, 'num', { mark: true })
  ]

  ctx([tok('// Retries a failed upload with exponential backoff.', 'comment')])
  ctx([
    tok('import', 'ctrl'),
    tok(' ', 'plain'),
    tok('{', 'punct', { depth: 0 }),
    tok(' sleep ', 'var'),
    tok('}', 'punct', { depth: 0 }),
    tok(' ', 'plain'),
    tok('from', 'ctrl'),
    tok(' ', 'plain'),
    tok("'./sleep'", 'str')
  ])
  ctx([])
  del(max('1'))
  add(max('3'))
  add([
    tok('const', 'decl'),
    tok(' ', 'plain'),
    tok('BACKOFF_MS', 'var'),
    tok(' = ', 'punct'),
    tok('250', 'num')
  ])
  ctx([])
  ctx([
    tok('export', 'ctrl'),
    tok(' ', 'plain'),
    tok('async', 'decl'),
    tok(' ', 'plain'),
    tok('function', 'decl'),
    tok(' ', 'plain'),
    tok('withRetry', 'fn'),
    tok('(', 'punct', { depth: 0 }),
    tok('run', 'var'),
    tok(': ', 'punct'),
    tok('Upload', 'type'),
    tok(')', 'punct', { depth: 0 }),
    tok(' ', 'plain'),
    tok('{', 'punct', { depth: 0 })
  ])
  ctx([
    tok('  ', 'plain'),
    tok('await', 'ctrl'),
    tok(' ', 'plain'),
    tok('step', 'fn'),
    tok('(', 'punct', { depth: 1 }),
    tok('{', 'punct', { depth: 2 }),
    tok(' ', 'plain'),
    tok('at', 'prop'),
    tok(': ', 'punct'),
    tok('[', 'punct', { depth: 3 }),
    tok('0', 'num'),
    tok(']', 'punct', { depth: 3 }),
    tok(' ', 'plain'),
    tok('}', 'punct', { depth: 2 }),
    tok(')', 'punct', { depth: 1 })
  ])

  for (let i = 2; i <= 26; i++) {
    ctx([
      tok('  ', 'plain'),
      tok('await', 'ctrl'),
      tok(' ', 'plain'),
      tok('step', 'fn'),
      tok('(', 'punct', { depth: 1 }),
      tok(String(i), 'num'),
      tok(')', 'punct', { depth: 1 })
    ])
  }

  del([
    tok('  ', 'plain'),
    tok('return', 'ctrl'),
    tok(' ', 'plain'),
    tok('run', 'fn'),
    tok('()', 'punct')
  ])
  add([
    tok('  ', 'plain'),
    tok('return', 'ctrl'),
    tok(' ', 'plain'),
    tok('await ', 'ctrl', { mark: true }),
    tok('run', 'fn'),
    tok('()', 'punct')
  ])
  ctx([tok('}', 'punct', { depth: 0 })])

  return makeWorkspaceDiffFile({
    path: 'src/upload/retry.ts',
    additions: 3,
    deletions: 2,
    hunks: [{ oldStart: 1, oldLines: o - 1, newStart: 1, newLines: n - 1, label: '', lines }],
    ...overrides
  })
}

/**
 * What workspace.diffFile would say of a file workspace.diff lists, read off its patch: its
 * hunks with their labels, each line one plain token; binary when it has no patch.
 */
export function diffFileFromPatch(
  file: DiffFile,
  overrides: Partial<WorkspaceDiffFile> = {}
): WorkspaceDiffFile {
  // The daemon's own parser, so the fake's hunks and numbers cannot drift from the real ones.
  const hunks: DiffHunk[] = parseHunks(file.patch ?? '').map(({ lines, ...hunk }) => ({
    ...hunk,
    lines: lines.map(({ text, ...line }) => ({ ...line, tokens: [tok(text, 'plain')] }))
  }))

  return makeWorkspaceDiffFile({
    path: file.path,
    from: file.from,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    fullContext: false,
    language: null,
    skipped: file.patch === null ? 'binary' : null,
    hunks,
    ...overrides
  })
}

/** One commit ahead of the base. */
export function makeDiffCommit(overrides: Partial<DiffCommit> = {}): DiffCommit {
  return {
    sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
    shortSha: 'a1b2c3d',
    subject: 'Retry uploads with backoff',
    author: 'Dev',
    at: '2026-10-14T13:40:00.000Z',
    ...overrides
  }
}

/** A workspace's diff against its base: two commits ahead, one file. */
export function makeWorkspaceDiff(overrides: Partial<WorkspaceDiff> = {}): WorkspaceDiff {
  return {
    workspaceId: 'ws_01hzx3k9c2qf',
    base: 'origin/main',
    head: 'app-1432-retry-logic',
    commitsAhead: 2,
    commits: [
      makeDiffCommit(),
      makeDiffCommit({
        sha: 'b2c3d4e5f60718293a4b5c6d7e8f901234567890',
        shortSha: 'b2c3d4e',
        subject: 'Add the uploader',
        at: '2026-10-14T13:10:00.000Z'
      })
    ],
    bases: ['origin/main', 'main'],
    commit: null,
    files: [makeDiffFile()],
    rejectedBase: null,
    generatedAt: '2026-10-14T14:00:00.000Z',
    ...overrides
  }
}

/** A worktree's listing: a small tree with the diff fixture's file in it. */
export function makeWorkspaceFiles(overrides: Partial<WorkspaceFiles> = {}): WorkspaceFiles {
  return {
    workspaceId: 'ws_01hzx3k9c2qf',
    files: [
      'README.md',
      'package.json',
      'src/index.ts',
      'src/upload/retry.ts',
      'src/upload/retry.test.ts',
      'tests/e2e/upload.spec.ts'
    ],
    truncated: false,
    generatedAt: '2026-10-14T14:00:00.000Z',
    ...overrides
  }
}

/** One text file of the worktree. */
export function makeWorkspaceFile(overrides: Partial<WorkspaceFile> = {}): WorkspaceFile {
  const content = overrides.content === undefined ? 'export const retries = 3\n' : overrides.content

  return {
    workspaceId: 'ws_01hzx3k9c2qf',
    path: 'src/index.ts',
    content,
    binary: false,
    size: content === null ? 0 : new TextEncoder().encode(content).length,
    truncated: false,
    ...overrides
  }
}
