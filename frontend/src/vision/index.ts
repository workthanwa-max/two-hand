import { requestCameraStream, stopCameraStream } from './camera'
import {
  VisionHandler,
  type HandCoord,
  type VisionMode,
  type VisionSnapshot,
  type HandLandmark,
  type HandFocus,
} from './VisionHandler'

export type { HandCoord, VisionMode, HandLandmark, HandFocus }

export type VisionRef = {
  left: HandCoord | null
  right: HandCoord | null
  tracking: boolean
  active: boolean
  mode: VisionMode
  message: string
  stats: { fps: number; inferenceMs: number; drops: number }
}

const sharedRef: VisionRef = {
  left: null,
  right: null,
  tracking: false,
  active: false,
  mode: 'idle',
  message: 'ใช้เมาส์ควบคุม',
  stats: { fps: 0, inferenceMs: 0, drops: 0 },
}

const listeners = new Set<(ref: VisionRef) => void>()
let cameraStream: MediaStream | null = null
let videoEl: HTMLVideoElement | null = null
let visionHandler: VisionHandler | null = null

function setVisionState(next: Partial<VisionRef>) {
  Object.assign(sharedRef, next)
  listeners.forEach((listener) => listener(sharedRef))
}

const handleSnapshot = (snapshot: VisionSnapshot) => {
  const tracking = snapshot.tracking
  setVisionState({
    left: snapshot.left,
    right: snapshot.right,
    tracking,
    active: true,
    mode: visionHandler?.activeMode ?? 'idle',
    message: tracking ? 'พร้อม' : 'กำลังค้นหามือ',
    stats: {
      fps: snapshot.stats.fps,
      inferenceMs: snapshot.stats.inferenceMs,
      drops: snapshot.stats.droppedFrames,
    },
  })
}

export function bindVideoElement(video: HTMLVideoElement | null) {
  videoEl = video
  if (visionHandler) {
    visionHandler.setVideoElement(video)
    if (video) {
      visionHandler.resume()
    }
  }
}

export async function startMediaPipeWorker() {
  if (sharedRef.mode === 'camera') return sharedRef

  stopMediaPipeWorker()
  setVisionState({ active: true, mode: 'loading', message: 'กำลังขอสิทธิ์กล้อง' })

  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('ไม่รองรับการเปิดกล้อง (ต้องใช้ HTTPS หรือ localhost)')
    }

    cameraStream = await requestCameraStream()

    setVisionState({ mode: 'camera', message: 'กำลังโหลดตัวจับมือ' })

    visionHandler = new VisionHandler({
      onSnapshot: handleSnapshot,
      videoElement: videoEl,
      fps: 30,
    })

    await visionHandler.start()
  } catch (error: any) {
    stopMediaPipeWorker()
    let errorMessage = 'เปิดกล้องไม่ได้'
    
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
      errorMessage = 'กรุณาอนุญาตการใช้งานกล้องในเบราว์เซอร์'
    } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      errorMessage = 'ไม่พบกล้องในอุปกรณ์นี้'
    } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
      errorMessage = 'กล้องกำลังถูกใช้งานโดยแอปพลิเคชันอื่น'
    } else if (error instanceof Error) {
      errorMessage = error.message
    }

    setVisionState({
      mode: 'error',
      message: errorMessage,
    })
  }

  return sharedRef
}

export function stopMediaPipeWorker() {
  if (visionHandler) {
    visionHandler.dispose()
    visionHandler = null
  }
  if (cameraStream) {
    stopCameraStream(cameraStream)
    cameraStream = null
  }
  
  setVisionState({ left: null, right: null, tracking: false, active: false, mode: 'idle' })
}

export function stopMockVision() { stopMediaPipeWorker() }
export function getVisionRef() { return sharedRef }
export function getCameraStream() { return cameraStream }
export function subscribeVision(listener: (ref: VisionRef) => void): () => void {
  listeners.add(listener)
  listener(sharedRef)
  return () => {
    listeners.delete(listener)
  }
}

export function getHandMessage(hand: HandCoord | null) {
  if (!hand) return 'กำลังค้นหามือ'
  if (!hand.visible) return 'ขยับเข้ามาในกล้อง'
  switch (hand.focus) {
    case 'too-small': return 'มือเล็กไป ใกล้เข้ามาหน่อย'
    case 'too-large': return 'มือใหญ่ไป ถอยออกไปนิด'
    case 'edge': return 'มืออยู่ขอบจอ ให้อยู่ตรงกลาง'
    case 'low-confidence': return 'เห็นมือไม่ชัด'
    case 'ready': return 'ตรวจพบมือแล้ว'
  }
}
