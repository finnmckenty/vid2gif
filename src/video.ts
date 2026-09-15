/** Seek a video element and resolve once the new frame is decoded. */
export function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  const t = Math.max(0, Math.min(time, video.duration || time))
  if (Math.abs(video.currentTime - t) < 1e-4 && video.readyState >= 2) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      video.removeEventListener('seeked', finish)
      clearTimeout(timer)
      resolve()
    }
    // Safety net: some browsers skip `seeked` for no-op seeks.
    const timer = setTimeout(finish, 2000)
    video.addEventListener('seeked', finish)
    video.currentTime = t
  })
}

/** Resolve once the element has enough data to draw a frame. */
export function waitLoaded(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 2) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const ok = () => {
      cleanup()
      resolve()
    }
    const bad = () => {
      cleanup()
      reject(new Error('This video could not be decoded by your browser.'))
    }
    const cleanup = () => {
      video.removeEventListener('loadeddata', ok)
      video.removeEventListener('error', bad)
    }
    video.addEventListener('loadeddata', ok)
    video.addEventListener('error', bad)
  })
}

const COMMON_FPS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120]

/**
 * Estimate the source frame rate by playing a short muted stretch and
 * counting decoded frames (getVideoPlaybackQuality works even in background
 * tabs, unlike requestVideoFrameCallback). Returns null if nothing usable.
 */
export async function estimateFps(video: HTMLVideoElement): Promise<number | null> {
  if (typeof video.getVideoPlaybackQuality !== 'function') return null
  await seekTo(video, 0)
  video.muted = true
  const wasPaused = video.paused
  try {
    await video.play()
  } catch {
    return null
  }
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  // Let playback settle so the decoder's look-ahead is steady.
  await sleep(150)
  const t0 = video.currentTime
  const n0 = video.getVideoPlaybackQuality().totalVideoFrames
  const wallStart = performance.now()
  let dt = 0
  let dn = 0
  while (performance.now() - wallStart < 3000) {
    await sleep(50)
    dt = video.currentTime - t0
    dn = video.getVideoPlaybackQuality().totalVideoFrames - n0
    if (dt >= 1.0 || video.ended) break
  }
  video.pause()
  await seekTo(video, 0)
  if (wasPaused) video.pause()
  if (dt <= 0.2 || dn <= 0) return null
  const raw = dn / dt
  const snapped = COMMON_FPS.find((f) => Math.abs(f - raw) / f < 0.06)
  return snapped ?? Math.round(raw * 100) / 100
}

/** Draw the current video frame into a canvas at the given size. */
export function drawFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement, w: number, h: number) {
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(video, 0, 0, w, h)
  return ctx
}

/** JPEG data URL thumbnail of the current video frame. */
export function thumbnail(video: HTMLVideoElement, canvas: HTMLCanvasElement, maxW = 200): string {
  const vw = video.videoWidth || 1
  const vh = video.videoHeight || 1
  const scale = Math.min(1, maxW / vw)
  drawFrame(video, canvas, Math.round(vw * scale), Math.round(vh * scale))
  return canvas.toDataURL('image/jpeg', 0.8)
}

export function formatTime(t: number): string {
  if (!isFinite(t)) return '0:00.000'
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${m}:${s.toFixed(3).padStart(6, '0')}`
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}
