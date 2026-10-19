// The words of the sidebar's Update control: its tooltip, and what the error line
// says when the update in place was refused.

/** The tooltip: the service runs the previous build, and updating it ends nothing. */
export const DAEMON_UPDATE_TITLE =
  'que was updated. The background service still runs the previous build. Update it in place; every terminal keeps running.'

/** The error line after an update in place was refused for `reason`: nothing changed, and how to force the new build. */
export function daemonUpdateRefusedText(reason: string): string {
  return `Could not update the background service in place: ${reason.trim().replace(/\.+$/, '')}. It keeps running the previous build with every terminal; to end them and start this build, run que daemon restart.`
}
