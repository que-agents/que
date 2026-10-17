import { describe, expect, it } from 'vitest'
import { type Existing, describeCliInstall, planCliInstall } from './install-cli'

const HOME = '/Users/dev'
const nothing = (): Existing => 'none'

describe('planCliInstall', () => {
  it('links into /usr/local/bin when it is writable, with no PATH hint', () => {
    expect(planCliInstall({ home: HOME, systemBinWritable: true, existing: nothing })).toEqual({
      link: '/usr/local/bin/que',
      dir: '/usr/local/bin',
      action: 'create',
      pathHint: null
    })
  })

  it('falls back to ~/.local/bin without asking for privileges, and says how to add it to PATH', () => {
    const plan = planCliInstall({ home: HOME, systemBinWritable: false, existing: nothing })

    expect(plan).toEqual({
      link: '/Users/dev/.local/bin/que',
      dir: '/Users/dev/.local/bin',
      action: 'create',
      pathHint: 'export PATH="$HOME/.local/bin:$PATH"'
    })
    expect(describeCliInstall(plan).detail).toContain('export PATH="$HOME/.local/bin:$PATH"')
  })

  it('replaces an earlier link (an older or moved app) in the chosen directory', () => {
    const seen: string[] = []

    const plan = planCliInstall({
      home: HOME,
      systemBinWritable: true,
      existing: (link) => {
        seen.push(link)

        return 'other-link'
      }
    })

    expect(seen).toEqual(['/usr/local/bin/que'])
    expect(plan.action).toBe('replace')
  })

  it('refuses to overwrite a real file it did not make', () => {
    const plan = planCliInstall({ home: HOME, systemBinWritable: false, existing: () => 'file' })

    expect(plan.action).toBe('refuse')
    expect(describeCliInstall(plan)).toEqual({
      message: '/Users/dev/.local/bin/que already exists',
      detail: 'It is not a link que made, so it was left alone. Remove it and try again.'
    })
  })
})
