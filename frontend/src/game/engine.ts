import { bindPointerInput } from './input'
import {
  clamp,
  intersectsCore,
  intersectsShield,
  isOutsideBounds,
  normalizeAngle,
  reflectFromCore,
} from './physics'
import { spawnEntity, spawnParticles, spawnText } from './pooling'
import { renderGame } from './render'
import {
  createGameState,
  getLevelConfig,
  resetGameState,
  resizeGameState,
  toSnapshot,
  type EntityKind,
  type ControlMode,
  type GameSnapshot,
  type GameState,
  type PlayLevel,
} from './state'

export type GameEngine = {
  state: GameState
  start: () => void
  restart: () => void
  dispose: () => void
}

type EngineOptions = {
  canvas: HTMLCanvasElement
  level: PlayLevel
  controlMode: ControlMode
  onSnapshot: (snapshot: GameSnapshot) => void
  onGameOver: (snapshot: GameSnapshot) => void
}

function spawnIncoming(state: GameState, kind: EntityKind): void {
  const levelConfig = getLevelConfig(state.level)
  const edge = Math.floor(Math.random() * 4)
  const margin = 70
  const x = edge === 0 ? -margin : edge === 1 ? state.width + margin : Math.random() * state.width
  const y = edge === 2 ? -margin : edge === 3 ? state.height + margin : Math.random() * state.height
  const aimX = state.core.x
  const aimY = state.core.y
  const dx = aimX - x
  const dy = aimY - y
  const distance = Math.max(1, Math.hypot(dx, dy))
  const speed =
    kind === 'toxin'
      ? (110 + state.difficulty * 45 + Math.random() * 60) * levelConfig.speed
      : (80 + state.difficulty * 15 + Math.random() * 40) * levelConfig.speed
  const angle = Math.atan2(dy, dx)
  const radius = kind === 'toxin' ? 14 + Math.random() * 7 : 12 + Math.random() * 5
  spawnEntity(state, kind, x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, radius)
  if (distance < 1) {
    state.shake = Math.max(state.shake, 0.05)
  }
}

function updateShield(state: GameState, dt: number): void {
  const t = Math.min(1, dt * 15)
  state.input.x += (state.input.targetX - state.input.x) * t
  state.input.y += (state.input.targetY - state.input.y) * t

  const targetAngle = Math.atan2(state.input.y - state.core.y, state.input.x - state.core.x)
  state.shield.previousAngle = state.shield.angle
  state.shield.angle = targetAngle
  const delta = normalizeAngle(state.shield.angle - state.shield.previousAngle)
  state.shield.angularVelocity = delta / Math.max(dt, 0.001)
}

function updateSpawning(state: GameState, dt: number): void {
  const levelConfig = getLevelConfig(state.level)
  // stronger difficulty scaling: time weights more, and level step is larger
  state.difficulty = 1 + state.elapsed / 16 + (state.level - 1) * 0.45
  state.spawnTimer -= dt
  state.nutrientTimer -= dt

  if (state.spawnTimer <= 0) {
    const nutrientChance = state.level === 4 ? 0.15 : 0.28 // Less nutrients on level 4
    const isNutrient = Math.random() < nutrientChance
    spawnIncoming(state, isNutrient ? 'nutrient' : 'toxin')
    
    const nextSpawnBase = clamp(0.9 - state.difficulty * 0.085, 0.25, 0.9) * levelConfig.spawn
    state.spawnTimer = nextSpawnBase * (0.8 + Math.random() * 0.4)
  }

  if (state.nutrientTimer <= 0) {
    spawnIncoming(state, 'nutrient')
    state.nutrientTimer = (6.0 + Math.random() * 4.0) * Math.max(0.8, levelConfig.spawn)
  }
}

function updateEntities(state: GameState, dt: number): void {
  state.entities.forEach((entity) => {
    if (!entity.active) return
    entity.age += dt
    entity.x += entity.vx * dt
    entity.y += entity.vy * dt

    if (!entity.reacted && intersectsShield(entity, state.core, state.shield)) {
      entity.reacted = true
      reflectFromCore(entity, state.core, state.shield)
      
      if (entity.kind === 'toxin') {
        const points = Math.round(25 + state.combo * 4 + Math.abs(state.shield.angularVelocity) * 0.02)
        state.score += points
        state.combo += 1
        state.deflects += 1
        state.shake = Math.max(state.shake, 0.55)
        state.flash = Math.max(state.flash, 0.55)
        spawnParticles(state, entity.x, entity.y, '#f0abfc', 16, 260)
        spawnText(state, entity.x, entity.y - 8, `+${points}`, '#f5d0fe')
        playDeflectSound(state.combo)
      } else {
        spawnParticles(state, entity.x, entity.y, '#86efac', 8, 150)
        spawnText(state, entity.x, entity.y - 8, 'พลาด', '#bbf7d0')
      }
      return
    }

    if (!entity.reacted && intersectsCore(entity, state.core)) {
      entity.reacted = true
      if (entity.kind === 'toxin') {
        // make toxin damage scale harder with difficulty and level
        const damage = 12 + state.difficulty * 6 + (state.level - 1) * 3
        state.core.health -= damage
        state.combo = 0
        state.shake = Math.max(state.shake, 0.95)
        spawnParticles(state, entity.x, entity.y, '#fb7185', 28, 360)
        spawnText(state, state.core.x, state.core.y - state.core.radius - 12, `-${Math.round(damage)}`, '#fecdd3')
        playDamageSound()
      } else {
        const heal = 16
        state.core.health = Math.min(state.core.maxHealth, state.core.health + heal)
        state.score += 35
        state.nutrients += 1
        spawnParticles(state, entity.x, entity.y, '#86efac', 20, 220)
        spawnText(state, entity.x, entity.y - 8, `+${heal} HP`, '#bbf7d0')
        playHealSound()
      }
      entity.active = false
      return
    }

    if (isOutsideBounds(entity, state.width, state.height) || entity.age > 9) {
      entity.active = false
    }
  })
}

function updateParticles(state: GameState, dt: number): void {
  state.particles.forEach((particle) => {
    if (!particle.active) return
    particle.life -= dt
    particle.x += particle.vx * dt
    particle.y += particle.vy * dt
    particle.vx *= 1 - dt * 1.6
    particle.vy *= 1 - dt * 1.6
    if (particle.life <= 0) particle.active = false
  })

  state.texts.forEach((text) => {
    if (!text.active) return
    text.life -= dt
    text.y += text.vy * dt
    if (text.life <= 0) text.active = false
  })
}

function updateGame(state: GameState, dt: number): void {
  if (state.phase !== 'running') return
  state.elapsed += dt
  state.score += dt * (2 + state.combo * 0.08)
  updateShield(state, dt)
  updateSpawning(state, dt)
  updateEntities(state, dt)
  updateParticles(state, dt)
  state.shake = Math.max(0, state.shake - dt * 2.9)
  state.flash = Math.max(0, state.flash - dt * 3.8)

  if (state.core.health <= 0) {
    state.phase = 'gameover'
  }
}

function resizeCanvas(canvas: HTMLCanvasElement, state: GameState): void {
  const rect = canvas.getBoundingClientRect()
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
  const width = Math.max(320, rect.width)
  const height = Math.max(360, rect.height)
  canvas.width = Math.floor(width * dpr)
  canvas.height = Math.floor(height * dpr)
  resizeGameState(state, width, height, dpr)
}

export function createGameEngine({ canvas, level, controlMode, onSnapshot, onGameOver }: EngineOptions): GameEngine {
  const state = createGameState(level, controlMode)
  const ctx = canvas.getContext('2d')
  let raf = 0
  let lastTime = performance.now()
  let snapshotTimer = 0
  let gameOverSent = false

  if (!ctx) {
    throw new Error('Canvas 2D context is unavailable')
  }

  const context = ctx
  const unbindInput = bindPointerInput(canvas, state, controlMode)

  function frame(now: number): void {
    const frameWorkStart = performance.now()
    const dt = Math.min(0.033, (now - lastTime) / 1000)
    lastTime = now
    updateGame(state, dt)
    renderGame(context, state)

    snapshotTimer += dt
    if (snapshotTimer >= 0.1 || state.phase === 'gameover') {
      snapshotTimer = 0
      const snapshot = toSnapshot(state)
      onSnapshot(snapshot)
      if (state.phase === 'gameover' && !gameOverSent) {
        gameOverSent = true
        onGameOver(snapshot)
      }
    }

    const frameWorkMs = performance.now() - frameWorkStart
    if (frameWorkMs > 33) {
      state.ecoMode = true
    }

    raf = requestAnimationFrame(frame)
  }

  function start(): void {
    resizeCanvas(canvas, state)
    resetGameState(state, level, controlMode)
    lastTime = performance.now()
    gameOverSent = false
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(frame)
  }

  function restart(): void {
    start()
  }

  function handleResize(): void {
    resizeCanvas(canvas, state)
  }

  window.addEventListener('resize', handleResize)
  resizeCanvas(canvas, state)
  renderGame(context, state)

  return {
    state,
    start,
    restart,
    dispose: () => {
      cancelAnimationFrame(raf)
      unbindInput()
      window.removeEventListener('resize', handleResize)
    },
  }
}

let audioCtx: AudioContext | null = null

function initAudio() {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume()
    }
    return audioCtx
  } catch (e) {
    return null
  }
}

function playDeflectSound(combo: number) {
  const ctx = initAudio()
  if (!ctx) return
  try {
    const t = ctx.currentTime
    const duration = 0.15
    
    // Punchy hit sound
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    
    // Base frequency depends on combo to give a rising effect
    const baseFreq = 600 + Math.min(combo * 50, 600)
    
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(baseFreq, t)
    osc.frequency.exponentialRampToValueAtTime(100, t + duration)
    
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(0.4, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration)
    
    osc.connect(gain)
    gain.connect(ctx.destination)
    
    osc.start(t)
    osc.stop(t + duration)
  } catch (e) {}
}

function playDamageSound() {
  const ctx = initAudio()
  if (!ctx) return
  try {
    const t = ctx.currentTime
    const duration = 0.4
    
    // Deep thud / Explosion
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    
    osc.type = 'square'
    osc.frequency.setValueAtTime(100, t)
    osc.frequency.exponentialRampToValueAtTime(10, t + duration)
    
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(0.5, t + 0.05)
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration)
    
    // Add distortion for a rougher sound
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(800, t)
    filter.frequency.linearRampToValueAtTime(100, t + duration)
    
    osc.connect(filter)
    filter.connect(gain)
    gain.connect(ctx.destination)
    
    osc.start(t)
    osc.stop(t + duration)
  } catch (e) {}
}

function playHealSound() {
  const ctx = initAudio()
  if (!ctx) return
  try {
    const t = ctx.currentTime
    
    // Layer 1: Rapid Arpeggio / Magic Chime
    // Using an extended magic scale sequence
    const notes = [523.25, 659.25, 783.99, 1046.50, 1318.51, 1567.98] // C5, E5, G5, C6, E6, G6
    const stepDuration = 0.035
    
    notes.forEach((freq, index) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      
      const noteTime = t + index * stepDuration
      
      // Use square for a bright, classic arcade sound
      osc.type = 'square'
      osc.frequency.setValueAtTime(freq, noteTime)
      
      // Plucky envelope
      gain.gain.setValueAtTime(0, noteTime)
      gain.gain.linearRampToValueAtTime(0.12, noteTime + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.001, noteTime + stepDuration + 0.15)
      
      // Add a lowpass filter for a rounder, modern plucky sound
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.setValueAtTime(freq * 2, noteTime)
      filter.frequency.exponentialRampToValueAtTime(freq * 0.5, noteTime + 0.1)
      
      osc.connect(filter)
      filter.connect(gain)
      gain.connect(ctx.destination)
      
      osc.start(noteTime)
      osc.stop(noteTime + stepDuration + 0.15)
    })
    
    // Layer 2: Power-up Glissando Sweep
    const sweepOsc = ctx.createOscillator()
    const sweepGain = ctx.createGain()
    sweepOsc.type = 'sine'
    // Quick rise from 300 to 1200
    sweepOsc.frequency.setValueAtTime(300, t)
    sweepOsc.frequency.exponentialRampToValueAtTime(1200, t + 0.2)
    
    sweepGain.gain.setValueAtTime(0, t)
    sweepGain.gain.linearRampToValueAtTime(0.2, t + 0.05)
    sweepGain.gain.exponentialRampToValueAtTime(0.001, t + 0.3)
    
    sweepOsc.connect(sweepGain)
    sweepGain.connect(ctx.destination)
    sweepOsc.start(t)
    sweepOsc.stop(t + 0.3)

    // Layer 3: Satisfying High Sparkle
    const sparkleOsc = ctx.createOscillator()
    const sparkleGain = ctx.createGain()
    sparkleOsc.type = 'triangle'
    // Very high pitch with slight vibrato effect via ramp
    sparkleOsc.frequency.setValueAtTime(2000, t + 0.1)
    sparkleOsc.frequency.linearRampToValueAtTime(3500, t + 0.35)
    
    sparkleGain.gain.setValueAtTime(0, t + 0.1)
    sparkleGain.gain.linearRampToValueAtTime(0.1, t + 0.15)
    sparkleGain.gain.exponentialRampToValueAtTime(0.001, t + 0.5)
    
    sparkleOsc.connect(sparkleGain)
    sparkleGain.connect(ctx.destination)
    sparkleOsc.start(t + 0.1)
    sparkleOsc.stop(t + 0.5)
  } catch (e) {}
}
