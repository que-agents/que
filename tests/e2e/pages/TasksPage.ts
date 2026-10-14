// The Tonight panel: tasks keyed by task id, the queue control, and the
// add-task dialog.
import type { Locator, Page } from '@playwright/test'

export class TasksPage {
  page: Page
  root: Locator
  addButton: Locator
  queueControl: Locator
  queueRun: Locator
  queueClose: Locator
  addDialog: Locator
  addTarget: Locator
  addBrief: Locator
  addSubmit: Locator
  task: (id: string) => Locator
  taskState: (id: string) => Locator
  taskStop: (id: string) => Locator
  taskPr: (id: string) => Locator

  constructor(page: Page) {
    this.page = page
    this.root = page.getByTestId('tasks-panel')
    this.addButton = page.getByTestId('tasks-add')
    this.queueControl = page.getByTestId('queue-control')
    this.queueRun = page.getByTestId('queue-run')
    this.queueClose = page.getByTestId('queue-close')
    this.addDialog = page.getByTestId('dialog-add-task')
    this.addTarget = page.getByTestId('dialog-add-task-target')
    this.addBrief = page.getByTestId('dialog-add-task-brief')
    this.addSubmit = page.getByTestId('dialog-add-task-submit')
    this.task = (id: string) => page.getByTestId(`task-${id}`)
    this.taskState = (id: string) => page.getByTestId(`task-${id}-state`)
    this.taskStop = (id: string) => page.getByTestId(`task-${id}-stop`)
    this.taskPr = (id: string) => page.getByTestId(`task-${id}-pr`)
  }

  async waitForLoad() {
    await this.root.waitFor({ state: 'visible' })
    await this.queueControl.waitFor({ state: 'visible' })
  }
}
