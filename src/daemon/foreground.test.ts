import { describe, expect, it } from 'vitest'
import { foregroundName } from './foreground'

// Rows as `ps -ww -t ttys016 -o pid=,pgid=,ucomm=,comm=` prints them.
const LOGIN_SHELL = '48290 48290 zsh              -zsh'

const SESSION = [
  LOGIN_SHELL,
  '48377 48377 2.1.304          /Users/dev/.local/bin/claude',
  '48401 48377 node             /opt/homebrew/bin/node'
].join('\n')

describe('foregroundName', () => {
  it.each([
    ['the leader of the foreground group, by its argv[0]', SESSION, '2.1.304', 'claude'],
    ['a login shell, without its leading dash', LOGIN_SHELL, 'zsh', 'zsh'],
    ['a plain program', `${LOGIN_SHELL}\n48512 48512 cat              cat`, 'cat', 'cat'],
    [
      'a program whose path and name have spaces',
      '48620 48620 Mixer Helper     /Applications/Sound Mixer.app/Contents/MacOS/Mixer Helper',
      'Mixer Helper',
      'Mixer Helper'
    ],
    ['nothing when the name is only the start of a longer one', LOGIN_SHELL, 'zs', null],
    ['nothing when the name matches only a process that leads no group', SESSION, 'node', null],
    ['nothing in empty output', '', 'zsh', null]
  ])('finds %s', (_what, ps, raw, expected) => {
    expect(foregroundName(ps, raw)).toBe(expected)
  })
})
