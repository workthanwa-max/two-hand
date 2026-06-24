import { useCallback, useEffect, useState } from 'react'
import GameCanvas from './components/GameCanvas'
import GameOver from './components/GameOver'
import HandStatusPanel from './components/HandStatusPanel'
import HUD from './components/HUD'
import StartScreen from './components/StartScreen'
import { getLevelConfig, type ControlMode, type GameSnapshot, type PlayLevel } from './game/state'
import useHandTracking from './hooks/useHandTracking'
import useBGM from './hooks/useBGM'
import { startMediaPipeWorker, stopMockVision } from './vision'
import CameraPreview from './components/CameraPreview'
import type { HandCoord, VisionRef } from './vision'
import './App.css'
import PermissionScreen from './components/PermissionScreen'

type AppPhase = 'menu' | 'level-select' | 'control' | 'permission' | 'camera-loading' | 'hand-confirm' | 'countdown' | 'playing' | 'gameover'
type ThemeName = 'focus' | 'neon'

const initialSnapshot: GameSnapshot = {
  phase: 'ready',
  level: 1,
  score: 0,
  health: 100,
  maxHealth: 100,
  combo: 0,
  playtime: 0,
  deflects: 0,
  nutrients: 0,
}

function getRewardNotice(snapshot: GameSnapshot): string {
  const levelConfig = getLevelConfig(snapshot.level as PlayLevel)
  const ratio = snapshot.score / levelConfig.rewardScore

  if (ratio >= 1.4) {
    return 'แจ้งเจ้าหน้าที่: ได้รับรางวัลระดับ 4 — ผู้พิทักษ์สมอง'
  }
  if (ratio >= 1) {
    return 'แจ้งเจ้าหน้าที่: ได้รับรางวัลระดับ 3 — นักต้านภัยยาเสพติด'
  }
  if (ratio >= 0.65) {
    return 'แจ้งเจ้าหน้าที่: ได้รับรางวัลระดับ 2 — นักเลือกสิ่งดี'
  }
  return 'แจ้งเจ้าหน้าที่: ได้รับรางวัลระดับ 1 — กำลังใจคนกล้าเล่น'
}


function pickFocusedHand(vision: VisionRef): HandCoord | null {
  const hands = [vision.right, vision.left].filter((hand): hand is HandCoord => Boolean(hand?.visible && hand.active))
  if (hands.length === 0) return null
  return hands.sort((a, b) => b.confidence - a.confidence)[0]
}

function hasFocusedHand(vision: VisionRef): boolean {
  const hand = pickFocusedHand(vision)
  if (!hand) return false
  return hand.active && hand.landmarks.length >= 18
}

function App() {
  const [phase, setPhase] = useState<AppPhase>('menu')
  const [selectedLevel, setSelectedLevel] = useState<PlayLevel>(1)
  const [theme] = useState<ThemeName>('focus')
  const [controlMode, setControlMode] = useState<ControlMode>('mouse')
  const [cameraEnabled, setCameraEnabled] = useState(false)
  const [cameraSession, setCameraSession] = useState(0)
  const [handHoldMs, setHandHoldMs] = useState(0)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [snapshot, setSnapshot] = useState<GameSnapshot>(initialSnapshot)

  const vision = useHandTracking(cameraEnabled, cameraSession)
  const handFocused = hasFocusedHand(vision)

  // Initialize BGM with a placeholder/default path.
  // The user will replace the file at public/bgm.mp3
  const { playBGM, pauseBGM } = useBGM({ src: '/bgm.mp3', volume: 0.4 })

  useEffect(() => {
    // Play BGM in all phases EXCEPT when playing the actual game
    if (phase === 'playing') {
      pauseBGM()
    } else {
      playBGM()
    }
  }, [phase, playBGM, pauseBGM])

  const openSetup = useCallback(() => {
    setPhase('level-select')
  }, [])

  const handleSelectLevel = useCallback((level: PlayLevel) => {
    setSelectedLevel(level)
    setSnapshot({ ...initialSnapshot, level })
    setControlMode('mouse')
    setCameraEnabled(false)
    setHandHoldMs(0)
    setCountdown(null)
    setPhase('control')
  }, [])

  const beginCountdown = useCallback(() => {
    setCountdown(3)
    setPhase('countdown')
  }, [])

  const resetCameraFlow = useCallback(() => {
    setCameraEnabled(false)
    setHandHoldMs(0)
    setCountdown(null)
  }, [])

  const chooseMouse = useCallback(() => {
    setControlMode('mouse')
    resetCameraFlow()
    setHandHoldMs(0)
    beginCountdown()
  }, [beginCountdown, resetCameraFlow])

  const chooseBody = useCallback(() => {
    stopMockVision()
    setControlMode('body')
    setHandHoldMs(0)
    setCountdown(null)
    setCameraSession((session) => session + 1)
    setPhase('permission')
  }, [])

  const handleRequestCamera = useCallback(async () => {
    stopMockVision()
    setCameraSession((s) => s + 1)
    setCameraEnabled(true)
    setPhase('camera-loading')
    await startMediaPipeWorker()
  }, [])

  const handlePermissionBack = useCallback(() => {
    resetCameraFlow()
    setPhase('control')
  }, [resetCameraFlow])

  useEffect(() => {
    if (phase === 'camera-loading' && cameraEnabled && vision.mode === 'camera') {
      setPhase('hand-confirm')
    }
    if (phase === 'camera-loading' && vision.mode === 'error') {
      // stay on camera-loading so UI can show error via vision.message; do not auto-back
    }
  }, [cameraEnabled, phase, vision.mode])

  useEffect(() => {
    if (phase !== 'hand-confirm' || controlMode !== 'body' || !cameraEnabled || vision.mode !== 'camera') return undefined

    let last = performance.now()
    const timer = window.setInterval(() => {
      const now = performance.now()
      const dt = now - last
      last = now
      setHandHoldMs((current) => (handFocused ? Math.min(3000, current + dt) : 0))
    }, 100)

    return () => window.clearInterval(timer)
  }, [cameraEnabled, controlMode, handFocused, phase, vision.mode])

  useEffect(() => {
    if (phase === 'hand-confirm' && controlMode === 'body' && handHoldMs >= 3000) {
      beginCountdown()
    }
  }, [beginCountdown, controlMode, handHoldMs, phase])

  useEffect(() => {
    if (phase !== 'countdown' || countdown === null) return undefined

    if (countdown <= 0) {
      setPhase('playing')
      setCountdown(null)
      return undefined
    }

    const timer = window.setTimeout(() => setCountdown((value) => (value === null ? null : value - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [countdown, phase])

  const handleGameOver = useCallback((finalSnapshot: GameSnapshot) => {
    setSnapshot(finalSnapshot)
    setPhase('gameover')
    setCameraEnabled(false)
  }, [])

  const holdProgress = handHoldMs / 3000

  // Replace menu flow with StartScreen and permission flow
  return (
    <main className={`app-shell theme-${theme}`}>
      {phase === 'playing' && (
        <>
          <GameCanvas
            key={`${selectedLevel}-${controlMode}`}
            level={selectedLevel}
            controlMode={controlMode}
            onSnapshot={setSnapshot}
            onGameOver={handleGameOver}
          />
          <HUD snapshot={snapshot} controlMode={controlMode} vision={vision} />
          {controlMode === 'body' && <CameraPreview vision={vision} compact holdProgress={1} />}
        </>
      )}

      {phase === 'menu' && (
        <div className="overlay-wrapper">
          <StartScreen onStart={openSetup} />
        </div>
      )}


      {phase === 'level-select' && (
        <div className="overlay-wrapper setup-wrapper">
          <section className="overlay-panel setup-panel">
             <p className="eyebrow">เลือกความยาก</p>
             <h1>ระดับของเกม</h1>
             <p className="intro">เลือกระดับความยากที่เหมาะกับคุณ เพื่อเริ่มภารกิจปกป้องสมอง</p>
             <div className="level-grid">
               {[1, 2, 3, 4].map((l) => {
                 const config = getLevelConfig(l as PlayLevel)
                 return (
                   <button
                     key={l}
                     type="button"
                     className="level-card"
                     onClick={() => handleSelectLevel(l as PlayLevel)}
                   >
                     <strong>{config.title}</strong>
                     <span>{config.subtitle}</span>
                   </button>
                 )
               })}
             </div>
          </section>
        </div>
      )}

      {phase === 'control' && (
        <div className="overlay-wrapper setup-wrapper">
          <section className="overlay-panel setup-panel">
             <p className="eyebrow">เลือกวิธีคุม</p>
             <h1>คุมโล่</h1>
             <p className="intro">เลือกอย่างใดอย่างหนึ่ง ระบบจะไม่สลับโหมดระหว่างเล่น</p>

             <div className="control-grid">
              <button
                type="button"
                className="control-card"
                onClick={chooseMouse}
              >
                <strong>เมาส์</strong>
                <span>แม่น · เบาเครื่อง</span>
                <small>คลิกเพื่อเริ่มนับถอยหลัง</small>
              </button>
              <button
                type="button"
                className="control-card"
                onClick={chooseBody}
              >
                <strong>ร่างกาย</strong>
                <span>ใช้มือหมุนโล่</span>
                <small>ขอเปิดกล้องทันที</small>
              </button>
            </div>
          </section>
        </div>
      )}

      {phase === 'hand-confirm' && (
        <div className="fullscreen-hud-wrapper">
          <CameraPreview vision={vision} compact={false} holdProgress={holdProgress} />
          <div className="hud-overlay-center">
             <div className="hud-overlay-title">
             <p className="eyebrow">ตรวจมือ</p>
             <h1>ยกมือค้าง 3 วิ</h1>
          </div>
             <HandStatusPanel controlMode={controlMode} vision={vision} holdProgress={holdProgress} setup />
          </div>
        </div>
      )}

      {phase === 'permission' && (
        <div className="overlay-wrapper setup-wrapper">
          <PermissionScreen
            status={vision.mode}
            errorMessage={vision.mode === 'error' ? vision.message : ''}
            onRequestCamera={handleRequestCamera}
            onBack={handlePermissionBack}
          />
        </div>
      )}

      {phase === 'camera-loading' && (
        <div className="overlay-wrapper setup-wrapper">
          <section className="overlay-panel setup-panel">
            <p className="eyebrow">เปิดกล้อง</p>
            <h1>ขอสิทธิ์</h1>
            <p className="intro">{vision.mode === 'error' ? vision.message : 'อนุญาตกล้องเพื่อใช้มือควบคุมโล่'}</p>
            <div className="confirm-copy">
              <strong>{vision.mode === 'error' ? 'ไม่สำเร็จ' : 'รอสักครู่'}</strong>
              <span>{vision.mode === 'error' ? 'กลับไปเลือกใหม่ได้' : vision.message}</span>
            </div>
            {vision.mode === 'error' && (
              <div className="actions">
                <button type="button" onClick={() => handleRequestCamera()}>
                  ลองอีกครั้ง
                </button>
              </div>
            )}
          </section>
        </div>
      )}

      {phase === 'countdown' && (
        <>
          {controlMode === 'body' && <CameraPreview vision={vision} compact holdProgress={1} />}
          <div className="countdown-screen">
            <div className="countdown-card">
              <strong>{countdown}</strong>
            </div>
          </div>
        </>
      )}

      {rulesOpen && (
        <section className="rules-modal" role="dialog" aria-modal="true" aria-label="กติกาและวิธีเล่น">
          <div className="rules-content">
            <button type="button" className="close-button" onClick={() => setRulesOpen(false)}>
              ปิด
            </button>
            <p className="eyebrow">กติกา / วิธีเล่น</p>
            <h2>ภารกิจปกป้องสมองจากภัยยาเสพติด</h2>
            <ul>
              <li>เลือกเมาส์หรือร่างกายก่อนเริ่ม เล่นแล้วระบบจะล็อกโหมดนั้น</li>
              <li>โหมดร่างกายต้องยกมือค้าง 3 วิ แล้วนับถอยหลัง 3 วิ</li>
              <li>ปัดไอคอนสิ่งเสพติด เช่น เม็ดยา เข็ม ควันพิษ ออกจากสมอง</li>
              <li>ปล่อยให้ไอคอนสุขภาพ เช่น หัวใจ วิตามิน น้ำดี เข้าสู่สมองเพื่อฟื้นพลัง</li>
              <li>วัตถุหนึ่งชิ้นนับผลแค่ครั้งเดียว เพื่อให้คะแนนยุติธรรม</li>
              <li>หลังจบเกม ดูข้อความ “ได้รับรางวัลระดับไหน” แล้วแจ้งเจ้าหน้าที่ประจำบูธ</li>
            </ul>
            <div className="reward-list">
              <strong>ระดับรางวัล</strong>
              <span>ระดับ 1: กำลังใจคนกล้าเล่น</span>
              <span>ระดับ 2: นักเลือกสิ่งดี</span>
              <span>ระดับ 3: นักต้านภัยยาเสพติด</span>
              <span>ระดับ 4: ผู้พิทักษ์สมอง</span>
            </div>
          </div>
        </section>
      )}

      {phase === 'gameover' && (
        <div className="overlay-wrapper">
          <GameOver
            snapshot={snapshot}
            rewardNotice={getRewardNotice(snapshot)}
            submitState={{ status: 'idle', message: '' }}
            onRestart={openSetup}
            onMenu={() => {
              setCameraEnabled(false)
              setPhase('menu')
            }}
          />
        </div>
      )}
    </main>
  )
}

export default App
