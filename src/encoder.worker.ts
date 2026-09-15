import { GIFEncoder, quantize, applyPalette } from 'gifenc'
import type { Palette } from 'gifenc'
import { ditherFrame } from './dither'
import type { EncodeOptions, WorkerIn, WorkerOut } from './types'

interface Pending {
  rgba: Uint8Array
  delayMs: number
}

let width = 0
let height = 0
let options: EncodeOptions | null = null
const frames: Pending[] = []

const post = (msg: WorkerOut, transfer?: Transferable[]) =>
  (self as unknown as Worker).postMessage(msg, transfer ?? [])

/** Build one palette from a pixel sample spread evenly across all frames. */
function globalPalette(colors: number): Palette {
  const MAX_SAMPLE_PIXELS = 3_000_000
  const totalPixels = frames.length * width * height
  const stride = Math.max(1, Math.ceil(totalPixels / MAX_SAMPLE_PIXELS))
  const samplePixels = Math.ceil(totalPixels / stride)
  const sample = new Uint8Array(samplePixels * 4)
  let s = 0
  let k = 0
  for (const f of frames) {
    const d = f.rgba
    for (let p = 0; p < d.length; p += 4, k++) {
      if (k % stride !== 0) continue
      sample[s++] = d[p]
      sample[s++] = d[p + 1]
      sample[s++] = d[p + 2]
      sample[s++] = 255
    }
  }
  return quantize(sample.subarray(0, s), colors, { format: 'rgb565' })
}

function encode() {
  if (!options) throw new Error('Worker not initialised')
  if (frames.length === 0) throw new Error('No frames to encode')
  const gif = GIFEncoder()
  const shared = options.palette === 'global' ? globalPalette(options.colors) : null

  frames.forEach((f, i) => {
    const palette = shared ?? quantize(f.rgba, options!.colors, { format: 'rgb565' })
    const index =
      options!.dither === 'none'
        ? applyPalette(f.rgba, palette, 'rgb565')
        : ditherFrame(f.rgba, width, height, palette, options!.dither)
    gif.writeFrame(index, width, height, {
      palette,
      delay: f.delayMs,
      repeat: options!.loop,
    })
    // Free the frame as soon as it is written.
    ;(f as Partial<Pending>).rgba = undefined
    post({ type: 'progress', done: i + 1, total: frames.length })
  })
  gif.finish()
  const bytes = gif.bytes()
  const buffer = bytes.buffer as ArrayBuffer
  post({ type: 'done', gif: buffer }, [buffer])
}

self.onmessage = (e: MessageEvent<WorkerIn>) => {
  const msg = e.data
  try {
    if (msg.type === 'init') {
      width = msg.width
      height = msg.height
      options = msg.options
      frames.length = 0
    } else if (msg.type === 'frame') {
      frames.push({ rgba: new Uint8Array(msg.rgba), delayMs: msg.delayMs })
    } else if (msg.type === 'encode') {
      encode()
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
