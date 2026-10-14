import { describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeBridge } from '@renderer/testing/fake-bridge'
import { makeProject, makeTask, makeWorkspace } from '@renderer/testing/fixtures'
import App from '../App'

const uploader = makeProject()
const api = makeProject({ id: 'prj_01hzw9c4v7kd', name: 'api', path: '/Users/dev/code/api' })
const retry = makeWorkspace({
  id: 'ws_01hzx3k9c2qf',
  name: 'app-1432-retry-logic',
  status: 'working'
})
const board = makeWorkspace({
  id: 'ws_01hzx4m1p8rt',
  name: 'app-1440-quiet-board',
  status: 'stuck',
  statusReason: 'no_heartbeat'
})
const auth = makeWorkspace({
  id: 'ws_01hzx5t6y2wa',
  projectId: api.id,
  name: 'app-1451-token-refresh',
  status: 'needs_input'
})

function seed(): void {
  fakeBridge.seedProject(uploader)
  fakeBridge.seedProject(api)
  fakeBridge.seedWorkspace(retry)
  fakeBridge.seedWorkspace(board)
  fakeBridge.seedWorkspace(auth)
}

describe('Sidebar', () => {
  describe('rendering', () => {
    it('lists each workspace under its project with a status badge', async () => {
      seed()
      render(<App />)

      const project = await screen.findByTestId(`sidebar-project-${uploader.id}`)
      expect(within(project).getByText('app-1432-retry-logic')).toBeInTheDocument()
      expect(within(project).getByText('app-1440-quiet-board')).toBeInTheDocument()
      expect(within(project).queryByText('app-1451-token-refresh')).not.toBeInTheDocument()
      expect(
        within(screen.getByTestId(`sidebar-project-${api.id}`)).getByText('app-1451-token-refresh')
      ).toBeInTheDocument()
      expect(screen.getByTestId(`sidebar-workspace-${retry.id}-status`)).toHaveTextContent(
        'working'
      )
      expect(screen.getByTestId(`sidebar-workspace-${auth.id}-status`)).toHaveTextContent(
        'needs input'
      )
      const stuck = screen.getByTestId(`sidebar-workspace-${board.id}-status`)
      expect(stuck).toHaveTextContent('stuck')
      expect(stuck).toHaveAttribute('title', 'stuck: no_heartbeat')
    })

    it('collapses a project', async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)

      await user.click(await screen.findByRole('button', { name: /api/, expanded: true }))

      expect(screen.queryByText('app-1451-token-refresh')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /api/, expanded: false })).toBeInTheDocument()
    })

    it('invites adding a repository when there are no projects', async () => {
      render(<App />)

      expect(await screen.findByTestId('sidebar-empty')).toHaveTextContent(
        'Add a git repository to start a workspace.'
      )
    })
  })

  describe('status updates', () => {
    it('moves the badge when the status engine says so', async () => {
      seed()
      render(<App />)
      const badge = await screen.findByTestId(`sidebar-workspace-${retry.id}-status`)

      fakeBridge.setStatus(retry.id, 'needs_input')

      await waitFor(() => {
        expect(badge).toHaveTextContent('needs input')
      })
      expect(badge).toHaveAttribute('data-status', 'needs_input')
    })

    it('shows a workspace created elsewhere while it prepares, and drops a removed one', async () => {
      seed()
      render(<App />)
      await screen.findByTestId(`sidebar-workspace-${retry.id}`)

      const created = await window.que.workspace.create({
        projectId: uploader.id,
        name: 'APP-1460 upload resume'
      })
      await window.que.workspace.remove({ id: board.id })

      expect(await screen.findByTestId(`sidebar-workspace-${created.id}-status`)).toHaveTextContent(
        'preparing'
      )
      expect(screen.queryByTestId(`sidebar-workspace-${board.id}`)).not.toBeInTheDocument()
    })
  })

  describe('overnight tasks', () => {
    const owned = makeWorkspace({
      id: 'ws_01hzx6v8b3xc',
      name: 'add-retry-logic',
      status: 'exited'
    })
    const task = makeTask({
      id: 'tsk_01hzy0d7w3ke',
      title: 'Add retry logic to the uploader',
      workspaceId: owned.id,
      state: 'running'
    })

    it("shows the task's state on its workspace while it runs, then done with the PR", async () => {
      seed()
      fakeBridge.seedWorkspace(owned)
      fakeBridge.seedTask(task)
      render(<App />)
      const badge = await screen.findByTestId(`sidebar-workspace-${owned.id}-status`)
      expect(badge).toHaveAttribute('data-status', 'running')
      expect(badge).toHaveTextContent('running')

      fakeBridge.updateTask(task.id, { prUrl: 'https://github.com/rquellh/que/pull/88' })
      fakeBridge.setTaskState(task.id, 'done')

      await waitFor(() => {
        expect(badge).toHaveAttribute('data-status', 'done')
      })
      expect(screen.getByTestId(`sidebar-workspace-${owned.id}-pr`)).toHaveAttribute(
        'href',
        'https://github.com/rquellh/que/pull/88'
      )
    })

    it('shows the workspace status again for a task that ended without finishing', async () => {
      seed()
      fakeBridge.seedWorkspace(owned)
      fakeBridge.seedTask({ ...task, state: 'failed', reason: 'crashed' })
      render(<App />)

      const badge = await screen.findByTestId(`sidebar-workspace-${owned.id}-status`)
      expect(badge).toHaveAttribute('data-status', 'exited')
      expect(screen.queryByTestId(`sidebar-workspace-${owned.id}-pr`)).not.toBeInTheDocument()
    })
  })

  describe('projects added elsewhere', () => {
    it('shows a project the CLI added, live', async () => {
      seed()
      render(<App />)
      await screen.findByTestId(`sidebar-project-${uploader.id}`)

      const billing = await window.que.project.add({ path: '/Users/dev/code/billing' })

      expect(await screen.findByTestId(`sidebar-project-${billing.id}`)).toHaveTextContent(
        'billing'
      )
    })

    it('drops a project removed elsewhere', async () => {
      seed()
      render(<App />)
      await screen.findByTestId(`sidebar-project-${api.id}`)

      await window.que.project.remove({ id: api.id, force: true })

      await waitFor(() => {
        expect(screen.queryByTestId(`sidebar-project-${api.id}`)).not.toBeInTheDocument()
      })
    })
  })

  describe('user interactions', () => {
    it('adds the folder picked in the dialog as a project', async () => {
      const user = userEvent.setup()
      fakeBridge.setOpenFolderResult('/Users/dev/code/billing')
      render(<App />)

      await user.click(await screen.findByRole('button', { name: 'Add project' }))

      expect(
        await screen.findByRole('button', { name: /billing/, expanded: true })
      ).toBeInTheDocument()
      expect((await window.que.project.list()).map((p) => p.path)).toEqual([
        '/Users/dev/code/billing'
      ])
    })

    it('removes a workspace from its menu, deleting the branch when asked', async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)

      await user.click(
        await screen.findByRole('button', { name: 'More actions for app-1440-quiet-board' })
      )
      await user.click(screen.getByRole('menuitem', { name: 'Remove…' }))
      const dialog = screen.getByRole('dialog', { name: 'Remove app-1440-quiet-board?' })
      await user.click(within(dialog).getByRole('checkbox', { name: /delete the branch/ }))
      await user.click(within(dialog).getByRole('button', { name: 'Remove' }))

      await waitFor(() => {
        expect(fakeBridge.getWorkspace(board.id)).toBeUndefined()
      })
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.queryByTestId(`sidebar-workspace-${board.id}`)).not.toBeInTheDocument()
    })

    it('opens the workspace in the editor from its menu', async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)

      await user.click(
        await screen.findByRole('button', { name: 'More actions for app-1432-retry-logic' })
      )
      await user.click(screen.getByRole('menuitem', { name: 'Open in editor' }))

      await waitFor(() => {
        expect(fakeBridge.openInEditorCalls()).toEqual([retry.path])
      })
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
  })
})
