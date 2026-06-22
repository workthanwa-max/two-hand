import {
  FilesetResolver,
  HandLandmarker,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision'

export type HandLandmark = { x: number; y: number; z?: number; visibility?: number }
export type HandFocus = 'ready' | 'too-small' | 'too-large' | 'edge' | 'low-confidence'
export type HandCoord = {
  x: number
  y: number
  detected: boolean
  visible: boolean
  active: boolean
  confidence: number
  size: number
  focus: HandFocus
  landmarks: HandLandmark[]
}
export type VisionMode = 'idle' | 'loading' | 'camera' | 'mock' | 'error'
export type VisionStats = { fps: number; inferenceMs: number; droppedFrames: number; quality: number }

export type VisionSnapshot = {
  left: HandCoord | null
  right: HandCoord | null
  tracking: boolean
  timestamp: number
  stats: VisionStats
}

function clamp(val: number, min: number, max: number) {
  return Math.min(Math.max(val, min), max)
}
function lerp(start: number, end: number, amt: number) {
  return (1 - amt) * start + amt * end
}

const wasmRoot = '/mediapipe/wasm'
const handModelPath = '/mediapipe/models/hand_landmarker.task'
const palmCenterIndex = 9
const minimumHandSize = 0.06
const maximumHandSize = 0.5
const sideSplit = 0.5
const trackingGraceMs = 180
const relockMs = 620
const maximumTrackJump = 0.46
const confirmationFrames = 1
const predictionDamping = 0.45

type VisionHandlerOptions = {
  onSnapshot: (snapshot: VisionSnapshot) => void
  videoElement?: HTMLVideoElement | null
  fps?: number
}

type TrackSide = 'left' | 'right'

type TrackMemory = {
  point: HandCoord
  seenAt: number
  velocityX: number
  velocityY: number
  pendingFrames: number
}

type VideoElementWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number
  cancelVideoFrameCallback?: (handle: number) => void
}

export class VisionHandler {
  private readonly onSnapshot: (snapshot: VisionSnapshot) => void
  private videoElement: VideoElementWithFrameCallback | null
  private frameMs: number
  private minimumFrameMs: number
  private timerId = 0
  private videoFrameCallbackId = 0
  private startedAt = 0
  private lastVideoTime = -1
  private lastDetectionAt = 0
  private handLandmarker: HandLandmarker | null = null
  private mode: VisionMode = 'idle'
  private droppedFrames = 0
  private statsStartedAt = 0
  private statsFrames = 0
  private currentStats: VisionStats = {
    fps: 0,
    inferenceMs: 0,
    droppedFrames: 0,
    quality: 0,
  }
  private tracks: Record<TrackSide, TrackMemory> = {
    left: createTrack(0.38),
    right: createTrack(0.62),
  }
  private readonly maxFps: number
  private targetFps: number
  private lastAdaptiveChange = 0

  constructor({ onSnapshot, videoElement = null, fps = 30 }: VisionHandlerOptions) {
    this.onSnapshot = onSnapshot
    this.videoElement = videoElement
    this.maxFps = Math.max(15, fps)
    this.targetFps = Math.min(this.maxFps, 20)
    this.frameMs = 1000 / this.targetFps
    this.minimumFrameMs = Math.max(16, this.frameMs)
  }

  get activeMode() {
    return this.mode
  }

  setVideoElement(videoElement: HTMLVideoElement | null) {
    this.videoElement = videoElement
  }

  async start() {
    if (this.timerId !== 0 || this.videoFrameCallbackId !== 0) {
      return this.mode
    }

    await this.startReal()
    return this.mode
  }

  startMock() {
    if (this.timerId !== 0) {
      return
    }

    this.mode = 'mock'
    this.startedAt = performance.now()
    this.scheduleMockFrame()
  }

  stop() {
    if (this.timerId !== 0) {
      window.clearTimeout(this.timerId)
      this.timerId = 0
    }

    if (this.videoFrameCallbackId !== 0 && this.videoElement?.cancelVideoFrameCallback) {
      this.videoElement.cancelVideoFrameCallback(this.videoFrameCallbackId)
      this.videoFrameCallbackId = 0
    }
  }

  pause() {
    this.stop()
  }

  resume() {
    if (this.timerId !== 0 || this.videoFrameCallbackId !== 0 || this.mode === 'idle') {
      return
    }

    if (this.mode === 'camera' && this.handLandmarker) {
      this.scheduleRealFrame()
      return
    }

    if (this.mode === 'mock') {
      this.scheduleMockFrame()
    }
  }

  dispose() {
    this.stop()
    this.handLandmarker?.close()
    this.handLandmarker = null
    this.mode = 'idle'
    this.tracks = {
      left: createTrack(0.38),
      right: createTrack(0.62),
    }
    this.currentStats = {
      fps: 0,
      inferenceMs: 0,
      droppedFrames: 0,
      quality: 0,
    }
    this.emitSnapshot(performance.now())
  }

  private async startReal() {
    this.handLandmarker = await createHandLandmarker()
    this.mode = 'camera'
    this.lastVideoTime = -1
    this.lastDetectionAt = 0
    this.droppedFrames = 0
    this.statsStartedAt = performance.now()
    this.statsFrames = 0
    if (this.videoElement) {
      this.scheduleRealFrame()
    }
  }

  private readonly scheduleRealFrame = () => {
    if (this.videoElement?.requestVideoFrameCallback) {
      this.videoFrameCallbackId = this.videoElement.requestVideoFrameCallback(() => {
        this.videoFrameCallbackId = 0
        this.detectVideoFrame()
        if (this.mode === 'camera' && this.handLandmarker) {
          this.scheduleRealFrame()
        }
      })
      return
    }

    this.timerId = window.setTimeout(() => {
      this.timerId = 0
      this.detectVideoFrame()
      if (this.mode === 'camera' && this.handLandmarker) {
        this.scheduleRealFrame()
      }
    }, this.frameMs)
  }

  private readonly scheduleMockFrame = () => {
    this.timerId = window.setTimeout(() => {
      this.timerId = 0
      this.writeMockHandSnapshot(performance.now())
      if (this.mode === 'mock') {
        this.scheduleMockFrame()
      }
    }, this.frameMs)
  }

  private detectVideoFrame() {
    if (!this.videoElement || !this.handLandmarker) {
      return
    }

    if (this.videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return
    }

    if (this.videoElement.currentTime === this.lastVideoTime) {
      return
    }

    const now = performance.now()

    if (now - this.lastDetectionAt < this.minimumFrameMs) {
      this.droppedFrames += 1
      return
    }

    this.lastVideoTime = this.videoElement.currentTime
    this.lastDetectionAt = now

    const inferenceStartedAt = performance.now()
    const result = this.handLandmarker.detectForVideo(this.videoElement, now)
    const inferenceMs = performance.now() - inferenceStartedAt

    if (inferenceMs > 40 && now - this.lastAdaptiveChange > 500) {
      this.targetFps = Math.max(10, Math.floor(this.targetFps * 0.8))
      this.frameMs = 1000 / this.targetFps
      this.minimumFrameMs = Math.max(16, this.frameMs)
      this.lastAdaptiveChange = now
    } else if (inferenceMs < 20 && this.targetFps < this.maxFps && now - this.lastAdaptiveChange > 800) {
      this.targetFps = Math.min(this.maxFps, Math.ceil(this.targetFps * 1.12))
      this.frameMs = 1000 / this.targetFps
      this.minimumFrameMs = Math.max(16, this.frameMs)
      this.lastAdaptiveChange = now
    }

    const candidates = result.landmarks.map(createHandPoint)
    const { left, right } = this.assignPlayerHands(candidates, now)
    const quality = getTrackingQuality(left, right)

    this.updateStats(now, inferenceMs, quality)
    
    this.onSnapshot({
      left: left,
      right: right,
      tracking: left.active || right.active,
      timestamp: now,
      stats: this.currentStats,
    })
  }

  private emitSnapshot(now: number) {
    this.onSnapshot({
      left: this.tracks.left.point,
      right: this.tracks.right.point,
      tracking: this.tracks.left.point.active || this.tracks.right.point.active,
      timestamp: now,
      stats: this.currentStats,
    })
  }

  private assignPlayerHands(candidates: HandCoord[], now: number) {
    let leftCandidate = pickBestCandidate(
      candidates,
      'left',
      this.tracks.left.point,
      now - this.tracks.left.seenAt,
    )
    let rightCandidate = pickBestCandidate(
      candidates,
      'right',
      this.tracks.right.point,
      now - this.tracks.right.seenAt,
    )

    if (leftCandidate && rightCandidate && leftCandidate === rightCandidate) {
      const leftScore = scoreCandidate(
        leftCandidate,
        'left',
        this.tracks.left.point,
        now - this.tracks.left.seenAt,
      )
      const rightScore = scoreCandidate(
        rightCandidate,
        'right',
        this.tracks.right.point,
        now - this.tracks.right.seenAt,
      )

      if (leftScore > rightScore) {
        rightCandidate = null
      } else if (rightScore > leftScore) {
        leftCandidate = null
      } else {
        if (leftCandidate.x < sideSplit) {
          rightCandidate = null
        } else {
          leftCandidate = null
        }
      }
    }

    const left = this.stabilizeTrack('left', leftCandidate, now, 0.38)
    const right = this.stabilizeTrack('right', rightCandidate, now, 0.62)

    return { left, right }
  }

  private stabilizeTrack(
    side: TrackSide,
    candidate: HandCoord | null,
    now: number,
    fallbackX: number,
  ) {
    const track = this.tracks[side]
    const previous = track.point
    const timeSinceSeen = now - track.seenAt

    if (!candidate) {
      track.pendingFrames = 0

      if (previous.active && timeSinceSeen < trackingGraceMs) {
        return predictPoint(previous, track, timeSinceSeen)
      }

      const hidden = createHiddenPoint(fallbackX)

      track.point = hidden
      track.velocityX = 0
      track.velocityY = 0
      return hidden
    }

    const distance = previous.active ? getDistance(previous, candidate) : 0
    const canRelock = !previous.active || timeSinceSeen > relockMs

    if (!canRelock && distance > maximumTrackJump) {
      track.pendingFrames = 0
      return predictPoint(previous, track, timeSinceSeen)
    }

    if (!previous.active) {
      track.pendingFrames += 1

      if (track.pendingFrames < confirmationFrames) {
        return createHiddenPoint(fallbackX)
      }
    }

    const deltaSeconds = Math.max((now - track.seenAt) / 1000, 1 / 60)
    const targetVelocityX = previous.active ? (candidate.x - previous.x) / deltaSeconds : 0
    const targetVelocityY = previous.active ? (candidate.y - previous.y) / deltaSeconds : 0
    const velocityBlend = previous.active ? 0.45 : 1
    const smoothing = getAdaptiveSmoothing(distance, candidate.confidence)
    const stable = previous.active
      ? {
          ...candidate,
          x: lerp(previous.x, candidate.x, smoothing),
          y: lerp(previous.y, candidate.y, smoothing),
          size: lerp(previous.size, candidate.size, smoothing),
        }
      : candidate

    track.velocityX = lerp(track.velocityX, targetVelocityX, velocityBlend)
    track.velocityY = lerp(track.velocityY, targetVelocityY, velocityBlend)
    track.point = stable
    track.seenAt = now
    track.pendingFrames = confirmationFrames

    return stable
  }

  private updateStats(now: number, inferenceMs: number, quality: number) {
    this.statsFrames += 1

    const sampleMs = now - this.statsStartedAt
    const fps =
      sampleMs >= 500 ? Math.round((this.statsFrames * 1000) / sampleMs) : this.currentStats.fps

    this.currentStats = {
      fps,
      inferenceMs: Math.round(inferenceMs),
      droppedFrames: this.droppedFrames,
      quality,
    }

    if (sampleMs >= 500) {
      this.statsStartedAt = now
      this.statsFrames = 0
      this.droppedFrames = 0
    }

    this.adaptFrameRate(now, inferenceMs)
  }

  private adaptFrameRate(now: number, inferenceMs: number) {
    if (inferenceMs > this.frameMs) {
      this.targetFps = Math.max(this.maxFps * 0.5, 15)
    } else {
      this.targetFps = this.maxFps
    }

    const adaptiveFrameMs = 1000 / this.targetFps

    if (now - this.lastAdaptiveChange > 500) {
      this.frameMs = lerp(this.frameMs, adaptiveFrameMs, 0.1)
      this.minimumFrameMs = Math.max(16, this.frameMs)
      this.lastAdaptiveChange = now
    }
  }

  private writeMockHandSnapshot(now: number) {
    const seconds = (now - this.startedAt) / 1000
    const sway = Math.sin(seconds * 1.5)
    const rightReach = Math.max(0, Math.sin(seconds * 0.8))
    const stats = {
      fps: Math.round(1000 / this.frameMs),
      inferenceMs: 1,
      droppedFrames: 0,
      quality: 1,
    }

    this.onSnapshot({
      left: {
        x: 0.32 + sway * 0.08,
        y: 0.58 + Math.cos(seconds * 2) * 0.08,
        confidence: 0.96,
        visible: true,
        active: true,
        size: 0.2,
        detected: true,
        focus: 'ready',
        landmarks: [],
      },
      right: {
        x: 0.58 + rightReach * 0.3,
        y: 0.54 - rightReach * 0.42,
        confidence: 0.96,
        visible: true,
        active: true,
        size: 0.2,
        detected: true,
        focus: 'ready',
        landmarks: [],
      },
      tracking: true,
      timestamp: now,
      stats,
    })
  }
}

async function createHandLandmarker() {
  const visionFileset = await FilesetResolver.forVisionTasks(wasmRoot)

  return HandLandmarker.createFromOptions(visionFileset, {
    baseOptions: {
      modelAssetPath: handModelPath,
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.60,
    minHandPresenceConfidence: 0.60,
    minTrackingConfidence: 0.60,
  })
}

function createHandPoint(landmarks: NormalizedLandmark[]): HandCoord {
  const center = landmarks[palmCenterIndex] ?? averageLandmarks(landmarks)
  const bounds = getBounds(landmarks)
  const size = Math.max(bounds.width, bounds.height)
  const confidence = clamp((size - minimumHandSize) / 0.16, 0, 1)
  const x = mirrorX(center.x)
  const y = center.y
  const inBounds =
    x >= 0.03 &&
    x <= 0.97 &&
    y >= 0.08 &&
    y <= 0.96
  const visible =
    size >= minimumHandSize &&
    size <= maximumHandSize &&
    inBounds

  const focus: HandFocus = !inBounds ? 'edge' : size < minimumHandSize ? 'too-small' : size > maximumHandSize ? 'too-large' : 'ready'

  return {
    x,
    y,
    confidence,
    visible,
    active: visible,
    size,
    detected: true,
    focus,
    landmarks: landmarks.map(l => ({ x: mirrorX(l.x), y: l.y, z: l.z, visibility: l.visibility })),
  }
}

function pickBestCandidate(
  candidates: HandCoord[],
  side: TrackSide,
  previous: HandCoord,
  timeSinceSeen: number,
): HandCoord | null {
  let best: HandCoord | null = null
  let bestScore = -1

  candidates.forEach((candidate) => {
    if (side === 'left' && candidate.x > 0.58) {
      return
    }

    if (side === 'right' && candidate.x < 0.42) {
      return
    }

    const score = scoreCandidate(candidate, side, previous, timeSinceSeen)

    if (score > bestScore) {
      best = candidate
      bestScore = score
    }
  })

  return best
}

function scoreCandidate(
  candidate: HandCoord,
  side: TrackSide,
  previous: HandCoord,
  timeSinceSeen: number,
) {
  const sideFit =
    side === 'left'
      ? clamp((sideSplit + 0.2 - candidate.x) / 0.5, 0, 1)
      : clamp((candidate.x - sideSplit + 0.2) / 0.5, 0, 1)
  const sizeScore = clamp(candidate.size / 0.2, 0, 1)
  const centerScore = 1 - clamp(Math.abs(candidate.y - 0.58) / 0.52, 0, 1)
  const continuity =
    previous.active && timeSinceSeen < relockMs
      ? 1 - clamp(getDistance(previous, candidate) / maximumTrackJump, 0, 1)
      : 0.35

  return sideFit * 0.26 + sizeScore * 0.24 + centerScore * 0.12 + continuity * 0.38
}

function getAdaptiveSmoothing(distance: number, confidence: number) {
  if (distance > 0.18) {
    return 0.85
  }

  if (distance > 0.08) {
    return 0.75
  }

  return lerp(0.48, 0.62, confidence)
}

function predictPoint(point: HandCoord, track: TrackMemory, timeSinceSeenMs: number): HandCoord {
  const seconds = Math.min(timeSinceSeenMs / 1000, trackingGraceMs / 1000)

  return {
    ...point,
    x: clamp(point.x + track.velocityX * seconds * predictionDamping, 0, 1),
    y: clamp(point.y + track.velocityY * seconds * predictionDamping, 0, 1),
  }
}

function getTrackingQuality(left: HandCoord, right: HandCoord) {
  const activeHands = Number(left.active) + Number(right.active)
  const confidence = (left.confidence + right.confidence) / 2

  return Math.round((activeHands / 2) * confidence * 100) / 100
}

function getDistance(first: HandCoord, second: HandCoord) {
  const dx = first.x - second.x
  const dy = first.y - second.y

  return Math.sqrt(dx * dx + dy * dy)
}

function getBounds(landmarks: NormalizedLandmark[]) {
  return landmarks.reduce(
    (bounds, landmark) => ({
      minX: Math.min(bounds.minX, landmark.x),
      maxX: Math.max(bounds.maxX, landmark.x),
      minY: Math.min(bounds.minY, landmark.y),
      maxY: Math.max(bounds.maxY, landmark.y),
      width: Math.max(bounds.maxX, landmark.x) - Math.min(bounds.minX, landmark.x),
      height: Math.max(bounds.maxY, landmark.y) - Math.min(bounds.minY, landmark.y),
    }),
    {
      minX: 1,
      maxX: 0,
      minY: 1,
      maxY: 0,
      width: 0,
      height: 0,
    },
  )
}

function averageLandmarks(landmarks: NormalizedLandmark[]) {
  const total = landmarks.reduce(
    (sum, landmark) => ({
      x: sum.x + landmark.x,
      y: sum.y + landmark.y,
      z: sum.z + landmark.z,
      visibility: sum.visibility + landmark.visibility,
    }),
    { x: 0, y: 0, z: 0, visibility: 0 },
  )
  const count = Math.max(landmarks.length, 1)

  return {
    x: total.x / count,
    y: total.y / count,
    z: total.z / count,
    visibility: total.visibility / count,
  }
}

function createTrack(x: number): TrackMemory {
  return {
    point: createHiddenPoint(x),
    seenAt: 0,
    velocityX: 0,
    velocityY: 0,
    pendingFrames: 0,
  }
}

function createHiddenPoint(x: number): HandCoord {
  return {
    x,
    y: 0.5,
    confidence: 0,
    visible: false,
    active: false,
    size: 0,
    detected: false,
    focus: 'too-small',
    landmarks: [],
  }
}

function mirrorX(value: number) {
  return 1 - value
}
