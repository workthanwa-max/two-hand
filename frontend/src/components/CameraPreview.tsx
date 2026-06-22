import { useEffect, useMemo, useRef } from 'react'
import { getCameraStream, getHandMessage, bindVideoElement, type HandCoord, type VisionRef } from '../vision'

type CameraPreviewProps = {
  vision: VisionRef
  compact?: boolean
  holdProgress?: number
}

const HAND_LINES = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
] as const

function pickHandInfo(vision: VisionRef): { hand: HandCoord | null; side: 'L' | 'R' | null } {
  if (vision.right?.visible && vision.left?.visible) {
    return vision.right.confidence >= vision.left.confidence
      ? { hand: vision.right, side: 'R' }
      : { hand: vision.left, side: 'L' }
  }
  if (vision.right?.visible) return { hand: vision.right, side: 'R' }
  if (vision.left?.visible) return { hand: vision.left, side: 'L' }
  
  if (vision.right?.detected && vision.left?.detected) {
    return vision.right.confidence >= vision.left.confidence
      ? { hand: vision.right, side: 'R' }
      : { hand: vision.left, side: 'L' }
  }
  if (vision.right?.detected) return { hand: vision.right, side: 'R' }
  if (vision.left?.detected) return { hand: vision.left, side: 'L' }
  
  return { hand: null, side: null }
}

function getFocusLabel(hand: HandCoord | null, vision: VisionRef): string {
  if (vision.mode === 'error') return vision.message
  if (!vision.active) return 'กำลังเปิดกล้อง'
  return getHandMessage(hand)
}

function CameraPreview({ vision, compact = false, holdProgress = 0 }: CameraPreviewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { hand, side } = useMemo(() => pickHandInfo(vision), [vision.left, vision.right])
  const focusLabel = getFocusLabel(hand, vision)
  const progress = Math.max(0, Math.min(1, holdProgress))

  useEffect(() => {
    const video = videoRef.current
    const stream = getCameraStream()
    if (!video || !stream) return

    if (video.srcObject !== stream) {
      video.srcObject = stream
    }
    void video.play().then(() => {
      bindVideoElement(video)
    }).catch(() => {})
    
    return () => {
      bindVideoElement(null)
    }
  }, [vision.mode, vision.active, vision.stats.fps])

  return (
    <div className={`camera-preview ${compact ? 'compact' : 'full-size'} ${hand?.active ? 'tracking' : ''}`}
         style={!compact ? { position: 'fixed', inset: 0, width: '100vw', height: '100vh', zIndex: 1, borderRadius: 0, border: 'none' } : {}}>
      <video ref={videoRef} className="camera-video mirror" playsInline muted style={!compact ? { objectFit: 'cover' } : {}} />
      <svg className={`camera-skeleton ${hand ? `focus-${hand.focus}` : ''}`} viewBox="0 0 100 100" aria-hidden="true" preserveAspectRatio="none">
        {hand?.landmarks.length
          ? HAND_LINES.map(([start, end]) => {
              const a = hand.landmarks[start]
              const b = hand.landmarks[end]
              if (!a || !b) return null
              return (
                <line
                  key={`${start}-${end}`}
                  x1={a.x * 100}
                  y1={a.y * 100}
                  x2={b.x * 100}
                  y2={b.y * 100}
                />
              )
            })
          : null}
        {hand?.landmarks.map((point, index) => (
          <circle key={index} cx={point.x * 100} cy={point.y * 100} r={index === 0 ? 1.5 : 0.8} />
        ))}
      </svg>
      <div className="camera-frame" aria-hidden="true" style={!compact ? { inset: '5%', width: '90%', height: '90%' } : {}} />
      
      {!compact && (
        <div className="camera-notifications" style={{ position: 'absolute', top: '16px', left: '16px', zIndex: 2 }}>
          {side && <div className="hand-badge">{side}</div>}
          <div className="status-card" style={{ display: 'none' }}>
            <span>{focusLabel}</span>
            <div className="progress-bar-bg">
              <div className="progress-bar-fill" style={{ width: `${progress * 100}%` }} />
            </div>
          </div>
        </div>
      )}
      
      {compact && (
        <div className="camera-status">
          <span>{focusLabel}</span>
          {side && <strong className="compact-side">{side}</strong>}
        </div>
      )}
    </div>
  )
}

export default CameraPreview
