import { describe, expect, it } from 'vitest'
import type { Ticket } from '../shared/types'
import { makeFakeIssue } from '../testing/fakes'
import { levelOf, parseIssue, renderBrief, workspaceNameFor } from './tickets'

const AT = '2026-10-14T08:00:00.000Z'

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    key: 'APP-1432',
    summary: 'Add retry logic to the uploader',
    status: 'In Progress',
    statusCategory: 'indeterminate',
    priority: 'Medium',
    type: 'Story',
    level: 'standard',
    parentKey: null,
    assigned: true,
    assignee: null,
    projectKey: 'APP',
    projectName: 'Uploader',
    url: 'https://example.atlassian.net/browse/APP-1432',
    labels: [],
    updatedAt: null,
    syncedAt: AT,
    workspaceId: null,
    ...overrides
  }
}

describe('parseIssue', () => {
  it('reads an issue in acli shape', () => {
    expect(
      parseIssue(makeFakeIssue({ fields: { labels: ['api'] } }), AT, 'example.atlassian.net')
    ).toEqual({
      key: 'APP-1432',
      summary: 'Add retry logic to the uploader',
      status: 'In Progress',
      statusCategory: 'indeterminate',
      priority: 'Medium',
      type: 'Story',
      level: 'standard',
      parentKey: null,
      assigned: true,
      assignee: 'Test User',
      projectKey: 'APP',
      projectName: 'Uploader',
      url: 'https://example.atlassian.net/browse/APP-1432',
      labels: ['api'],
      updatedAt: '2026-10-13T09:30:00.000+0000',
      syncedAt: AT,
      workspaceId: null
    })
  })

  it('takes the project from the key prefix and has no age without project and updated', () => {
    const issue = makeFakeIssue({ key: 'WEB-7' })
    delete (issue.fields as Record<string, unknown>).project
    delete (issue.fields as Record<string, unknown>).updated
    expect(parseIssue(issue, AT)).toMatchObject({
      key: 'WEB-7',
      projectKey: 'WEB',
      projectName: 'WEB',
      updatedAt: null
    })
  })

  it('returns null without a key or a summary', () => {
    expect(parseIssue({ fields: { summary: 'x' } }, AT)).toBeNull()
    expect(parseIssue(makeFakeIssue({ fields: { summary: '' } }), AT)).toBeNull()
    expect(parseIssue(null, AT)).toBeNull()
    expect(parseIssue('APP-1', AT)).toBeNull()
  })

  it('says unknown for an unrecognised status category and defaults the rest', () => {
    const t = parseIssue(
      {
        key: 'OPS-7',
        fields: { summary: 'Rotate keys', status: { name: 'Weird', statusCategory: { key: 'x' } } }
      },
      AT,
      'acme.atlassian.net'
    )

    expect(t).toMatchObject({
      statusCategory: 'unknown',
      priority: null,
      assignee: null,
      labels: [],
      projectKey: 'OPS',
      url: 'https://acme.atlassian.net/browse/OPS-7',
      updatedAt: null
    })
  })
})

describe('workspaceNameFor', () => {
  it('is the lowercased key and the slug of the summary', () => {
    expect(workspaceNameFor(ticket())).toBe('app-1432-add-retry-logic-to-the-uploader')
  })

  it('caps at 64 characters without a trailing hyphen', () => {
    const name = workspaceNameFor(
      ticket({
        summary: 'Add retry logic to the uploader so that flaky networks do not lose files'
      })
    )

    expect(name.length).toBeLessThanOrEqual(64)
    expect(name.endsWith('-')).toBe(false)
    expect(name.startsWith('app-1432-add-retry-logic')).toBe(true)
  })

  it('drops punctuation', () => {
    expect(workspaceNameFor(ticket({ summary: 'Fix: "login" (SSO) bug!' }))).toBe(
      'app-1432-fix-login-sso-bug'
    )
  })
})

describe('renderBrief', () => {
  it('lays out the heading, link, facts and description', () => {
    expect(renderBrief(ticket({ labels: ['api', 'tech-debt'] }), 'Do the thing.')).toBe(
      [
        '# APP-1432 Add retry logic to the uploader',
        '',
        'https://example.atlassian.net/browse/APP-1432',
        'Status: In Progress · Priority: Medium · Type: Story',
        'Labels: api, tech-debt',
        '',
        '## Description',
        '',
        'Do the thing.',
        ''
      ].join('\n')
    )
  })

  it('omits labels when there are none and says (none) for an empty description', () => {
    const brief = renderBrief(ticket({ priority: null }), '  ')
    expect(brief).not.toContain('Labels:')
    expect(brief).toContain('Priority: none')
    expect(brief.endsWith('## Description\n\n(none)\n')).toBe(true)
  })
})

describe('levelOf', () => {
  it('reads the hierarchy level, the subtask flag, and the type name', () => {
    expect(levelOf({ name: 'Initiative', hierarchyLevel: 1 })).toBe('epic')
    expect(levelOf({ name: 'Story', hierarchyLevel: 0 })).toBe('standard')
    expect(levelOf({ name: 'Sub-task', hierarchyLevel: -1 })).toBe('subtask')
    expect(levelOf({ name: 'Sub-task', subtask: true })).toBe('subtask')
    expect(levelOf({ name: 'Epic' })).toBe('epic')
    expect(levelOf(undefined)).toBe('standard')
  })
})

describe('renderBrief with a parent', () => {
  const epic = { key: 'APP-1400', summary: 'Uploader reliability', isEpic: true }

  it('appends the epic after the description', () => {
    const brief = renderBrief(ticket(), 'Do it.', { ...epic, description: 'The big picture.' })
    expect(
      brief.endsWith('Do it.\n\n## Epic APP-1400: Uploader reliability\n\nThe big picture.\n')
    ).toBe(true)
  })

  it('calls a parent that is not an epic a parent, and says (none) for no description', () => {
    const brief = renderBrief(ticket(), 'x', { ...epic, isEpic: false, description: ' ' })
    expect(brief).toContain('## Parent APP-1400: Uploader reliability\n\n(none)\n')
  })

  it('has no parent section without a parent', () => {
    expect(renderBrief(ticket(), 'x')).not.toContain('## Epic')
  })
})
