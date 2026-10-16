// Decodes what `acli jira workitem search/view --json` prints (the ticket CLI)
// into typed values for tickets.ts.
import type { Ticket, TicketLevel } from '../shared/types'
import { type AdfDocument, decodeAdf } from './adf-text.decode'

/** A ticket as the tracker describes it, before que stamps the sync time and link. */
export type WorkItem = Omit<Ticket, 'syncedAt' | 'url' | 'workspaceId'>

/** The fields `workitem view --fields summary,description` returns. */
export interface WorkItemView {
  summary: string | null
  description: AdfDocument
}

/** The parent `workitem view --fields parent` names, and the work item it is when complete. */
export interface ParentLink {
  key: string
  item: WorkItem | null
}

type Obj = { [key: string]: unknown }

const obj = (v: unknown): Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : {}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

/** Epic, standard or subtask, from the issue type's hierarchy level (its name as a fallback). */
export function levelOf(issuetype: unknown): TicketLevel {
  const t = obj(issuetype)
  const level = typeof t.hierarchyLevel === 'number' ? t.hierarchyLevel : null

  if (t.subtask === true || (level !== null && level < 0)) return 'subtask'

  if ((level !== null && level >= 1) || str(t.name)?.toLowerCase() === 'epic') return 'epic'

  return 'standard'
}

/** One issue from `search` or `view`, or null without a key and a summary. */
export function decodeWorkItem(raw: unknown): WorkItem | null {
  const issue = obj(raw)
  const fields = obj(issue.fields)
  const key = str(issue.key)
  const summary = str(fields.summary)

  if (!key || !summary) return null
  const status = obj(fields.status)
  const category = obj(status.statusCategory).key
  const project = obj(fields.project)
  const prefix = key.split('-')[0]

  const labels = Array.isArray(fields.labels)
    ? fields.labels.filter((l): l is string => typeof l === 'string')
    : []

  return {
    key,
    summary,
    status: str(status.name) ?? 'Unknown',
    statusCategory:
      category === 'new' || category === 'indeterminate' || category === 'done'
        ? category
        : 'unknown',
    priority: str(obj(fields.priority).name),
    type: str(obj(fields.issuetype).name) ?? 'Task',
    level: levelOf(fields.issuetype),
    parentKey: null,
    assigned: true,
    assignee: str(obj(fields.assignee).displayName),
    projectKey: str(project.key) ?? prefix,
    projectName: str(project.name) ?? str(project.key) ?? prefix,
    labels,
    updatedAt: str(fields.updated)
  }
}

/** The issues of a `search`, dropping incomplete ones; null when the output is not a list. */
export function decodeSearch(v: unknown): WorkItem[] | null {
  if (!Array.isArray(v)) return null

  return v.flatMap((i) => decodeWorkItem(i) ?? [])
}

/** The parent of a `view --fields parent`, or null when it has none. */
export function decodeParentLink(v: unknown): ParentLink | null {
  const parent = obj(obj(v).fields).parent
  const key = str(obj(parent).key)

  if (!key) return null

  return { key, item: decodeWorkItem({ key, fields: obj(parent).fields }) }
}

/** The summary and description of a `view`, or null when the output is not an object. */
export function decodeWorkItemView(v: unknown): WorkItemView | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  const fields = obj(obj(v).fields)

  return { summary: str(fields.summary), description: decodeAdf(fields.description) }
}
