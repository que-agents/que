// Projects → workspaces with their status badges, the loose terminals entry,
// the report entry, the project context menu, and the new-workspace and
// remove-project dialogs.
import { expect, type Locator, type Page } from '@playwright/test'

export class SidebarPage {
  page: Page
  root: Locator
  resizer: Locator
  emptyState: Locator
  addProjectButton: Locator
  scratchButton: Locator
  reportButton: Locator
  newWorkspaceDialog: Locator
  newWorkspaceName: Locator
  newWorkspaceSlug: Locator
  newWorkspaceSubmit: Locator
  removeProjectDialog: Locator
  removeProjectSubmit: Locator
  project: (id: string) => Locator
  projectToggle: (id: string) => Locator
  projectMenuRemove: (id: string) => Locator
  projectAddWorkspace: (id: string) => Locator
  workspace: (id: string) => Locator
  workspaceOpen: (id: string) => Locator
  workspaceStatus: (id: string) => Locator
  workspacePr: (id: string) => Locator
  workspaceMenu: (id: string) => Locator

  constructor(page: Page) {
    this.page = page
    this.root = page.getByTestId('sidebar')
    this.resizer = page.getByTestId('sidebar-resizer')
    this.emptyState = page.getByTestId('sidebar-empty')
    this.addProjectButton = page.getByTestId('sidebar-add-project')
    this.scratchButton = page.getByTestId('sidebar-scratch')
    this.reportButton = page.getByTestId('sidebar-report')
    this.newWorkspaceDialog = page.getByTestId('dialog-new-workspace')
    this.newWorkspaceName = page.getByTestId('dialog-new-workspace-name')
    this.newWorkspaceSlug = page.getByTestId('dialog-new-workspace-slug')
    this.newWorkspaceSubmit = page.getByTestId('dialog-new-workspace-submit')
    this.removeProjectDialog = page.getByTestId('dialog-remove-project')
    this.removeProjectSubmit = page.getByTestId('dialog-remove-project-submit')
    this.project = (id: string) => page.getByTestId(`sidebar-project-${id}`)
    this.projectToggle = (id: string) => page.getByTestId(`sidebar-project-${id}-toggle`)
    this.projectMenuRemove = (id: string) => page.getByTestId(`sidebar-project-${id}-menu-remove`)
    this.projectAddWorkspace = (id: string) =>
      page.getByTestId(`sidebar-project-${id}-add-workspace`)
    this.workspace = (id: string) => page.getByTestId(`sidebar-workspace-${id}`)
    this.workspaceOpen = (id: string) => page.getByTestId(`sidebar-workspace-${id}-open`)
    this.workspaceStatus = (id: string) => page.getByTestId(`sidebar-workspace-${id}-status`)
    this.workspacePr = (id: string) => page.getByTestId(`sidebar-workspace-${id}-pr`)
    this.workspaceMenu = (id: string) => page.getByTestId(`sidebar-workspace-${id}-menu`)
  }

  async waitForLoad() {
    await this.root.waitFor({ state: 'visible' })
    await Promise.race([
      this.page
        .getByTestId(/^sidebar-project-/)
        .first()
        .waitFor({ state: 'visible' })
        .catch(() => {}),
      this.emptyState.waitFor({ state: 'visible' }).catch(() => {})
    ])
  }

  // Waits for a badge, naming the workspace and the last status seen on failure.
  async waitForWorkspaceStatus(id: string, status: string, timeout = 30_000) {
    const badge = this.workspaceStatus(id)
    await badge.waitFor({ state: 'visible', timeout })
    await expect(badge, `workspace ${id} never reached ${status}`).toHaveAttribute(
      'data-status',
      status,
      { timeout }
    )
  }
}
