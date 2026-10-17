// Decodes what `acli jira workitem search/view --json` prints (the ticket CLI)
// into typed values for tickets.ts.
import type { Ticket, TicketLevel } from '../shared/types'
import { type AdfDocument, decodeAdf } from './adf-text.decode'
import { fieldsOf, strOrNull } from '../shared/json.decode'

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

/** Epic, standard or subtask, from the issue type's hierarchy level (its name as a fallback). */
export function levelOf(issuetype: unknown): TicketLevel {
  const t = fieldsOf(issuetype)
  const level = typeof t.hierarchyLevel === 'number' ? t.hierarchyLevel : null

  if (t.subtask === true || (level !== null && level < 0)) return 'subtask'

  if ((level !== null && level >= 1) || strOrNull(t.name)?.toLowerCase() === 'epic') return 'epic'

  return 'standard'
}

/** One issue from `search` or `view`, or null without a key and a summary. */
export function decodeWorkItem(raw: unknown): WorkItem | null {
  const issue = fieldsOf(raw)
  const fields = fieldsOf(issue.fields)
  const key = strOrNull(issue.key)
  const summary = strOrNull(fields.summary)

  if (!key || !summary) return null
  const status = fieldsOf(fields.status)
  const category = fieldsOf(status.statusCategory).key
  const project = fieldsOf(fields.project)
  const prefix = key.split('-')[0]

  const labels = Array.isArray(fields.labels)
    ? fields.labels.filter((l): l is string => typeof l === 'string')
    : []

  return {
    key,
    summary,
    status: strOrNull(status.name) ?? 'Unknown',
    statusCategory:
      category === 'new' || category === 'indeterminate' || category === 'done'
        ? category
        : 'unknown',
    priority: strOrNull(fieldsOf(fields.priority).name),
    type: strOrNull(fieldsOf(fields.issuetype).name) ?? 'Task',
    level: levelOf(fields.issuetype),
    parentKey: null,
    assigned: true,
    assignee: strOrNull(fieldsOf(fields.assignee).displayName),
    projectKey: strOrNull(project.key) ?? prefix,
    projectName: strOrNull(project.name) ?? strOrNull(project.key) ?? prefix,
    labels,
    updatedAt: strOrNull(fields.updated)
  }
}

/** The issues of a `search`, dropping incomplete ones; null when the output is not a list. */
export function decodeSearch(v: unknown): WorkItem[] | null {
  if (!Array.isArray(v)) return null

  return v.flatMap((i) => decodeWorkItem(i) ?? [])
}

/** The parent of a `view --fields parent`, or null when it has none. */
export function decodeParentLink(v: unknown): ParentLink | null {
  const parent = fieldsOf(fieldsOf(v).fields).parent
  const key = strOrNull(fieldsOf(parent).key)

  if (!key) return null

  return { key, item: decodeWorkItem({ key, fields: fieldsOf(parent).fields }) }
}

/** The summary and description of a `view`, or null when the output is not an object. */
export function decodeWorkItemView(v: unknown): WorkItemView | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  const fields = fieldsOf(fieldsOf(v).fields)

  return { summary: strOrNull(fields.summary), description: decodeAdf(fields.description) }
}
