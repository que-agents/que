import { describe, expect, it } from 'vitest'
import { fakeParentOf, makeFakeEpic, makeFakeIssue } from '../testing/fakes'
import {
  decodeParentLink,
  decodeSearch,
  decodeWorkItem,
  decodeWorkItemView,
  levelOf
} from './tickets.decode'

describe('decodeWorkItem', () => {
  it('reads an issue in acli shape', () => {
    expect(decodeWorkItem(makeFakeIssue({ fields: { labels: ['api'] } }))).toEqual({
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
      labels: ['api'],
      updatedAt: '2026-10-13T09:30:00.000+0000'
    })
  })

  it('takes the project from the key prefix and has no age without project and updated', () => {
    const issue = makeFakeIssue({ key: 'WEB-7' })
    delete (issue.fields as Record<string, unknown>).project
    delete (issue.fields as Record<string, unknown>).updated
    expect(decodeWorkItem(issue)).toMatchObject({
      key: 'WEB-7',
      projectKey: 'WEB',
      projectName: 'WEB',
      updatedAt: null
    })
  })

  it('returns null without a key or a summary', () => {
    expect(decodeWorkItem({ fields: { summary: 'x' } })).toBeNull()
    expect(decodeWorkItem(makeFakeIssue({ fields: { summary: '' } }))).toBeNull()
    expect(decodeWorkItem(null)).toBeNull()
    expect(decodeWorkItem('APP-1')).toBeNull()
  })

  it('says unknown for an unrecognised status category and defaults the rest', () => {
    const item = decodeWorkItem({
      key: 'OPS-7',
      fields: { summary: 'Rotate keys', status: { name: 'Weird', statusCategory: { key: 'x' } } }
    })

    expect(item).toMatchObject({
      statusCategory: 'unknown',
      priority: null,
      assignee: null,
      labels: [],
      projectKey: 'OPS',
      updatedAt: null
    })
  })
})

describe('decodeSearch', () => {
  it('reads every complete issue of a search and drops the rest', () => {
    const items = decodeSearch([makeFakeIssue(), { key: 'APP-2' }, 42, makeFakeEpic()])

    expect(items?.map((i) => [i.key, i.level])).toEqual([
      ['APP-1432', 'standard'],
      ['APP-1400', 'epic']
    ])
  })

  it('is null when the output is not a list', () => {
    expect(decodeSearch({ issues: [] })).toBeNull()
  })
})

describe('decodeParentLink', () => {
  it('reads the parent a view names, with its fields', () => {
    const view = makeFakeIssue({ fields: { parent: fakeParentOf(makeFakeEpic()) } })

    expect(decodeParentLink(view)).toMatchObject({
      key: 'APP-1400',
      item: { key: 'APP-1400', summary: 'Uploader reliability', level: 'epic' }
    })
  })

  it('has no item for a parent without a summary, and is null without a parent', () => {
    expect(decodeParentLink({ fields: { parent: { key: 'APP-9' } } })).toEqual({
      key: 'APP-9',
      item: null
    })
    expect(decodeParentLink(makeFakeIssue())).toBeNull()
    expect(decodeParentLink('nope')).toBeNull()
  })
})

describe('decodeWorkItemView', () => {
  it('reads the summary and the description document', () => {
    const view = decodeWorkItemView(makeFakeEpic())

    expect(view?.summary).toBe('Uploader reliability')
    expect(view?.description).toMatchObject({ kind: 'doc', content: [{ kind: 'paragraph' }] })
  })

  it('is null for output that is not an object', () => {
    expect(decodeWorkItemView([])).toBeNull()
    expect(decodeWorkItemView(null)).toBeNull()
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
