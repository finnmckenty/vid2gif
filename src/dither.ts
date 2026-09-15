import type { Palette } from 'gifenc'
import type { DitherMode } from './types'

/** Nearest-palette-index lookup with an rgb565 bucket cache (same trick gifenc uses). */
export function makeIndexer(palette: Palette) {
  const cache = new Int16Array(65536).fill(-1)
  const n = palette.length
  const pr = new Int32Array(n)
  const pg = new Int32Array(n)
  const pb = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    pr[i] = palette[i][0]
    pg[i] = palette[i][1]
    pb[i] = palette[i][2]
  }
  return function nearest(r: number, g: number, b: number): number {
    const key = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)
    const hit = cache[key]
    if (hit >= 0) return hit
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < n; i++) {
      const dr = r - pr[i]
      const dg = g - pg[i]
      const db = b - pb[i]
      const d = dr * dr + dg * dg + db * db
      if (d < bestD) {
        bestD = d
        best = i
        if (d === 0) break
      }
    }
    cache[key] = best
    return best
  }
}

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
]

function clamp255(v: number) {
  return v < 0 ? 0 : v > 255 ? 255 : v
}

/** Map RGBA pixels to palette indices with the chosen dithering. */
export function ditherFrame(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  palette: Palette,
  mode: DitherMode,
): Uint8Array {
  const nearest = makeIndexer(palette)
  const out = new Uint8Array(width * height)

  if (mode === 'ordered') {
    // Threshold spread scales with palette size: fewer colors, stronger pattern.
    const spread = Math.max(6, (255 / Math.cbrt(palette.length)) * 0.6)
    let p = 0
    for (let y = 0; y < height; y++) {
      const row = BAYER4[y & 3]
      for (let x = 0; x < width; x++, p++) {
        const t = (row[x & 3] / 16 - 0.5) * spread
        const i = p * 4
        out[p] = nearest(
          clamp255(rgba[i] + t) | 0,
          clamp255(rgba[i + 1] + t) | 0,
          clamp255(rgba[i + 2] + t) | 0,
        )
      }
    }
    return out
  }

  // Floyd–Steinberg error diffusion. Errors live in a float buffer for the
  // current and next row only.
  const w3 = width * 3
  let cur = new Float32Array(w3)
  let next = new Float32Array(w3)
  let p = 0
  for (let y = 0; y < height; y++) {
    next.fill(0)
    for (let x = 0; x < width; x++, p++) {
      const i = p * 4
      const j = x * 3
      const r = clamp255(rgba[i] + cur[j])
      const g = clamp255(rgba[i + 1] + cur[j + 1])
      const b = clamp255(rgba[i + 2] + cur[j + 2])
      const idx = nearest(r | 0, g | 0, b | 0)
      out[p] = idx
      const c = palette[idx]
      const er = r - c[0]
      const eg = g - c[1]
      const eb = b - c[2]
      if (x + 1 < width) {
        cur[j + 3] += er * (7 / 16)
        cur[j + 4] += eg * (7 / 16)
        cur[j + 5] += eb * (7 / 16)
        next[j + 3] += er * (1 / 16)
        next[j + 4] += eg * (1 / 16)
        next[j + 5] += eb * (1 / 16)
      }
      if (x > 0) {
        next[j - 3] += er * (3 / 16)
        next[j - 2] += eg * (3 / 16)
        next[j - 1] += eb * (3 / 16)
      }
      next[j] += er * (5 / 16)
      next[j + 1] += eg * (5 / 16)
      next[j + 2] += eb * (5 / 16)
    }
    const tmp = cur
    cur = next
    next = tmp
  }
  return out
}
