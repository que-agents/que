// Renderer test setup: jest-dom matchers, the fake bridge as window.que, and a
// clean slate after every test.
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { setChimePlayer } from '../sound'
import { fakeBridge } from './fake-bridge'

// Browser APIs jsdom lacks that xterm.js touches when a <Terminal> mounts. They
// only let the component mount; terminal content is never asserted in jsdom.
if (!window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false
    }) as MediaQueryList
}
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
}
// No canvas in jsdom: report "no context" quietly, as a GPU-less browser would.
HTMLCanvasElement.prototype.getContext = (() => null) as HTMLCanvasElement['getContext']

window.que = fakeBridge.api

// jsdom has no AudioContext: tests that care about the chime install their own player.
const silent = { play: () => {} }
setChimePlayer(silent)

afterEach(() => {
  cleanup()
  fakeBridge.reset()
  setChimePlayer(silent)
  localStorage.clear()
})
