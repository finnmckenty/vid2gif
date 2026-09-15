import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Film,
  Layers,
  Loader2,
  MoveHorizontal,
  Pause,
  Play,
  Plus,
  Rewind,
  FastForward,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import type { DitherMode, Frame, PaletteMode, WorkerOut } from './types'
import { drawFrame, estimateFps, formatBytes, formatTime, seekTo, thumbnail, waitLoaded } from './video'
import { optimizeGif } from './optimize'
import Timeline from './Timeline'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardAction } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

interface VideoMeta {
  duration: number
  width: number
  height: number
  name: string
}

interface Progress {
  phase: 'capture' | 'encode' | 'optimize'
  done: number
  total: number
}

interface Result {
  url: string
  size: number
  rawSize: number
  width: number
  height: number
  frames: number
  durationMs: number
}

const FILMSTRIP_COUNT = 16
const MAX_OUTPUT_PIXELS = 4096 * 4096

let nextId = 1

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

function isTypingTarget(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

/** Insert a frame keeping the list ordered by video time. */
function insertSorted(list: Frame[], frame: Frame): Frame[] {
  const idx = list.findIndex((f) => f.time > frame.time)
  const out = list.slice()
  out.splice(idx === -1 ? list.length : idx, 0, frame)
  return out
}

function hasFrameAt(list: Frame[], time: number, tolerance: number) {
  return list.some((f) => Math.abs(f.time - time) < tolerance)
}

/** Icon button with a tooltip. */
function IconButton({
  label,
  children,
  className,
  ...props
}: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline" size="icon-sm" aria-label={label} className={className} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** Labelled row used throughout the settings sidebar. */
function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Frame card                                                          */
/* ------------------------------------------------------------------ */

interface FrameCardProps {
  frame: Frame
  index: number
  globalDelay: number
  selected: boolean
  onSeek: (time: number) => void
  onSelect: (id: number) => void
  onToggleSkip: (id: number) => void
  onCopy: (id: number) => void
  onRemove: (id: number) => void
  onDelay: (id: number, delay: number | null) => void
}

const FrameCard = memo(function FrameCard({
  frame,
  index,
  globalDelay,
  selected,
  onSeek,
  onSelect,
  onToggleSkip,
  onCopy,
  onRemove,
  onDelay,
}: FrameCardProps) {
  return (
    <div
      className={cn(
        'group relative flex flex-col gap-2 rounded-xl border bg-card/60 p-2 transition-colors',
        selected ? 'border-primary/70 ring-2 ring-primary/30' : 'border-border hover:border-white/20',
        frame.skipped && 'opacity-50',
      )}
    >
      <button
        type="button"
        className="relative aspect-video w-full overflow-hidden rounded-lg bg-black/60 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title="Jump to this frame (then drag its dot on the timeline to retime it)"
        onClick={() => {
          onSelect(frame.id)
          onSeek(frame.time)
        }}
      >
        <img src={frame.thumb} alt={`Frame ${index + 1}`} draggable={false} className="size-full object-contain" />
        <span className="absolute top-1.5 left-1.5 rounded-md bg-black/70 px-1.5 py-0.5 font-mono text-[11px] leading-none text-white/90">
          {index + 1}
        </span>
        <span className="absolute right-1.5 bottom-1.5 rounded-md bg-black/70 px-1.5 py-0.5 font-mono text-[11px] leading-none text-white/90 tabular">
          {formatTime(frame.time)}
        </span>
        {frame.skipped && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-xs font-semibold tracking-wider text-white uppercase">
            skipped
          </span>
        )}
      </button>
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="relative min-w-[4.5rem] flex-1">
          <Input
            type="number"
            min={0}
            max={65535}
            className="h-7 pr-7 font-mono text-xs [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
            value={frame.delay ?? ''}
            placeholder={String(globalDelay)}
            title="Delay for this frame (1/100 s). Empty = global delay."
            onChange={(e) => onDelay(frame.id, e.target.value === '' ? null : Number(e.target.value))}
          />
          <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[10px] text-muted-foreground">cs</span>
        </div>
        <ButtonGroup>
          <IconButton label={frame.skipped ? 'Enable frame' : 'Skip frame'} onClick={() => onToggleSkip(frame.id)}>
            {frame.skipped ? <Eye /> : <EyeOff />}
          </IconButton>
          <IconButton label="Duplicate frame" onClick={() => onCopy(frame.id)}>
            <Copy />
          </IconButton>
          <IconButton label="Remove frame" className="hover:text-destructive" onClick={() => onRemove(frame.id)}>
            <Trash2 />
          </IconButton>
        </ButtonGroup>
      </div>
    </div>
  )
})

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

export default function App() {
  // Source video
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [meta, setMeta] = useState<VideoMeta | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [fps, setFps] = useState(30)
  const [fpsDetected, setFpsDetected] = useState(false)
  const [filmstrip, setFilmstrip] = useState<{ time: number; url: string }[]>([])
  const [dragOver, setDragOver] = useState(false)

  // Player
  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)

  // Frames
  const [frames, setFrames] = useState<Frame[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Range tools (1-based, inclusive)
  const [rangeFrom, setRangeFrom] = useState(1)
  const [rangeTo, setRangeTo] = useState(1)
  const [everyN, setEveryN] = useState(2)
  const [rangeDelay, setRangeDelay] = useState(10)

  // Bulk extraction
  const [exFrom, setExFrom] = useState(0)
  const [exTo, setExTo] = useState(0)
  const [exFps, setExFps] = useState(10)
  const [extracting, setExtracting] = useState<Progress | null>(null)

  // GIF options
  const [delay, setDelay] = useState(10)
  const [loop, setLoop] = useState<string>('')
  const [outWidth, setOutWidth] = useState(0)
  const [outHeight, setOutHeight] = useState(0)
  const [keepAspect, setKeepAspect] = useState(true)
  const [colors, setColors] = useState(256)
  const [dither, setDither] = useState<DitherMode>('none')
  const [paletteMode, setPaletteMode] = useState<PaletteMode>('global')
  const [optLevel, setOptLevel] = useState<0 | 1 | 2 | 3>(2)
  const [lossy, setLossy] = useState(0)

  // Build
  const [progress, setProgress] = useState<Progress | null>(null)
  const [buildError, setBuildError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  /** Hidden video used for thumbnails, fps detection and the final build. */
  const workVideoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const workLock = useRef<Promise<unknown>>(Promise.resolve())
  const rafRef = useRef(0)
  const pendingName = useRef('video')

  const frameStep = 1 / Math.max(1, fps)

  /** Run a task with exclusive access to the hidden work video. */
  const withWorkVideo = useCallback(<T,>(task: (v: HTMLVideoElement) => Promise<T>): Promise<T> => {
    const run = async () => {
      const v = workVideoRef.current
      if (!v) throw new Error('Work video not mounted')
      await waitLoaded(v)
      return task(v)
    }
    const p = workLock.current.then(run, run)
    workLock.current = p.catch(() => undefined)
    return p
  }, [])

  const showNotice = useCallback((msg: string) => {
    setNotice(msg)
    window.setTimeout(() => setNotice((cur) => (cur === msg ? null : cur)), 2500)
  }, [])

  /* ---------------------------- loading ---------------------------- */

  const loadFile = useCallback((file: File) => {
    setLoadError(null)
    setResult(null)
    setBuildError(null)
    setFrames([])
    setSelectedId(null)
    setFilmstrip([])
    setMeta(null)
    setFpsDetected(false)
    setCurrentTime(0)
    setPlaying(false)
    setVideoUrl((old) => {
      if (old) URL.revokeObjectURL(old)
      return URL.createObjectURL(file)
    })
    // Name is stored once metadata arrives.
    pendingName.current = file.name
  }, [])

  const onFileInput = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) loadFile(f)
    e.target.value = ''
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) loadFile(f)
  }

  const onLoadedMetadata = () => {
    const v = videoRef.current
    if (!v) return
    const m: VideoMeta = {
      duration: v.duration,
      width: v.videoWidth,
      height: v.videoHeight,
      name: pendingName.current,
    }
    setMeta(m)
    setExFrom(0)
    setExTo(Math.min(m.duration, 3))
    // Default output size: original, capped at 600px wide.
    const w = Math.min(m.width, 600)
    setOutWidth(w)
    setOutHeight(Math.round((m.height * w) / m.width))
  }

  const onVideoError = () => {
    setLoadError(
      'Your browser could not decode this video. Try MP4 (H.264), WebM, or MOV; convert other formats first.',
    )
  }

  // After the work video is ready: detect fps and build the filmstrip.
  useEffect(() => {
    if (!meta || !videoUrl) return
    let cancelled = false
    withWorkVideo(async (v) => {
      const detected = await estimateFps(v)
      if (cancelled) return
      if (detected) {
        setFps(detected)
        setFpsDetected(true)
      }
      const canvas = canvasRef.current!
      const thumbs: { time: number; url: string }[] = []
      for (let i = 0; i < FILMSTRIP_COUNT; i++) {
        if (cancelled) return
        const t = ((i + 0.5) / FILMSTRIP_COUNT) * meta.duration
        await seekTo(v, t)
        thumbs.push({ time: t, url: thumbnail(v, canvas, 120) })
        setFilmstrip(thumbs.slice())
      }
    }).catch((err) => console.error(err))
    return () => {
      cancelled = true
    }
  }, [meta, videoUrl, withWorkVideo])

  /* ---------------------------- player ----------------------------- */

  // Smooth time readout while playing.
  useEffect(() => {
    if (!playing) return
    const tick = () => {
      const v = videoRef.current
      if (v) setCurrentTime(v.currentTime)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [playing])

  const seekPlayer = useCallback(async (t: number) => {
    const v = videoRef.current
    if (!v || !isFinite(v.duration)) return
    v.pause()
    const target = clamp(t, 0, v.duration)
    await seekTo(v, target)
    setCurrentTime(v.currentTime)
  }, [])

  const stepFrames = useCallback(
    (n: number) => {
      const v = videoRef.current
      if (!v) return
      // Land in the middle of the target frame so repeated steps never straddle a boundary.
      const base = Math.floor(v.currentTime / frameStep + 1e-6)
      seekPlayer((base + n + 0.5) * frameStep)
    },
    [frameStep, seekPlayer],
  )

  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) v.play().catch(() => undefined)
    else v.pause()
  }, [])

  /* ---------------------------- frames ----------------------------- */

  const addCurrentFrame = useCallback(() => {
    const v = videoRef.current
    const canvas = canvasRef.current
    if (!v || !canvas || !meta) return
    v.pause()
    const time = v.currentTime
    setFrames((list) => {
      if (hasFrameAt(list, time, frameStep * 0.5)) {
        showNotice('That frame is already in the list (use "copy" to repeat it).')
        return list
      }
      const frame: Frame = {
        id: nextId++,
        time,
        delay: null,
        skipped: false,
        thumb: thumbnail(v, canvas, 200),
      }
      return insertSorted(list, frame)
    })
  }, [meta, frameStep, showNotice])

  const extractRange = useCallback(async () => {
    if (!meta) return
    const from = clamp(Math.min(exFrom, exTo), 0, meta.duration)
    const to = clamp(Math.max(exFrom, exTo), 0, meta.duration)
    const step = 1 / Math.max(0.01, exFps)
    const times: number[] = []
    for (let t = from; t <= to + 1e-6; t += step) times.push(Math.min(t, meta.duration))
    if (times.length > 2000) {
      setBuildError(`That range would add ${times.length} frames. Lower the FPS or shorten the range.`)
      return
    }
    setBuildError(null)
    setExtracting({ phase: 'capture', done: 0, total: times.length })
    try {
      await withWorkVideo(async (v) => {
        const canvas = canvasRef.current!
        for (let i = 0; i < times.length; i++) {
          const time = times[i]
          await seekTo(v, time)
          const thumb = thumbnail(v, canvas, 200)
          setFrames((list) => {
            if (hasFrameAt(list, time, frameStep * 0.5)) return list
            return insertSorted(list, { id: nextId++, time, delay: null, skipped: false, thumb })
          })
          setExtracting({ phase: 'capture', done: i + 1, total: times.length })
        }
      })
    } finally {
      setExtracting(null)
    }
  }, [meta, exFrom, exTo, exFps, frameStep, withWorkVideo])

  const toggleSkip = useCallback((id: number) => {
    setFrames((list) => list.map((f) => (f.id === id ? { ...f, skipped: !f.skipped } : f)))
  }, [])

  const copyFrame = useCallback((id: number) => {
    setFrames((list) => {
      const i = list.findIndex((f) => f.id === id)
      if (i === -1) return list
      const out = list.slice()
      out.splice(i + 1, 0, { ...list[i], id: nextId++ })
      return out
    })
  }, [])

  const removeFrame = useCallback((id: number) => {
    setFrames((list) => list.filter((f) => f.id !== id))
    setSelectedId((cur) => (cur === id ? null : cur))
  }, [])

  /**
   * Retime a frame. While dragging only the time changes (so the card stays
   * put); on release the list is re-sorted and the thumbnail regenerated.
   */
  const moveFrame = useCallback(
    (id: number, time: number, final: boolean) => {
      setFrames((list) => {
        const i = list.findIndex((f) => f.id === id)
        if (i === -1) return list
        const updated = { ...list[i], time }
        if (!final) {
          const out = list.slice()
          out[i] = updated
          return out
        }
        return insertSorted(
          list.filter((f) => f.id !== id),
          updated,
        )
      })
      if (!final) return
      withWorkVideo(async (v) => {
        await seekTo(v, time)
        const thumb = thumbnail(v, canvasRef.current!, 200)
        setFrames((list) => list.map((f) => (f.id === id ? { ...f, thumb } : f)))
      }).catch((err) => console.error(err))
    },
    [withWorkVideo],
  )

  const selectedFrame = selectedId === null ? null : (frames.find((f) => f.id === selectedId) ?? null)
  const selectedIndex = selectedFrame ? frames.indexOf(selectedFrame) : -1

  /** Move the selected frame to the playhead (same as dragging its dot there). */
  const moveSelectedHere = useCallback(() => {
    const v = videoRef.current
    if (!v || selectedId === null) return
    v.pause()
    moveFrame(selectedId, v.currentTime, true)
  }, [selectedId, moveFrame])

  const setFrameDelay = useCallback((id: number, d: number | null) => {
    setFrames((list) => list.map((f) => (f.id === id ? { ...f, delay: d } : f)))
  }, [])

  /** Apply a change to every frame whose 1-based index is in [from, to]. */
  const applyRange = (fn: (f: Frame, i: number) => Frame) => {
    const lo = Math.max(1, Math.min(rangeFrom, rangeTo))
    const hi = Math.max(rangeFrom, rangeTo)
    setFrames((list) => list.map((f, i) => (i + 1 >= lo && i + 1 <= hi ? fn(f, i) : f)))
  }

  const applyEveryNth = (skipped: boolean) => {
    const n = Math.max(1, Math.floor(everyN))
    setFrames((list) => list.map((f, i) => ((i + 1) % n === 0 ? { ...f, skipped } : f)))
  }

  const changeGlobalDelay = (d: number) => {
    setDelay(d)
    // Like ezgif: changing the global delay resets every per-frame delay.
    setFrames((list) => list.map((f) => (f.delay === null ? f : { ...f, delay: null })))
  }

  // Keep range inputs in bounds as the list grows.
  useEffect(() => {
    setRangeTo((t) => (frames.length === 0 ? 1 : Math.min(Math.max(t, 1), frames.length)))
  }, [frames.length])

  /* --------------------------- shortcuts --------------------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!meta || isTypingTarget(e.target)) return
      if (e.key === ' ') {
        e.preventDefault()
        togglePlay()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        stepFrames(e.shiftKey ? -10 : -1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        stepFrames(e.shiftKey ? 10 : 1)
      } else if (e.key === 'a' || e.key === 'A' || e.key === 'Enter') {
        e.preventDefault()
        addCurrentFrame()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [meta, togglePlay, stepFrames, addCurrentFrame])

  /* ---------------------------- sizing ----------------------------- */

  const setWidth = (w: number) => {
    setOutWidth(w)
    if (keepAspect && meta && w > 0) setOutHeight(Math.max(1, Math.round((meta.height * w) / meta.width)))
  }
  const setHeight = (h: number) => {
    setOutHeight(h)
    if (keepAspect && meta && h > 0) setOutWidth(Math.max(1, Math.round((meta.width * h) / meta.height)))
  }

  /* ----------------------------- build ----------------------------- */

  const activeFrames = useMemo(() => frames.filter((f) => !f.skipped), [frames])
  const totalDurationMs = useMemo(
    () => activeFrames.reduce((sum, f) => sum + (f.delay ?? delay) * 10, 0),
    [activeFrames, delay],
  )

  const buildGif = async () => {
    if (!meta || activeFrames.length === 0) return
    const w = Math.max(1, Math.floor(outWidth))
    const h = Math.max(1, Math.floor(outHeight))
    if (w * h > MAX_OUTPUT_PIXELS) {
      setBuildError('Output size is too large. Reduce the width or height.')
      return
    }
    setBuildError(null)
    setResult((old) => {
      if (old) URL.revokeObjectURL(old.url)
      return null
    })
    setProgress({ phase: 'capture', done: 0, total: activeFrames.length })

    const worker = new Worker(new URL('./encoder.worker.ts', import.meta.url), { type: 'module' })
    try {
      const encoded = new Promise<ArrayBuffer>((resolve, reject) => {
        worker.onmessage = (e: MessageEvent<WorkerOut>) => {
          const m = e.data
          if (m.type === 'progress') setProgress({ phase: 'encode', done: m.done, total: m.total })
          else if (m.type === 'done') resolve(m.gif)
          else if (m.type === 'error') reject(new Error(m.message))
        }
        worker.onerror = (e) => reject(new Error(e.message || 'Encoder worker crashed'))
      })

      worker.postMessage({
        type: 'init',
        width: w,
        height: h,
        options: {
          colors: clamp(Math.round(colors), 2, 256),
          dither,
          palette: paletteMode,
          loop: loop.trim() === '' ? 0 : Math.max(-1, Math.round(Number(loop))),
        },
      })

      await withWorkVideo(async (v) => {
        const canvas = canvasRef.current!
        for (let i = 0; i < activeFrames.length; i++) {
          const f = activeFrames[i]
          await seekTo(v, f.time)
          const ctx = drawFrame(v, canvas, w, h)
          const img = ctx.getImageData(0, 0, w, h)
          worker.postMessage({ type: 'frame', rgba: img.data.buffer, delayMs: (f.delay ?? delay) * 10 }, [
            img.data.buffer,
          ])
          setProgress({ phase: 'capture', done: i + 1, total: activeFrames.length })
        }
      })

      setProgress({ phase: 'encode', done: 0, total: activeFrames.length })
      worker.postMessage({ type: 'encode' })
      const raw = new Uint8Array(await encoded)

      let final: Uint8Array = raw
      if (optLevel > 0 || lossy > 0) {
        setProgress({ phase: 'optimize', done: 0, total: 1 })
        final = await optimizeGif(raw, { level: optLevel, lossy })
      }

      const blob = new Blob([final as BlobPart], { type: 'image/gif' })
      setResult({
        url: URL.createObjectURL(blob),
        size: blob.size,
        rawSize: raw.byteLength,
        width: w,
        height: h,
        frames: activeFrames.length,
        durationMs: totalDurationMs,
      })
    } catch (err) {
      setBuildError(err instanceof Error ? err.message : String(err))
    } finally {
      worker.terminate()
      setProgress(null)
    }
  }

  const downloadName = meta ? meta.name.replace(/\.[^.]+$/, '') + '.gif' : 'output.gif'
  const busy = progress !== null || extracting !== null

  /* ------------------------------ UI ------------------------------- */

  const numberInput = (value: number, onChange: (v: number) => void, extra?: React.ComponentProps<typeof Input>) => (
    <Input
      type="number"
      className="h-8 font-mono text-sm"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      {...extra}
    />
  )

  const buildLabel = progress
    ? progress.phase === 'capture'
      ? `Capturing ${progress.done}/${progress.total}`
      : progress.phase === 'encode'
        ? `Encoding ${progress.done}/${progress.total}`
        : 'Optimizing with gifsicle'
    : 'Make GIF'

  return (
    <TooltipProvider delayDuration={300}>
      <canvas ref={canvasRef} className="hidden" />
      {videoUrl && (
        <video ref={workVideoRef} className="hidden" src={videoUrl} preload="auto" muted playsInline crossOrigin="anonymous" />
      )}

      <div className="grid-bg pointer-events-none fixed inset-0 -z-10 h-[40rem]" />

      {/* ------------------------------ header ------------------------------ */}
      <header className="sticky top-0 z-30 border-b border-white/5 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-[0_0_24px_-4px_var(--primary)]">
            <Clapperboard className="size-4" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">vid2gif</div>
            <div className="hidden text-[11px] text-muted-foreground sm:block">Frame-picked GIFs, entirely in your browser</div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {meta && (
              <Badge variant="secondary" className="hidden max-w-[28rem] gap-1.5 font-mono text-[11px] font-normal md:inline-flex">
                <Film className="size-3" />
                <span className="truncate">{meta.name}</span>
                <span className="hidden shrink-0 text-muted-foreground lg:inline">
                  {meta.width}×{meta.height} · {formatTime(meta.duration)}
                  {fpsDetected ? ` · ${fps} fps` : ''}
                </span>
              </Badge>
            )}
            <Button variant={meta ? 'outline' : 'default'} size="sm" asChild>
              <label className="cursor-pointer">
                <Upload data-icon="inline-start" />
                {meta ? 'Change video' : 'Choose video'}
                <input type="file" accept="video/*,.mp4,.webm,.mov,.m4v,.ogv,.mkv,.avi" onChange={onFileInput} hidden />
              </label>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {loadError && (
          <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{loadError}</div>
        )}

        {/* ------------------------------ empty state ------------------------------ */}
        {!videoUrl && (
          <label
            className={cn(
              'block cursor-pointer rounded-2xl border border-dashed p-2 transition-colors',
              dragOver ? 'border-primary bg-primary/5' : 'border-white/15 hover:border-white/30',
            )}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            <input type="file" accept="video/*,.mp4,.webm,.mov,.m4v,.ogv,.mkv,.avi" onChange={onFileInput} hidden />
            <Empty className="min-h-[60vh] rounded-xl bg-card/40">
              <EmptyHeader>
                <EmptyMedia variant="icon" className="bg-primary/15 text-primary">
                  <Upload />
                </EmptyMedia>
                <EmptyTitle className="text-xl">Drop a video to begin</EmptyTitle>
                <EmptyDescription className="max-w-md">
                  MP4, WebM, MOV and anything else your browser can play. Scrub the timeline, cherry-pick frames, and export a
                  tightly optimized GIF. Nothing leaves your machine.
                </EmptyDescription>
              </EmptyHeader>
              <Button size="lg" className="mt-2 pointer-events-none">
                <Upload data-icon="inline-start" />
                Choose a video
              </Button>
            </Empty>
          </label>
        )}

        {videoUrl && (
          <div
            className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem]"
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            {/* ------------------------------ main column ------------------------------ */}
            <div className="min-w-0 space-y-6">
              {/* ------------------------------ result ------------------------------ */}
              {result && (
                <Card className="overflow-hidden border-primary/30 shadow-[0_0_60px_-20px_var(--primary)]">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Sparkles className="size-4 text-primary" />
                      Your GIF is ready
                    </CardTitle>
                    <CardDescription>
                      {result.frames} frames · {result.width}×{result.height} · {(result.durationMs / 1000).toFixed(2)} s
                    </CardDescription>
                    <CardAction className="flex gap-2">
                      <Button variant="outline" size="sm" asChild>
                        <a href={result.url} target="_blank" rel="noreferrer">
                          <ExternalLink data-icon="inline-start" />
                          Open
                        </a>
                      </Button>
                      <Button size="sm" asChild>
                        <a href={result.url} download={downloadName}>
                          <Download data-icon="inline-start" />
                          Download
                        </a>
                      </Button>
                    </CardAction>
                  </CardHeader>
                  <CardContent className="grid gap-4 md:grid-cols-[minmax(0,1fr)_14rem]">
                    <div className="checker flex items-center justify-center overflow-hidden rounded-lg">
                      <img src={result.url} alt="Generated GIF" className="max-h-[420px] max-w-full" />
                    </div>
                    <dl className="grid content-start gap-3 text-sm">
                      <div>
                        <dt className="text-xs text-muted-foreground">File size</dt>
                        <dd className="font-mono text-2xl font-semibold tracking-tight">{formatBytes(result.size)}</dd>
                        {result.rawSize !== result.size && (
                          <dd className="text-xs text-muted-foreground">
                            {formatBytes(result.rawSize)} before optimization ·{' '}
                            <span className="text-primary">−{Math.round((1 - result.size / result.rawSize) * 100)}%</span>
                          </dd>
                        )}
                      </div>
                      <Separator />
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <dt className="text-xs text-muted-foreground">Dimensions</dt>
                          <dd className="font-mono">
                            {result.width}×{result.height}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">Frames</dt>
                          <dd className="font-mono">{result.frames}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">Duration</dt>
                          <dd className="font-mono">{(result.durationMs / 1000).toFixed(2)} s</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">File</dt>
                          <dd className="truncate font-mono">{downloadName}</dd>
                        </div>
                      </div>
                    </dl>
                  </CardContent>
                </Card>
              )}

              {/* ------------------------------ player ------------------------------ */}
              <Card className="overflow-hidden py-0 gap-0">
                <div className="relative flex justify-center bg-black">
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    preload="auto"
                    playsInline
                    className="max-h-[56vh] w-full cursor-pointer object-contain"
                    onLoadedMetadata={onLoadedMetadata}
                    onError={onVideoError}
                    onPlay={() => setPlaying(true)}
                    onPause={() => {
                      setPlaying(false)
                      if (videoRef.current) setCurrentTime(videoRef.current.currentTime)
                    }}
                    onEnded={() => setPlaying(false)}
                    onClick={togglePlay}
                  />
                  {meta && (
                    <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-black/60 px-2 py-1 font-mono text-xs text-white/90 backdrop-blur">
                      {formatTime(currentTime)} <span className="text-white/50">/ {formatTime(meta.duration)}</span>
                      <span className="text-white/50"> · f{Math.floor(currentTime / frameStep + 1e-6) + 1}</span>
                    </div>
                  )}
                </div>

                {meta && (
                  <CardContent className="space-y-4 p-4">
                    {/* filmstrip */}
                    <div className="flex h-11 gap-px overflow-hidden rounded-md bg-black">
                      {filmstrip.map((t) => (
                        <button
                          key={t.time}
                          type="button"
                          className="min-w-0 flex-1 opacity-80 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
                          onClick={() => seekPlayer(t.time)}
                          title={formatTime(t.time)}
                        >
                          <img src={t.url} alt="" draggable={false} className="size-full object-cover" />
                        </button>
                      ))}
                    </div>

                    <Timeline
                      duration={meta.duration}
                      currentTime={currentTime}
                      frames={frames}
                      selectedId={selectedId}
                      frameStep={frameStep}
                      onSeek={seekPlayer}
                      onSelect={setSelectedId}
                      onMoveFrame={moveFrame}
                    />

                    {/* transport */}
                    <div className="flex flex-wrap items-center gap-3">
                      <ButtonGroup>
                        <IconButton label="Back 1 second" onClick={() => seekPlayer(currentTime - 1)}>
                          <Rewind />
                        </IconButton>
                        <IconButton label="Previous frame (←)" onClick={() => stepFrames(-1)}>
                          <ChevronLeft />
                        </IconButton>
                        <Button variant="outline" size="sm" className="w-24" onClick={togglePlay} title="Play / pause (space)">
                          {playing ? <Pause data-icon="inline-start" /> : <Play data-icon="inline-start" />}
                          {playing ? 'Pause' : 'Play'}
                        </Button>
                        <IconButton label="Next frame (→)" onClick={() => stepFrames(1)}>
                          <ChevronRight />
                        </IconButton>
                        <IconButton label="Forward 1 second" onClick={() => seekPlayer(currentTime + 1)}>
                          <FastForward />
                        </IconButton>
                      </ButtonGroup>

                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>Step</span>
                        <Input
                          type="number"
                          className="h-7 w-20 font-mono text-xs"
                          min={1}
                          max={240}
                          step="any"
                          value={fps}
                          title={fpsDetected ? 'Detected from the video' : 'Could not detect the frame rate; set it here'}
                          onChange={(e) => {
                            setFps(Math.max(1, Number(e.target.value) || 1))
                            setFpsDetected(false)
                          }}
                        />
                        <span>fps</span>
                        <Badge variant="outline" className="text-[10px]">
                          {fpsDetected ? 'detected' : 'assumed'}
                        </Badge>
                      </div>

                      <div className="ml-auto flex items-center gap-2">
                        {selectedFrame && Math.abs(selectedFrame.time - currentTime) > frameStep * 0.5 && (
                          <Button variant="secondary" size="sm" onClick={moveSelectedHere} title="Retime the selected frame to the playhead">
                            <MoveHorizontal data-icon="inline-start" />
                            Move frame {selectedIndex + 1} here
                          </Button>
                        )}
                        <Button size="sm" onClick={addCurrentFrame} title="Add this frame (A or Enter)">
                          <Plus data-icon="inline-start" />
                          Add frame
                          <Kbd className="ml-1 bg-primary-foreground/15 text-primary-foreground">A</Kbd>
                        </Button>
                      </div>
                    </div>

                    <Collapsible className="rounded-lg border border-white/5 bg-muted/30">
                      <CollapsibleTrigger asChild>
                        <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium">
                          <Layers className="size-4 text-muted-foreground" />
                          Add many frames at once
                          <span className="ml-auto text-xs text-muted-foreground">
                            every {(1 / Math.max(0.01, exFps)).toFixed(3)} s
                          </span>
                        </button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="flex flex-wrap items-end gap-3 border-t border-white/5 px-3 py-3">
                          <Field label="From (s)">
                            <div className="flex gap-1">
                              {numberInput(exFrom, setExFrom, { min: 0, max: meta.duration, step: 'any', className: 'h-8 w-24 font-mono text-sm' })}
                              <Button variant="outline" size="sm" className="h-8" onClick={() => setExFrom(currentTime)}>
                                now
                              </Button>
                            </div>
                          </Field>
                          <Field label="To (s)">
                            <div className="flex gap-1">
                              {numberInput(exTo, setExTo, { min: 0, max: meta.duration, step: 'any', className: 'h-8 w-24 font-mono text-sm' })}
                              <Button variant="outline" size="sm" className="h-8" onClick={() => setExTo(currentTime)}>
                                now
                              </Button>
                            </div>
                          </Field>
                          <Field label="At (fps)">
                            {numberInput(exFps, setExFps, { min: 0.1, max: fps, step: 'any', className: 'h-8 w-20 font-mono text-sm' })}
                          </Field>
                          <Button variant="secondary" size="sm" className="h-8" disabled={busy} onClick={extractRange}>
                            {extracting ? (
                              <>
                                <Loader2 data-icon="inline-start" className="animate-spin" />
                                Adding {extracting.done}/{extracting.total}
                              </>
                            ) : (
                              <>
                                <Plus data-icon="inline-start" />
                                Add frames from range
                              </>
                            )}
                          </Button>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>

                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Kbd>space</Kbd> play/pause
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Kbd>←</Kbd>
                        <Kbd>→</Kbd> step (<Kbd>shift</Kbd> ×10)
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Kbd>A</Kbd> add frame
                      </span>
                      <span>Click a frame card, then drag its dot on the timeline to retime it.</span>
                    </p>
                  </CardContent>
                )}
              </Card>

              {/* ------------------------------ frames ------------------------------ */}
              {meta && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      Selected frames
                      <Badge variant="secondary" className="font-mono font-normal">
                        {activeFrames.length}/{frames.length}
                      </Badge>
                    </CardTitle>
                    <CardDescription>Always kept in video order, no matter when you add them.</CardDescription>
                    {frames.length > 0 && (
                      <CardAction className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={frames.every((f) => !f.skipped)}
                          onClick={() => setFrames((l) => l.filter((f) => !f.skipped))}
                        >
                          Remove skipped
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => {
                            setFrames([])
                            setSelectedId(null)
                          }}
                        >
                          <X data-icon="inline-start" />
                          Clear
                        </Button>
                      </CardAction>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {notice && (
                      <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-200">{notice}</div>
                    )}

                    {frames.length === 0 ? (
                      <Empty className="border border-dashed border-white/10 py-10">
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            <Film />
                          </EmptyMedia>
                          <EmptyTitle>No frames yet</EmptyTitle>
                          <EmptyDescription>
                            Scrub to a frame above and press <strong>Add frame</strong>, or open "Add many frames at once".
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    ) : (
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                        {frames.map((f, i) => (
                          <FrameCard
                            key={f.id}
                            frame={f}
                            index={i}
                            globalDelay={delay}
                            selected={f.id === selectedId}
                            onSeek={seekPlayer}
                            onSelect={setSelectedId}
                            onToggleSkip={toggleSkip}
                            onCopy={copyFrame}
                            onRemove={removeFrame}
                            onDelay={setFrameDelay}
                          />
                        ))}
                      </div>
                    )}

                    {frames.length > 0 && (
                      <div className="grid gap-4 rounded-lg border border-white/5 bg-muted/30 p-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Range (frame numbers)</div>
                          <div className="flex flex-wrap items-center gap-2">
                            {numberInput(rangeFrom, setRangeFrom, { min: 1, max: frames.length, className: 'h-8 w-16 font-mono text-sm' })}
                            <span className="text-xs text-muted-foreground">to</span>
                            {numberInput(rangeTo, setRangeTo, { min: 1, max: frames.length, className: 'h-8 w-16 font-mono text-sm' })}
                            <ButtonGroup>
                              <Button variant="outline" size="sm" onClick={() => applyRange((f) => ({ ...f, skipped: true }))}>
                                <EyeOff data-icon="inline-start" />
                                Skip
                              </Button>
                              <Button variant="outline" size="sm" onClick={() => applyRange((f) => ({ ...f, skipped: false }))}>
                                <Eye data-icon="inline-start" />
                                Enable
                              </Button>
                            </ButtonGroup>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs text-muted-foreground">Delay</span>
                            {numberInput(rangeDelay, setRangeDelay, { min: 0, className: 'h-8 w-20 font-mono text-sm' })}
                            <Button variant="outline" size="sm" onClick={() => applyRange((f) => ({ ...f, delay: rangeDelay }))}>
                              Set for range
                            </Button>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Every N-th frame</div>
                          <div className="flex flex-wrap items-center gap-2">
                            {numberInput(everyN, setEveryN, { min: 1, className: 'h-8 w-16 font-mono text-sm' })}
                            <ButtonGroup>
                              <Button variant="outline" size="sm" onClick={() => applyEveryNth(true)}>
                                <EyeOff data-icon="inline-start" />
                                Skip every N-th
                              </Button>
                              <Button variant="outline" size="sm" onClick={() => applyEveryNth(false)}>
                                <Eye data-icon="inline-start" />
                                Enable every N-th
                              </Button>
                            </ButtonGroup>
                          </div>
                          <p className="text-xs text-muted-foreground">Halve the frame count with N = 2 to shrink the file.</p>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>

            {/* ------------------------------ sidebar ------------------------------ */}
            {meta && (
              <aside className="lg:sticky lg:top-20 lg:self-start">
                <Card className="gap-4">
                  <CardHeader>
                    <CardTitle>Export</CardTitle>
                    <CardDescription>
                      {activeFrames.length} frames · {outWidth}×{outHeight} · {(totalDurationMs / 1000).toFixed(2)} s
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <Tabs defaultValue="timing">
                      <TabsList className="w-full">
                        <TabsTrigger value="timing" className="flex-1 data-[state=active]:bg-primary/15 data-[state=active]:text-primary">
                          Timing
                        </TabsTrigger>
                        <TabsTrigger value="size" className="flex-1 data-[state=active]:bg-primary/15 data-[state=active]:text-primary">
                          Size
                        </TabsTrigger>
                        <TabsTrigger value="optimize" className="flex-1 data-[state=active]:bg-primary/15 data-[state=active]:text-primary">
                          Optimize
                        </TabsTrigger>
                      </TabsList>

                      <TabsContent value="timing" className="space-y-5 pt-4">
                        <Field
                          label="Frame delay"
                          hint="In 1/100 s. Changing this resets every per-frame delay. Browsers treat values under 2 as 10."
                        >
                          <div className="flex items-center gap-3">
                            {numberInput(delay, (v) => changeGlobalDelay(Math.max(0, v || 0)), { min: 0, max: 65535, className: 'h-8 w-24 font-mono text-sm' })}
                            <Badge variant="outline" className="font-mono">
                              {delay > 0 ? (100 / delay).toFixed(2) : '∞'} fps
                            </Badge>
                            {delay > 0 && delay < 2 && <span className="text-xs text-amber-300">too short</span>}
                          </div>
                        </Field>
                        <Field label="Loop count" hint="Empty loops forever, −1 plays once.">
                          <Input
                            type="number"
                            min={-1}
                            className="h-8 w-24 font-mono text-sm"
                            value={loop}
                            placeholder="∞"
                            onChange={(e) => setLoop(e.target.value)}
                          />
                        </Field>
                      </TabsContent>

                      <TabsContent value="size" className="space-y-5 pt-4">
                        <Field label="Output size" hint={`Source is ${meta.width}×${meta.height}.`}>
                          <div className="flex items-center gap-2">
                            {numberInput(outWidth, setWidth, { min: 1, className: 'h-8 w-24 font-mono text-sm' })}
                            <span className="text-muted-foreground">×</span>
                            {numberInput(outHeight, setHeight, { min: 1, className: 'h-8 w-24 font-mono text-sm' })}
                          </div>
                        </Field>
                        <div className="flex items-center justify-between">
                          <Label htmlFor="aspect" className="text-sm">
                            Keep aspect ratio
                          </Label>
                          <Switch id="aspect" checked={keepAspect} onCheckedChange={setKeepAspect} />
                        </div>
                        <ButtonGroup className="w-full">
                          <Button variant="outline" size="sm" className="flex-1" onClick={() => setWidth(meta.width)}>
                            Original
                          </Button>
                          <Button variant="outline" size="sm" className="flex-1" onClick={() => setWidth(Math.round(meta.width / 2))}>
                            50%
                          </Button>
                          <Button variant="outline" size="sm" className="flex-1" onClick={() => setWidth(Math.min(meta.width, 480))}>
                            480w
                          </Button>
                          <Button variant="outline" size="sm" className="flex-1" onClick={() => setWidth(Math.min(meta.width, 320))}>
                            320w
                          </Button>
                        </ButtonGroup>
                      </TabsContent>

                      <TabsContent value="optimize" className="space-y-5 pt-4">
                        <Field label="Colors" hint="Fewer colors mean a smaller file.">
                          <div className="flex items-center gap-3">
                            <Slider min={2} max={256} step={1} value={[colors]} onValueChange={([v]) => setColors(v)} className="flex-1" />
                            <span className="w-8 text-right font-mono text-sm tabular">{colors}</span>
                          </div>
                        </Field>
                        <Field label="Palette">
                          <Select value={paletteMode} onValueChange={(v) => setPaletteMode(v as PaletteMode)}>
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="global">Global — smaller, best with frame optimization</SelectItem>
                              <SelectItem value="frame">Per frame — better color, larger</SelectItem>
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field label="Dithering">
                          <Select value={dither} onValueChange={(v) => setDither(v as DitherMode)}>
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">None — smallest</SelectItem>
                              <SelectItem value="floyd">Floyd–Steinberg — smooth gradients, larger</SelectItem>
                              <SelectItem value="ordered">Ordered (Bayer) — patterned, compresses well</SelectItem>
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field label="Frame optimization" hint="gifsicle -O: stores only what changes between frames.">
                          <Select value={String(optLevel)} onValueChange={(v) => setOptLevel(Number(v) as 0 | 1 | 2 | 3)}>
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0">Off — store every frame in full</SelectItem>
                              <SelectItem value="1">Level 1 — changed area only</SelectItem>
                              <SelectItem value="2">Level 2 — changed area + transparency</SelectItem>
                              <SelectItem value="3">Level 3 — exhaustive (slow on big GIFs)</SelectItem>
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field label="Lossy compression" hint="gifsicle --lossy. 30–80 is a good range; 200 is maximum artifacts.">
                          <div className="flex items-center gap-3">
                            <Slider min={0} max={200} step={1} value={[lossy]} onValueChange={([v]) => setLossy(v)} className="flex-1" />
                            <span className="w-8 text-right font-mono text-sm tabular">{lossy}</span>
                          </div>
                        </Field>
                      </TabsContent>
                    </Tabs>

                    <Separator />

                    <div className="space-y-3">
                      <Button size="lg" className="w-full text-base font-semibold" disabled={busy || activeFrames.length === 0} onClick={buildGif}>
                        {progress ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Sparkles data-icon="inline-start" />}
                        {buildLabel}
                      </Button>
                      {progress && <Progress value={progress.total ? (progress.done / progress.total) * 100 : 100} />}
                      {buildError && (
                        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{buildError}</div>
                      )}
                      {activeFrames.length === 0 && !progress && (
                        <p className="text-center text-xs text-muted-foreground">Add at least one frame to export.</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </aside>
            )}
          </div>
        )}
      </main>
    </TooltipProvider>
  )
}
