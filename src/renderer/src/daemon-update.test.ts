import { describe, expect, it } from 'vitest'
import { daemonUpdateRefusedText } from './daemon-update'

const LEAD = 'Could not update the background service in place:'

const TAIL =
  'It keeps running the previous build with every terminal; to end them and start this build, run que daemon restart.'

describe('daemonUpdateRefusedText', () => {
  it('names the reason, that nothing changed, and the way to force the new build', () => {
    expect(daemonUpdateRefusedText('the new daemon exited (code 3)')).toBe(
      `${LEAD} the new daemon exited (code 3). ${TAIL}`
    )
  })

  it('ends the reason with one full stop when it brings its own', () => {
    expect(daemonUpdateRefusedText('the running service is too old to update in place.')).toBe(
      `${LEAD} the running service is too old to update in place. ${TAIL}`
    )
  })
})
