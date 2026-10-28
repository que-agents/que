// Encodes the quiet-mode demo's keyframes (tests/demo/quiet-mode.demo.ts, saved under
// test-results/demo/) into docs/images/quiet-mode.gif: each frame scaled to WIDTH, the
// board's small window centred on a plain backdrop, each held for its own delay, looping.
import { mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEMO = join(ROOT, 'test-results', 'demo')
const OUT = join(ROOT, 'docs', 'images', 'quiet-mode.gif')

/** The GIF's width; the main window (1100×720) fills the frame. */
const WIDTH = 920
const HEIGHT = Math.round((WIDTH * 720) / 1100)

/** The main window's width in CSS px: the board (600×400) is scaled by the same factor. */
const SCALE = WIDTH / 1100

/** Behind the board: a neutral grey a step lighter than the board's own --bg-side. */
const BACKDROP = { r: 38, g: 38, b: 40, alpha: 1 }

const frames = JSON.parse(readFileSync(join(DEMO, 'frames.json'), 'utf8'))

/** One keyframe as a WIDTH×HEIGHT PNG. */
async function compose(frame) {
  const png = join(DEMO, 'frames', frame.file)

  if (frame.window === 'main') {
    return sharp(png).resize(WIDTH, HEIGHT, { kernel: 'lanczos3' }).png().toBuffer()
  }

  const w = Math.round(600 * SCALE)
  const h = Math.round(400 * SCALE)

  // A hairline edge, so the frameless board reads as a window on the backdrop.
  const board = await sharp(png)
    .resize(w, h, { kernel: 'lanczos3' })
    .extend({ top: 1, bottom: 1, left: 1, right: 1, background: '#3a3a3c' })
    .png()
    .toBuffer()

  return sharp({ create: { width: WIDTH, height: HEIGHT, channels: 4, background: BACKDROP } })
    .composite([
      {
        input: board,
        left: Math.round((WIDTH - w) / 2) - 1,
        top: Math.round((HEIGHT - h) / 2) - 1
      }
    ])
    .png()
    .toBuffer()
}

const composed = []

for (const f of frames) composed.push(await compose(f))

mkdirSync(dirname(OUT), { recursive: true })

await sharp(composed, { join: { animated: true } })
  .gif({
    delay: frames.map((f) => f.delay),
    loop: 0,
    effort: 10,
    // No dithering: flat UI greys and terminal text stay crisp, and frames compress better.
    dither: 0,
    interFrameMaxError: 4,
    keepDuplicateFrames: true
  })
  .toFile(OUT)

const total = frames.reduce((sum, f) => sum + f.delay, 0)
const mb = (statSync(OUT).size / 1024 / 1024).toFixed(2)

console.log(
  `${OUT}: ${WIDTH}x${HEIGHT}, ${frames.length} frames, ${(total / 1000).toFixed(1)} s, ${mb} MB`
)
