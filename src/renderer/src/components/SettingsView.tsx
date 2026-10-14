import { useEffect, useState } from 'react'
import type { QuietHoursConfig, UserConfig, Weekday } from '../../../preload/index.d'
import { currentWindow } from '../../../daemon/quiet-hours'
import { WEEKDAYS } from '../../../shared/types'
import { useQue, useStore } from '../store'
import Dialog from './Dialog'
import UnlockStatus from './UnlockStatus'

type DayMode = 'inherit' | 'custom' | 'none'

interface DayForm {
  mode: DayMode
  start: string
  end: string
}

interface Form {
  enabled: boolean
  start: string
  end: string
  days: Record<Weekday, DayForm>
  unlockMinutes: string
  chimeComplete: boolean
  chimeNeedsInput: boolean
  morningSummary: boolean
  concurrency: string
  maxTurns: string
  maxBudget: string
  permissionMode: string
  protectedBranches: string
}

/** Every permission mode except bypassPermissions, which only the config file can set. */
const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'dontAsk', 'auto'] as const

/** Monday first, as people read a week. */
const WEEK: Weekday[] = [...WEEKDAYS.slice(1), WEEKDAYS[0]]

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

function toForm(c: UserConfig): Form {
  const q = c.quietHours
  const days = Object.fromEntries(
    WEEKDAYS.map((d) => {
      const o = q.days[d]
      const day: DayForm =
        o === undefined
          ? { mode: 'inherit', start: q.default.start, end: q.default.end }
          : o === 'none'
            ? { mode: 'none', start: q.default.start, end: q.default.end }
            : { mode: 'custom', start: o.start, end: o.end }
      return [d, day]
    })
  ) as Record<Weekday, DayForm>
  return {
    enabled: q.enabled,
    start: q.default.start,
    end: q.default.end,
    days,
    unlockMinutes: String(q.unlockMinutes),
    chimeComplete: c.notifications.chimeOnComplete,
    chimeNeedsInput: c.notifications.chimeOnNeedsInput,
    morningSummary: c.notifications.morningSummary,
    concurrency: String(c.concurrency),
    maxTurns: String(c.maxTurns),
    maxBudget: String(c.maxBudgetUsd),
    permissionMode: c.defaultPermissionMode ?? '',
    protectedBranches: c.protectedBranches.join(', ')
  }
}

/** The form's problems, one line each; empty when it can be saved. */
function validate(f: Form): string[] {
  const errors: string[] = []
  const window = (label: string, start: string, end: string): void => {
    if (!HHMM.test(start) || !HHMM.test(end)) errors.push(`${label}: use 24-hour HH:MM times`)
    else if (start === end) errors.push(`${label}: start and end must differ`)
  }
  window('Quiet hours', f.start, f.end)
  for (const d of WEEK) {
    if (f.days[d].mode === 'custom') window(capital(d), f.days[d].start, f.days[d].end)
  }
  const positive = (label: string, v: string, int: boolean): void => {
    const n = Number(v)
    if (v.trim() === '' || !Number.isFinite(n) || n <= 0 || (int && !Number.isInteger(n))) {
      errors.push(`${label} must be a positive ${int ? 'whole number' : 'number'}`)
    }
  }
  positive('Unlock minutes', f.unlockMinutes, false)
  positive('Concurrency', f.concurrency, true)
  positive('Max turns', f.maxTurns, true)
  positive('Max budget', f.maxBudget, false)
  return errors
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function quietOf(f: Form): QuietHoursConfig {
  const days: QuietHoursConfig['days'] = {}
  for (const d of WEEKDAYS) {
    const day = f.days[d]
    if (day.mode === 'none') days[d] = 'none'
    else if (day.mode === 'custom') days[d] = { start: day.start, end: day.end }
  }
  return {
    enabled: f.enabled,
    default: { start: f.start, end: f.end },
    days,
    unlockMinutes: Number(f.unlockMinutes)
  }
}

/** The config.set patch (the file's snake_case keys); `null` removes an override. */
function patchOf(f: Form): Record<string, unknown> {
  const quiet: Record<string, unknown> = {
    enabled: f.enabled,
    default: [f.start, f.end],
    unlock_minutes: Number(f.unlockMinutes)
  }
  for (const d of WEEKDAYS) {
    const day = f.days[d]
    quiet[d] = day.mode === 'inherit' ? null : day.mode === 'none' ? 'none' : [day.start, day.end]
  }
  return {
    quiet_hours: quiet,
    notifications: {
      chime_on_complete: f.chimeComplete,
      chime_on_needs_input: f.chimeNeedsInput,
      morning_summary: f.morningSummary
    },
    concurrency: Number(f.concurrency),
    max_turns: Number(f.maxTurns),
    max_budget_usd: Number(f.maxBudget),
    default_permission_mode: f.permissionMode === '' ? null : f.permissionMode,
    protected_branches: f.protectedBranches
      .split(',')
      .map((b) => b.trim())
      .filter((b) => b !== '')
  }
}

/** Quiet hours, notifications and the queue's defaults, saved to the config file. */
export default function SettingsView(): React.JSX.Element {
  const store = useStore()
  const { config, quiet, connected } = useQue()
  const [form, setForm] = useState<Form | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [confirming, setConfirming] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (config && form === null) setForm(toForm(config.config))
  }, [config, form])

  if (!form || !config) {
    return (
      <section className="settings" data-testid="settings-view" aria-label="Settings">
        <p className="empty-note">Loading…</p>
      </section>
    )
  }

  const update = (patch: Partial<Form>): void => {
    setForm({ ...form, ...patch })
    setSaved(false)
  }
  const updateDay = (d: Weekday, patch: Partial<DayForm>): void =>
    update({ days: { ...form.days, [d]: { ...form.days[d], ...patch } } })

  const save = async (applyTonight: boolean): Promise<void> => {
    setConfirming(false)
    try {
      await store.saveConfig({ patch: patchOf(form), applyTonight })
      setErrors([])
      setSaved(true)
    } catch (err) {
      setErrors([err instanceof Error ? err.message : String(err)])
    }
  }

  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    const problems = validate(form)
    setErrors(problems)
    if (problems.length > 0) return
    // Tonight's window in progress would end sooner (or go away): ask first.
    if (quiet?.inQuietHours && quiet.windowEnd) {
      const next = currentWindow(Date.now(), quietOf(form))
      if (!next || next.end.getTime() < Date.parse(quiet.windowEnd)) {
        setConfirming(true)
        return
      }
    }
    void save(false)
  }

  return (
    <section className="settings" data-testid="settings-view" aria-labelledby="settings-title">
      <header className="topbar">
        <h1 className="title" id="settings-title">
          Settings
        </h1>
        <span className="cwd muted" data-testid="settings-path" title={config.path}>
          {config.path}
        </span>
        <UnlockStatus />
      </header>
      <form className="settings-body" onSubmit={submit} noValidate>
        <fieldset>
          <legend>Quiet hours</legend>
          <label className="check">
            <input
              type="checkbox"
              data-testid="settings-quiet-enabled"
              checked={form.enabled}
              onChange={(e) => update({ enabled: e.target.checked })}
            />
            Quiet hours on
          </label>
          <div className="row">
            <label>
              Start
              <input
                type="time"
                data-testid="settings-quiet-start"
                value={form.start}
                onChange={(e) => update({ start: e.target.value })}
              />
            </label>
            <label>
              End
              <input
                type="time"
                data-testid="settings-quiet-end"
                value={form.end}
                onChange={(e) => update({ end: e.target.value })}
              />
            </label>
            <label>
              Unlock minutes
              <input
                type="number"
                min="1"
                data-testid="settings-unlock-minutes"
                value={form.unlockMinutes}
                onChange={(e) => update({ unlockMinutes: e.target.value })}
              />
            </label>
          </div>
          <table className="days">
            <tbody>
              {WEEK.map((d) => {
                const day = form.days[d]
                return (
                  <tr key={d} data-testid={`settings-day-${d}`}>
                    <th scope="row">{capital(d)}</th>
                    <td>
                      <select
                        aria-label={`${capital(d)} quiet hours`}
                        data-testid={`settings-day-${d}-mode`}
                        value={day.mode}
                        onChange={(e) => updateDay(d, { mode: e.target.value as DayMode })}
                      >
                        <option value="inherit">Default</option>
                        <option value="custom">Custom</option>
                        <option value="none">None</option>
                      </select>
                    </td>
                    <td>
                      {day.mode === 'custom' && (
                        <span className="row">
                          <input
                            type="time"
                            aria-label={`${capital(d)} start`}
                            data-testid={`settings-day-${d}-start`}
                            value={day.start}
                            onChange={(e) => updateDay(d, { start: e.target.value })}
                          />
                          <input
                            type="time"
                            aria-label={`${capital(d)} end`}
                            data-testid={`settings-day-${d}-end`}
                            value={day.end}
                            onChange={(e) => updateDay(d, { end: e.target.value })}
                          />
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </fieldset>
        <fieldset>
          <legend>Notifications</legend>
          <label className="check">
            <input
              type="checkbox"
              data-testid="settings-chime-complete"
              checked={form.chimeComplete}
              onChange={(e) => update({ chimeComplete: e.target.checked })}
            />
            Chime when a task finishes (work hours)
          </label>
          <label className="check">
            <input
              type="checkbox"
              data-testid="settings-chime-needs-input"
              checked={form.chimeNeedsInput}
              onChange={(e) => update({ chimeNeedsInput: e.target.checked })}
            />
            Chime when a task needs input (work hours)
          </label>
          <label className="check">
            <input
              type="checkbox"
              data-testid="settings-morning-summary"
              checked={form.morningSummary}
              onChange={(e) => update({ morningSummary: e.target.checked })}
            />
            Morning summary when quiet hours end
          </label>
        </fieldset>
        <fieldset>
          <legend>Overnight tasks</legend>
          <div className="row">
            <label>
              Concurrency
              <input
                type="number"
                min="1"
                data-testid="settings-concurrency"
                value={form.concurrency}
                onChange={(e) => update({ concurrency: e.target.value })}
              />
            </label>
            <label>
              Max turns
              <input
                type="number"
                min="1"
                data-testid="settings-max-turns"
                value={form.maxTurns}
                onChange={(e) => update({ maxTurns: e.target.value })}
              />
            </label>
            <label>
              Max budget (USD)
              <input
                type="number"
                min="0.01"
                step="0.01"
                data-testid="settings-max-budget"
                value={form.maxBudget}
                onChange={(e) => update({ maxBudget: e.target.value })}
              />
            </label>
          </div>
          <label>
            Default permission mode
            <select
              data-testid="settings-permission-mode"
              value={form.permissionMode}
              onChange={(e) => update({ permissionMode: e.target.value })}
            >
              <option value="">Repo default</option>
              {PERMISSION_MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label>
            Protected branches
            <input
              data-testid="settings-protected-branches"
              value={form.protectedBranches}
              onChange={(e) => update({ protectedBranches: e.target.value })}
            />
          </label>
        </fieldset>
        {errors.length > 0 && (
          <ul className="form-error" role="alert" data-testid="settings-error">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        <div className="actions">
          {saved && (
            <span className="muted" role="status" data-testid="settings-saved">
              Saved
            </span>
          )}
          <button type="submit" data-testid="settings-save" disabled={!connected}>
            Save
          </button>
        </div>
      </form>
      {confirming && (
        <Dialog
          title="Apply tonight?"
          testId="settings-apply-tonight-confirm"
          onClose={() => setConfirming(false)}
        >
          <p className="hint">
            This ends tonight&apos;s quiet hours early. Apply it tonight, or save it for tomorrow?
          </p>
          <div className="dialog-actions">
            <button
              type="button"
              data-testid="settings-apply-tonight-no"
              onClick={() => void save(false)}
            >
              No, from tomorrow
            </button>
            <button
              type="button"
              data-testid="settings-apply-tonight-yes"
              onClick={() => void save(true)}
            >
              Yes, tonight
            </button>
          </div>
        </Dialog>
      )}
    </section>
  )
}
