import { describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeBridge } from '@renderer/testing/fake-bridge'
import {
  makeProject,
  makePullRequest,
  makeTask,
  makeTicket,
  makeTermInfo,
  makeWorkspace
} from '@renderer/testing/fixtures'
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

      await user.click(await screen.findByRole('button', { name: 'api', expanded: true }))

      expect(screen.queryByText('app-1451-token-refresh')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'api', expanded: false })).toBeInTheDocument()
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

  describe('pull requests', () => {
    it('shows a chip link with the PR number, state and tone', async () => {
      seed()
      fakeBridge.seedWorkspace({ ...retry, pr: makePullRequest({ state: 'draft' }) })
      render(<App />)

      const chip = await screen.findByRole('link', { name: '#41' })
      expect(chip).toHaveAttribute('href', 'https://github.com/rquellh/que/pull/41')
      expect(chip).toHaveAttribute('data-pr-state', 'draft')
      expect(chip).toHaveClass('tone-neutral')
      expect(chip).toHaveAttribute('title', 'PR #41: draft')
    })

    it('updates the chip live when the daemon refreshes the PR', async () => {
      seed()
      fakeBridge.seedWorkspace({ ...retry, pr: makePullRequest({ state: 'draft' }) })
      render(<App />)
      const chip = await screen.findByRole('link', { name: '#41' })

      fakeBridge.setWorkspacePr(retry.id, makePullRequest({ state: 'open', checks: 'failing' }))

      await waitFor(() => {
        expect(chip).toHaveClass('tone-bad')
      })
      expect(chip).toHaveAttribute('data-pr-state', 'open')
      expect(chip).toHaveAttribute('data-pr-checks', 'failing')
    })

    it("still links a finished task's PR while the workspace has no pr", async () => {
      seed()
      const owned = makeWorkspace({ id: 'ws_01hzx6v8b3xd', name: 'add-retry-logic' })
      fakeBridge.seedWorkspace(owned)
      fakeBridge.seedTask(
        makeTask({
          workspaceId: owned.id,
          state: 'done',
          prUrl: 'https://github.com/rquellh/que/pull/88'
        })
      )
      render(<App />)

      expect(await screen.findByRole('link', { name: 'PR #88' })).toHaveAttribute(
        'href',
        'https://github.com/rquellh/que/pull/88'
      )
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

    it('removes a project and its workspaces from its right-click menu', async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)
      const row = await screen.findByRole('button', { name: 'uploader', expanded: true })

      await user.pointer({ keys: '[MouseRight]', target: row })
      const menu = screen.getByRole('menu', { name: 'Actions for uploader' })
      expect(
        within(menu)
          .getAllByRole('menuitem')
          .map((m) => m.textContent)
      ).toEqual(['New workspace…', 'Open in editor', 'Remove project…'])
      await user.click(within(menu).getByRole('menuitem', { name: 'Remove project…' }))
      const dialog = screen.getByRole('dialog', { name: 'Remove uploader?' })
      expect(dialog).toHaveTextContent('the repository itself is not touched')
      expect(dialog).toHaveTextContent('Its 2 workspaces are removed too')
      await user.click(within(dialog).getByRole('button', { name: 'Remove' }))

      await waitFor(() => {
        expect(screen.queryByTestId(`sidebar-project-${uploader.id}`)).not.toBeInTheDocument()
      })
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect((await window.que.project.list()).map((p) => p.id)).toEqual([api.id])
      expect(fakeBridge.getWorkspace(retry.id)).toBeUndefined()
      expect(fakeBridge.getWorkspace(board.id)).toBeUndefined()
      expect(screen.getByTestId(`sidebar-project-${api.id}`)).toBeInTheDocument()
    })

    it('removes a project from its ⋯ button too, saying nothing about workspaces when it has none', async () => {
      const user = userEvent.setup()
      const billing = makeProject({
        id: 'prj_01hzwb2x9m4e',
        name: 'billing',
        path: '/Users/dev/code/billing'
      })
      seed()
      fakeBridge.seedProject(billing)
      render(<App />)

      await user.click(await screen.findByRole('button', { name: 'More actions for billing' }))
      await user.click(screen.getByRole('menuitem', { name: 'Remove project…' }))
      const dialog = screen.getByRole('dialog', { name: 'Remove billing?' })
      expect(dialog).not.toHaveTextContent('removed too')
      await user.click(within(dialog).getByRole('button', { name: 'Remove' }))

      await waitFor(() => {
        expect(screen.queryByTestId(`sidebar-project-${billing.id}`)).not.toBeInTheDocument()
      })
    })

    it('offers the workspace actions on right-click too, and closes them with Escape', async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)
      const row = await screen.findByTestId(`sidebar-workspace-${retry.id}`)

      await user.pointer({ keys: '[MouseRight]', target: row })
      const menu = screen.getByRole('menu', { name: 'Actions for app-1432-retry-logic' })
      expect(
        within(menu)
          .getAllByRole('menuitem')
          .map((m) => m.textContent)
      ).toEqual(['Open in editor', 'Remove…'])
      await user.keyboard('{Escape}')

      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    describe('sessions', () => {
      const zsh = makeTermInfo({
        id: '7d0c5b2a-1111-4000-8000-3e4f5a6b7c8d',
        name: 'zsh',
        cwd: '/Users/dev'
      })
      const node = makeTermInfo({
        id: '7d0c5b2a-2222-4000-8000-3e4f5a6b7c8d',
        name: 'node',
        cwd: '/Users/dev/code/api'
      })

      it('lists the terminals outside any workspace above the projects, and opens the one clicked', async () => {
        const user = userEvent.setup()
        fakeBridge.seedTerminal(zsh)
        fakeBridge.seedTerminal(node)
        seed()
        render(<App />)

        const sessions = await screen.findByRole('navigation', { name: 'Sessions' })
        const projects = screen.getByRole('navigation', { name: 'Projects' })
        expect(
          sessions.compareDocumentPosition(projects) & Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy()
        expect(
          within(sessions)
            .getAllByRole('listitem')
            .map((li) => li.textContent)
        ).toEqual(['›_zsh', '›_node'])

        await user.click(within(sessions).getByRole('button', { name: 'node' }))

        expect(screen.getByTestId(`sidebar-session-${node.id}-open`)).toHaveAttribute(
          'aria-current',
          'page'
        )
        expect(screen.getByTestId(`sidebar-session-${zsh.id}-open`)).not.toHaveAttribute(
          'aria-current'
        )
        expect(screen.getByTestId(`terminal-tab-${node.id}-select`)).toHaveAttribute(
          'aria-selected',
          'true'
        )
      })

      it('opens a new session from +, and selects it', async () => {
        const user = userEvent.setup()
        fakeBridge.seedTerminal(zsh)
        render(<App />)
        const sessions = await screen.findByRole('navigation', { name: 'Sessions' })
        await within(sessions).findByRole('button', { name: 'zsh' })

        await user.click(screen.getByRole('button', { name: 'New session' }))

        await waitFor(() => {
          expect(within(sessions).getAllByRole('listitem')).toHaveLength(2)
        })
        const [, created] = within(sessions).getAllByRole('listitem')
        expect(within(created).getByRole('button')).toHaveAttribute('aria-current', 'page')
        expect((await window.que.term.list()).filter((t) => !t.workspaceId)).toHaveLength(2)
      })
    })
  })
})

describe('Sidebar tickets entry', () => {
  it('counts the open tickets and opens the view', async () => {
    const user = userEvent.setup()
    fakeBridge.seedTicket(makeTicket({ key: 'APP-1' }))
    fakeBridge.seedTicket(makeTicket({ key: 'APP-2', statusCategory: 'new' }))
    fakeBridge.seedTicket(makeTicket({ key: 'APP-3', statusCategory: 'done' }))
    render(<App />)

    const entry = await screen.findByRole('button', { name: /^Tickets/ })
    await waitFor(() => expect(screen.getByTestId('sidebar-tickets-count')).toHaveTextContent('2'))
    expect(screen.queryByTestId('sidebar-tickets-error')).not.toBeInTheDocument()
    expect(entry).not.toHaveAttribute('aria-current')

    await user.click(entry)

    expect(await screen.findByTestId('tickets-view')).toBeInTheDocument()
    expect(entry).toHaveAttribute('aria-current', 'page')
  })
})
