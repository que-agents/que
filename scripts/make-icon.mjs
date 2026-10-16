// Draws que's app icon and writes build/icon.png (1024×1024) and build/icon.icns.
//
// Route: no image libraries and no new dependencies. The 1024×1024 RGBA image
// is computed here pixel by pixel from signed distance functions (a dark
// rounded square on the standard macOS icon grid, with a light lowercase "q":
// a ring plus a stem), anti-aliased by distance, and encoded as PNG with
// node:zlib (deflate + crc32). macOS's own `sips` then scales it to every size
// in an .iconset, and `iconutil` packs that into build/icon.icns.
//
//   node scripts/make-icon.mjs
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SIZE = 1024

// The macOS grid: an 824 px body centred in 1024, corner radius ~185.
const BODY = 824
const RADIUS = 185
const BG_TOP = [0x2a, 0x2d, 0x34]
const BG_BOTTOM = [0x16, 0x18, 0x1d]
const INK = [0xe8, 0xea, 0xee]
const ACCENT = [0x5c, 0xd6, 0x8f]

/** Distance to a rounded square centred at c (negative inside). */
function roundedSquare(x, y, c, half, r) {
  const qx = Math.abs(x - c) - (half - r)
  const qy = Math.abs(y - c) - (half - r)
  const ox = Math.max(qx, 0)
  const oy = Math.max(qy, 0)

  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r
}

/** Distance to a ring (circle outline) of radius r and stroke width w. */
function ring(x, y, cx, cy, r, w) {
  return Math.abs(Math.hypot(x - cx, y - cy) - r) - w / 2
}

/** Distance to a vertical capsule from (x0, y0) to (x0, y1), width w. */
function stem(x, y, x0, y0, y1, w) {
  const cy = Math.min(Math.max(y, y0), y1)

  return Math.hypot(x - x0, y - cy) - w / 2
}

const coverage = (d) => Math.min(1, Math.max(0, 0.5 - d))
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)

const c = SIZE / 2
const stride = SIZE * 4 + 1
const raw = Buffer.alloc(stride * SIZE)

for (let y = 0; y < SIZE; y++) {
  raw[y * stride] = 0 // PNG filter: none

  for (let x = 0; x < SIZE; x++) {
    const body = coverage(roundedSquare(x + 0.5, y + 0.5, c, BODY / 2, RADIUS))
    let rgb = mix(BG_TOP, BG_BOTTOM, (y - (c - BODY / 2)) / BODY)
    // The "q": a ring and a stem down its right side, slightly left of centre.
    const qx = c - 30
    const qy = c - 40

    const glyph = Math.max(
      coverage(ring(x + 0.5, y + 0.5, qx, qy, 150, 64)),
      coverage(stem(x + 0.5, y + 0.5, qx + 150, qy - 120, qy + 300, 64))
    )

    rgb = mix(rgb, INK, glyph)
    // A small status dot: the one thing quiet mode shows.
    const dot = coverage(Math.hypot(x + 0.5 - (c + 230), y + 0.5 - (c + 230)) - 46)
    rgb = mix(rgb, ACCENT, dot)
    const o = y * stride + 1 + x * 4
    raw[o] = Math.round(rgb[0])
    raw[o + 1] = Math.round(rgb[1])
    raw[o + 2] = Math.round(rgb[2])
    raw[o + 3] = Math.round(body * 255)
  }
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(zlib.crc32(body))

  return Buffer.concat([len, body, crc])
}

const ihdr = Buffer.alloc(13)

ihdr.writeUInt32BE(SIZE, 0)

ihdr.writeUInt32BE(SIZE, 4)

ihdr[8] = 8 // bit depth

ihdr[9] = 6 // RGBA

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])

const buildDir = join(root, 'build')

mkdirSync(buildDir, { recursive: true })

const pngPath = join(buildDir, 'icon.png')

writeFileSync(pngPath, png)

// The standard .iconset layout: each size at 1x and 2x.
const tmp = mkdtempSync(join(os.tmpdir(), 'que-icon-'))
const iconset = join(tmp, 'que.iconset')

mkdirSync(iconset)

for (const s of [16, 32, 128, 256, 512]) {
  for (const [scale, suffix] of [
    [1, ''],
    [2, '@2x']
  ]) {
    const px = String(s * scale)
    const out = join(iconset, `icon_${s}x${s}${suffix}.png`)
    execFileSync('sips', ['-z', px, px, pngPath, '--out', out], { stdio: 'ignore' })
  }
}

execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(buildDir, 'icon.icns')])

rmSync(tmp, { recursive: true, force: true })

console.log(`wrote ${pngPath} and ${join(buildDir, 'icon.icns')}`)
