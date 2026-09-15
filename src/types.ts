export interface Frame {
  id: number
  /** Position in the source video, seconds */
  time: number
  /** Per-frame delay in 1/100 s, or null to use the global delay */
  delay: number | null
  skipped: boolean
  /** Small JPEG data URL for the frame list */
  thumb: string
}

export type DitherMode = 'none' | 'floyd' | 'ordered'
export type PaletteMode = 'global' | 'frame'

export interface EncodeOptions {
  colors: number
  dither: DitherMode
  palette: PaletteMode
  /** 0 = loop forever, -1 = play once, n = repeat n times */
  loop: number
}

export interface OptimizeOptions {
  /** gifsicle -O level, 0 = off */
  level: 0 | 1 | 2 | 3
  /** gifsicle --lossy value, 0 = off */
  lossy: number
}

export type WorkerIn =
  | { type: 'init'; width: number; height: number; options: EncodeOptions }
  | { type: 'frame'; rgba: ArrayBuffer; delayMs: number }
  | { type: 'encode' }

export type WorkerOut =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; gif: ArrayBuffer }
  | { type: 'error'; message: string }
