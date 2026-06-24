import { useEffect, useState, useRef } from 'react'
import { getVisionRef, stopMediaPipeWorker, subscribeVision, type VisionRef } from '../vision'

export default function useHandTracking(enabled: boolean, sessionKey = 0) {
  const [vision, setVision] = useState<VisionRef>(() => ({ ...getVisionRef() }))
  const lastUpdateRef = useRef(performance.now())

  useEffect(() => {
    const unsubscribe = subscribeVision((next) => {
      setVision((prev) => {
        const now = performance.now()
        const statusChanged = prev.mode !== next.mode || prev.tracking !== next.tracking
        if (statusChanged || now - lastUpdateRef.current >= 250) {
          lastUpdateRef.current = now
          return {
            ...next,
            left: next.left ? { ...next.left, landmarks: [...next.left.landmarks] } : null,
            right: next.right ? { ...next.right, landmarks: [...next.right.landmarks] } : null,
            stats: { ...next.stats },
          }
        }
        return prev
      })
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    if (!enabled) {
      stopMediaPipeWorker()
    }

    return () => {
      stopMediaPipeWorker()
    }
  }, [enabled, sessionKey])

  return vision
}
