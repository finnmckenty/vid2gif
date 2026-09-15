import gifsicle from 'gifsicle-wasm-browser'
import type { OptimizeOptions } from './types'

/** Run gifsicle (WebAssembly) over an encoded GIF, ezgif-style. */
export async function optimizeGif(bytes: Uint8Array, opts: OptimizeOptions): Promise<Uint8Array> {
  const flags: string[] = []
  if (opts.level > 0) flags.push(`-O${opts.level}`)
  if (opts.lossy > 0) flags.push(`--lossy=${Math.round(opts.lossy)}`)
  if (flags.length === 0) return bytes

  const out = await gifsicle.run({
    input: [{ file: new Blob([bytes as BlobPart], { type: 'image/gif' }), name: 'in.gif' }],
    command: [`${flags.join(' ')} in.gif -o /out/out.gif`],
  })
  if (!out || out.length === 0) throw new Error('gifsicle produced no output')
  return new Uint8Array(await out[0].arrayBuffer())
}
