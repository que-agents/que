import { describe, expect, it } from 'vitest'
import type { Ticket } from '../shared/types'
import { makeFakeIssue } from '../testing/fakes'
import { renderBrief, ticketFrom, workspaceNameFor } from './tickets'
import { decodeWorkItem } from './tickets.decode'

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

describe('ticketFrom', () => {
  it('stamps the sync time and links the page on the site', () => {
    const item = decodeWorkItem(makeFakeIssue({ fields: { labels: ['api'] } }))

    expect(item && ticketFrom(item, AT, 'example.atlassian.net')).toEqual(
      ticket({ labels: ['api'], assignee: 'Test User', updatedAt: '2026-10-13T09:30:00.000+0000' })
    )
  })

  it('has no link without a site', () => {
    const item = decodeWorkItem(makeFakeIssue())

    expect(item && ticketFrom(item, AT).url).toBe('')
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
