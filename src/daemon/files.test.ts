import { describe, expect, it } from 'vitest'
import { insideWorktree, MAX_FILES, parseLsFiles } from './files'

const ROOT = '/Users/dev/.que/worktrees/uploader/app-1600-files-tab'

describe('parseLsFiles', () => {
  it('splits on NUL, drops the trailing NUL, and sorts in plain string order', () => {
    const out = 'src/retry.ts\0README.md\0Makefile\0src/a b.ts\0'

    expect(parseLsFiles(out)).toEqual({
      files: ['Makefile', 'README.md', 'src/a b.ts', 'src/retry.ts'],
      truncated: false
    })
  })

  it('lists a staged-and-modified path once', () => {
    const out = 'src/uploader.ts\0src/uploader.ts\0notes.txt\0'

    expect(parseLsFiles(out).files).toEqual(['notes.txt', 'src/uploader.ts'])
  })

  it('is empty for empty output', () => {
    expect(parseLsFiles('')).toEqual({ files: [], truncated: false })
  })

  it('keeps exactly MAX_FILES paths without marking the listing truncated', () => {
    const out = Array.from({ length: MAX_FILES }, (_, i) => `f${String(i).padStart(6, '0')}`)

    const r = parseLsFiles(`${out.join('\0')}\0`)

    expect(r.files).toHaveLength(MAX_FILES)
    expect(r.truncated).toBe(false)
  })

  it('cuts at MAX_FILES, keeping the first in order, and marks it truncated', () => {
    const paths = Array.from({ length: MAX_FILES + 5 }, (_, i) => `f${String(i).padStart(6, '0')}`)

    const r = parseLsFiles([...paths].reverse().join('\0'))

    expect(r.truncated).toBe(true)
    expect(r.files).toHaveLength(MAX_FILES)
    expect(r.files[0]).toBe('f000000')
    expect(r.files.at(-1)).toBe(paths[MAX_FILES - 1])
  })
})

describe('insideWorktree', () => {
  it.each([
    ['src/app/main.ts', 'src/app/main.ts'],
    ['README.md', 'README.md'],
    ['./a', 'a'],
    ['a/', 'a'],
    ['./src/retry.ts', 'src/retry.ts'],
    ['.gitignore', '.gitignore']
  ])('accepts %j as %j', (path, expected) => {
    expect(insideWorktree(ROOT, path)).toBe(expected)
  })

  it.each([
    ['..'],
    ['../x'],
    ['a/../../x'],
    ['src/..'],
    ['a/./b'],
    ['a//b'],
    ['/etc/passwd'],
    [`${ROOT}/README.md`],
    [''],
    ['.'],
    ['./']
  ])('refuses %j', (path) => {
    expect(insideWorktree(ROOT, path)).toBeNull()
  })
})
