import { describe, expect, it } from 'vitest'
import { firstLine, run } from './exec'

describe('run', () => {
  it('returns what a successful run printed', async () => {
    const r = await run(process.execPath, ['-e', 'process.stdout.write("que 0.1.0\\n")'])

    expect(r).toEqual({ ok: true, stdout: 'que 0.1.0\n', stderr: '', code: null, error: '' })
  })

  it('reports a failed run with its stderr instead of throwing', async () => {
    const r = await run(process.execPath, [
      '-e',
      'console.error("no such branch"); process.exit(2)'
    ])

    expect(r.ok).toBe(false)
    expect(r.stderr).toBe('no such branch\n')
    expect(r.code).toBeNull()
  })

  it('carries ENOENT when the binary is missing', async () => {
    const r = await run('que-missing-binary-1432', ['--version'])

    expect(r.ok).toBe(false)
    expect(r.code).toBe('ENOENT')
    expect(r.error).toContain('ENOENT')
  })
})

describe('firstLine', () => {
  it('takes the first line of the trimmed text, or the fallback', () => {
    expect(firstLine('\n  error: no pull requests found\nhint: run gh auth\n')).toBe(
      'error: no pull requests found'
    )
    expect(firstLine('  \n', 'spawn gh ENOENT')).toBe('spawn gh ENOENT')
    expect(firstLine('')).toBe('')
  })
})
