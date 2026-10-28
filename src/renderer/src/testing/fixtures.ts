// Fixture factories for renderer tests. The entity factories both sides share
// come from the fs-free src/testing/entities.ts; the rest are renderer-only.
import type {
  DiffFile,
  Project,
  QuietState,
  TermInfo,
  UserConfig,
  WorkspaceDiff,
  WorkspaceDiffFile,
  DiffCommit,
  WorkspaceFiles,
  WorkspaceFile
} from '../../../preload/index.d'
import { configDefaults } from '../../../shared/config-defaults'

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

/**
 * One changed file, as workspace.diff reports it. Its lines are all code unless the overrides
 * split them: codeAdditions and codeDeletions follow overridden additions and deletions.
 */
export function makeDiffFile(overrides: Partial<DiffFile> = {}): DiffFile {
  const additions = overrides.additions ?? 12
  const deletions = overrides.deletions ?? 3

  return {
    commentOnly: false,
    codeAdditions: additions - (overrides.commentAdditions ?? 0),
    commentAdditions: 0,
    codeDeletions: deletions - (overrides.commentDeletions ?? 0),
    commentDeletions: 0,
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
