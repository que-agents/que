import { describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeBridge } from '@renderer/testing/fake-bridge'
import { makeProject, makeTask, makeWorkspace } from '@renderer/testing/fixtures'
import App from '../App'

const uploader = makeProject()
const retry = makeWorkspace({ id: 'ws_01hzx3k9c2qf', name: 'app-1432-retry-logic' })
const done = makeTask({
  id: 'tsk_01hzy0d7w3ke',
  title: 'Add retry logic to the uploader',
  workspaceId: retry.id,
  state: 'done',
  costUsd: 0.4213,
  prUrl: 'https://github.com/rquellh/que/pull/88',
  createdAt: '2026-10-13T21:05:00.000Z'
})
const queued = makeTask({
  id: 'tsk_01hzy1f2g5mn',
  title: 'Document the upload limits',
  workspaceId: null,
  state: 'queued',
  createdAt: '2026-10-13T22:40:00.000Z'
})

function seed(): void {
  fakeBridge.seedProject(uploader)
  fakeBridge.seedWorkspace(retry)
  fakeBridge.seedTask(done)
  fakeBridge.seedTask(queued)
}

describe('TasksPanel', () => {
  describe('rendering', () => {
    it('lists tasks newest first with state, workspace, cost and PR link', async () => {
      seed()
      render(<App />)

      const panel = await screen.findByTestId('tasks-panel')
      await within(panel).findByTestId(`task-${done.id}`)
      const rows = within(panel).getAllByRole('listitem')
      expect(rows.map((r) => r.dataset.testid)).toEqual([`task-${queued.id}`, `task-${done.id}`])
      const row = within(panel).getByTestId(`task-${done.id}`)
      expect(within(row).getByTestId(`task-${done.id}-state`)).toHaveAttribute(
        'data-status',
        'done'
      )
      expect(within(row).getByText('app-1432-retry-logic')).toBeInTheDocument()
      expect(within(row).getByText('$0.42')).toBeInTheDocument()
      expect(within(row).getByRole('link', { name: 'PR #88' })).toHaveAttribute(
        'href',
        'https://github.com/rquellh/que/pull/88'
      )
      expect(within(row).queryByRole('button', { name: /Stop/ })).not.toBeInTheDocument()
      expect(within(panel).getByText('new workspace')).toBeInTheDocument()
    })
  })

  describe('status updates', () => {
    it('follows a task through its states and shows why it is stuck', async () => {
      seed()
      render(<App />)
      const state = await screen.findByTestId(`task-${queued.id}-state`)

      fakeBridge.setTaskState(queued.id, 'running')
      await waitFor(() => {
        expect(state).toHaveTextContent('running')
      })

      fakeBridge.setTaskState(queued.id, 'stuck', 'max_turns')
      await waitFor(() => {
        expect(state).toHaveAttribute('data-status', 'stuck')
      })
      expect(screen.getByTestId(`task-${queued.id}-reason`)).toHaveTextContent('max_turns')
    })

    it('shows the PR once the finisher records it', async () => {
      seed()
      render(<App />)
      await screen.findByTestId(`task-${queued.id}`)

      fakeBridge.updateTask(queued.id, { prUrl: 'https://github.com/rquellh/que/pull/91' })

      expect(await screen.findByTestId(`task-${queued.id}-pr`)).toHaveTextContent('PR #91')
    })
  })

  describe('user interactions', () => {
    it('adds a task for a project from the dialog', async () => {
      const user = userEvent.setup()
      fakeBridge.seedProject(uploader)
      render(<App />)

      await user.click(await screen.findByRole('button', { name: '+ Task' }))
      const dialog = screen.getByRole('dialog', { name: 'Add a task for tonight' })
      expect(within(dialog).getByRole('combobox', { name: 'Run in' })).toHaveValue(
        `p:${uploader.id}`
      )
      await user.type(
        within(dialog).getByRole('textbox', { name: 'Brief' }),
        'Add retry logic to the uploader'
      )
      await user.type(within(dialog).getByRole('spinbutton', { name: 'Max turns' }), '20')
      await user.click(within(dialog).getByRole('button', { name: 'Add task' }))

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
      const [task] = await window.que.task.list()
      expect(task).toMatchObject({
        projectId: uploader.id,
        workspaceId: null,
        brief: 'Add retry logic to the uploader',
        maxTurns: 20,
        maxBudgetUsd: 5
      })
      expect(await screen.findByTestId(`task-${task.id}-state`)).toHaveTextContent('queued')
    })

    it('runs and closes the queue', async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)
      const control = await screen.findByTestId('queue-control')
      expect(control).toHaveTextContent('Queue closed 0/2')

      await user.click(within(control).getByRole('button', { name: 'Run' }))

      await waitFor(() => {
        expect(control).toHaveTextContent('Queue open')
      })
      expect((await window.que.queue.state()).open).toBe(true)
      expect(within(control).getByRole('button', { name: 'Run' })).toBeDisabled()

      await user.click(within(control).getByRole('button', { name: 'Close' }))

      await waitFor(() => {
        expect(control).toHaveTextContent('Queue closed')
      })
      expect((await window.que.queue.state()).open).toBe(false)
    })

    it('stops a live task', async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)

      await user.click(
        await screen.findByRole('button', { name: 'Stop Document the upload limits' })
      )

      await waitFor(() => {
        expect(fakeBridge.getTask(queued.id)?.state).toBe('stopped')
      })
      expect(screen.getByTestId(`task-${queued.id}-state`)).toHaveTextContent('stopped')
    })
  })
})
