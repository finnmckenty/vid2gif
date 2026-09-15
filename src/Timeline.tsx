import { useCallback, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Frame } from './types'
import { formatTime } from './video'
import { cn } from '@/lib/utils'

interface TimelineProps {
  duration: number
  currentTime: number
  frames: Frame[]
  selectedId: number | null
  /** Snap step in seconds (one video frame). */
  frameStep: number
  onSeek: (time: number) => void
  onSelect: (id: number | null) => void
  /** Called while dragging (final=false) and on release (final=true). */
  onMoveFrame: (id: number, time: number, final: boolean) => void
}

type Drag = { kind: 'playhead' } | { kind: 'marker'; id: number }

/**
 * Scrubber with a dot for every selected frame. Click/drag the track to move
 * the playhead; drag a dot to retime that frame.
 */
export default function Timeline({
  duration,
  currentTime,
  frames,
  selectedId,
  frameStep,
  onSeek,
  onSelect,
  onMoveFrame,
}: TimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const [dragging, setDragging] = useState<Drag | null>(null)

  const timeAt = useCallback(
    (clientX: number, snap: boolean) => {
      const el = trackRef.current
      if (!el || !duration) return 0
      const rect = el.getBoundingClientRect()
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      let t = ratio * duration
      if (snap) {
        // Land in the middle of a video frame, same convention as frame stepping.
        t = (Math.floor(t / frameStep + 1e-6) + 0.5) * frameStep
      }
      return Math.max(0, Math.min(duration, t))
    },
    [duration, frameStep],
  )

  const startDrag = (e: ReactPointerEvent, drag: Drag) => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = drag
    setDragging(drag)
    if (drag.kind === 'marker') {
      onSelect(drag.id)
      onSeek(timeAt(e.clientX, true))
    } else {
      onSeek(timeAt(e.clientX, false))
    }
  }

  const onPointerMove = (e: ReactPointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    if (drag.kind === 'marker') {
      const t = timeAt(e.clientX, true)
      onMoveFrame(drag.id, t, false)
      onSeek(t)
    } else {
      onSeek(timeAt(e.clientX, false))
    }
  }

  const endDrag = (e: ReactPointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    setDragging(null)
    if (drag.kind === 'marker') {
      const t = timeAt(e.clientX, true)
      onMoveFrame(drag.id, t, true)
      onSeek(t)
    }
  }

  const pct = (t: number) => `${duration ? (t / duration) * 100 : 0}%`
  const played = duration ? (currentTime / duration) * 100 : 0

  return (
    <div className="relative select-none">
      {dragging?.kind === 'marker' && (
        <div className="absolute -top-6 right-0 text-xs text-primary">
          Moving frame to <span className="font-mono font-medium">{formatTime(currentTime)}</span>
        </div>
      )}
      <div
        ref={trackRef}
        className={cn('relative h-8 touch-none', dragging ? 'cursor-grabbing' : 'cursor-pointer')}
        onPointerDown={(e) => startDrag(e, { kind: 'playhead' })}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* rail */}
        <div className="absolute inset-x-0 top-3.5 h-1 rounded-full bg-white/10" />
        <div className="absolute left-0 top-3.5 h-1 rounded-full bg-white/25" style={{ width: `${played}%` }} />
        {/* playhead */}
        <div
          className="pointer-events-none absolute top-1 h-6 w-0.5 -translate-x-1/2 rounded-full bg-foreground shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
          style={{ left: pct(currentTime) }}
        />
        {frames.map((f) => {
          const selected = f.id === selectedId
          const isDragging = dragging?.kind === 'marker' && dragging.id === f.id
          return (
            <button
              key={f.id}
              type="button"
              className={cn(
                'absolute top-2 size-4 -translate-x-1/2 rounded-full border-2 border-background transition-transform',
                'hover:scale-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                f.skipped ? 'bg-muted-foreground/60' : 'bg-primary',
                selected && 'z-10 scale-[1.45] bg-foreground ring-[3px] ring-primary/50 hover:scale-[1.45]',
                isDragging ? 'cursor-grabbing' : 'cursor-grab',
              )}
              style={{ left: pct(f.time) }}
              title={`Frame at ${formatTime(f.time)} — drag to retime`}
              onPointerDown={(e) => startDrag(e, { kind: 'marker', id: f.id })}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onClick={(e) => e.stopPropagation()}
            />
          )
        })}
      </div>
    </div>
  )
}
