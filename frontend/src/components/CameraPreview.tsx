import { useEffect, useMemo, useRef } from 'react'
import { getCameraStream, getHandMessage, bindVideoElement, getVisionRef, type HandCoord, type VisionRef } from '../vision'

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

  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (compact) return

    let rafId: number
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    function tick() {
      const rect = canvas!.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) {
        rafId = requestAnimationFrame(tick)
        return
      }
      
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      canvas!.width = rect.width * dpr
      canvas!.height = rect.height * dpr
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx!.clearRect(0, 0, rect.width, rect.height)

      let drawW = rect.width
      let drawH = rect.height
      let offsetX = 0
      let offsetY = 0
      const video = videoRef.current
      if (video && video.videoWidth > 0 && video.videoHeight > 0) {
        const scaleX = rect.width / video.videoWidth
        const scaleY = rect.height / video.videoHeight
        const scale = Math.max(scaleX, scaleY)
        drawW = video.videoWidth * scale
        drawH = video.videoHeight * scale
        offsetX = (rect.width - drawW) / 2
        offsetY = (rect.height - drawH) / 2
      }

      const currentVision = getVisionRef()
      const currentHandInfo = pickHandInfo(currentVision)
      const currentHand = currentHandInfo.hand
      const currentSide = currentHandInfo.side

      if (currentHand?.landmarks?.length) {
        ctx!.beginPath()
        ctx!.strokeStyle = currentSide === 'L' ? "rgba(76, 201, 240, 0.86)" : "rgba(61, 220, 151, 0.86)"
        ctx!.lineWidth = 8
        ctx!.lineCap = 'round'
        
        HAND_LINES.forEach(([start, end]) => {
          const a = currentHand.landmarks[start]
          const b = currentHand.landmarks[end]
          if (a && b) {
            ctx!.moveTo(offsetX + a.x * drawW, offsetY + a.y * drawH)
            ctx!.lineTo(offsetX + b.x * drawW, offsetY + b.y * drawH)
          }
        })
        ctx!.stroke()

        currentHand.landmarks.forEach((point, index) => {
          const isPalm = index === 9
          ctx!.beginPath()
          ctx!.arc(offsetX + point.x * drawW, offsetY + point.y * drawH, isPalm ? 20 : 8, 0, Math.PI * 2)
          ctx!.fillStyle = isPalm ? '#ffff00' : 'rgba(255, 255, 255, 0.6)'
          ctx!.fill()
        })
      }

      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [compact])

  return (
    <div className={`camera-preview ${compact ? 'compact' : 'full-size'} ${hand?.active ? 'tracking' : ''}`}
         style={!compact ? { position: 'fixed', inset: 0, width: '100vw', height: '100vh', zIndex: 1, borderRadius: 0, border: 'none' } : {}}>
      <video ref={videoRef} className="camera-video mirror" playsInline muted style={!compact ? { objectFit: 'cover' } : {}} />
      
      {!compact && (
        <canvas 
          ref={canvasRef} 
          className="camera-canvas" 
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1 }} 
        />
      )}
      
      {!compact && (
        <div className="camera-notifications" style={{ position: 'absolute', top: '16px', left: '16px', zIndex: 2 }}>
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
