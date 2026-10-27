import { describe, expect, it } from 'vitest'
import { chooseUserStatusLine, isQueStatusLine, statusLineSettingsFiles } from './statusline'

const line = (command: string, type = 'command'): string =>
  JSON.stringify({ model: 'opus', statusLine: { type, command, padding: 0 } })

describe('statusLineSettingsFiles', () => {
  it('lists the project local, project, then user settings', () => {
    expect(statusLineSettingsFiles('/Users/dev/src/uploader', '/Users/dev')).toEqual([
      '/Users/dev/src/uploader/.claude/settings.local.json',
      '/Users/dev/src/uploader/.claude/settings.json', // nosemgrep: que-no-claude-settings-json
      '/Users/dev/.claude/settings.json' // nosemgrep: que-no-claude-settings-json
    ])
  })
})

describe('chooseUserStatusLine', () => {
  describe('precedence', () => {
    it('takes the project local settings over the project and user ones', () => {
      expect(
        chooseUserStatusLine([
          line('~/bin/branch-line.sh'),
          line('npx ccline'),
          line('~/.claude/statusline.sh')
        ])
      ).toBe('~/bin/branch-line.sh')
    })

    it('falls through files that are missing or name no status line', () => {
      expect(
        chooseUserStatusLine([
          null,
          JSON.stringify({ permissions: { allow: ['Bash(npm test)'] } }),
          line('~/.claude/statusline.sh')
        ])
      ).toBe('~/.claude/statusline.sh')
    })
  })

  describe("que's own command", () => {
    it('is skipped in favour of the next file', () => {
      expect(
        chooseUserStatusLine([line('que statusline'), null, line('~/.claude/statusline.sh')])
      ).toBe('~/.claude/statusline.sh')
    })

    it('is recognised however the que binary is reached', () => {
      expect(isQueStatusLine('que statusline')).toBe(true)
      expect(isQueStatusLine('/Users/dev/.que/bin/que statusline')).toBe(true)
      expect(isQueStatusLine("'/Applications/que.app/bin/que' statusline --x")).toBe(true)
      expect(isQueStatusLine('queue statusline')).toBe(false)
      expect(isQueStatusLine('~/.claude/que-statusline.sh')).toBe(false)
    })
  })

  describe('none', () => {
    it('is null with no settings files at all', () => {
      expect(chooseUserStatusLine([null, null, null])).toBeNull()
    })

    it('is null when only que names a status line', () => {
      expect(chooseUserStatusLine([null, null, line('que statusline')])).toBeNull()
    })

    it('passes over a status line that is not a command, or has an empty one', () => {
      expect(chooseUserStatusLine([line('echo hi', 'static'), line('   '), null])).toBeNull()
    })
  })

  describe('errors', () => {
    it('passes over a file that does not parse', () => {
      expect(chooseUserStatusLine(['{"statusLine": {', '', line('~/.claude/statusline.sh')])).toBe(
        '~/.claude/statusline.sh'
      )
    })

    it('passes over settings that are not an object', () => {
      expect(chooseUserStatusLine(['[1, 2]', 'null', '"que"'])).toBeNull()
    })
  })
})
