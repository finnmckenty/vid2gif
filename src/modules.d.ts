declare module 'gifenc' {
  export type Palette = number[][]
  export interface QuantizeOptions {
    format?: 'rgb565' | 'rgb444' | 'rgba4444'
    oneBitAlpha?: boolean | number
    clearAlpha?: boolean
    clearAlphaThreshold?: number
    clearAlphaColor?: number
    useSqrt?: boolean
  }
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, opts?: QuantizeOptions): Palette
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette, format?: 'rgb565' | 'rgb444' | 'rgba4444'): Uint8Array
  export function nearestColorIndex(palette: Palette, pixel: number[]): number
  export interface WriteFrameOptions {
    palette?: Palette
    transparent?: boolean
    transparentIndex?: number
    delay?: number
    repeat?: number
    colorDepth?: number
    dispose?: number
    first?: boolean
  }
  export interface Encoder {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: WriteFrameOptions): void
    finish(): void
    bytes(): Uint8Array
    bytesView(): Uint8Array
    reset(): void
  }
  export function GIFEncoder(opts?: { initialCapacity?: number; auto?: boolean }): Encoder
  export default GIFEncoder
}

declare module 'gifsicle-wasm-browser' {
  interface RunOptions {
    input: { file: string | File | Blob | ArrayBuffer; name: string }[]
    command: string[]
    folder?: string[]
    isStrict?: boolean
  }
  const gifsicle: { run(opts: RunOptions): Promise<File[] | null> }
  export default gifsicle
}
