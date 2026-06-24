import type { HandCoord } from '../vision'

export type GamePhase = 'ready' | 'running' | 'gameover'

export type EntityKind = 'toxin' | 'nutrient'

export type PlayLevel = 1 | 2 | 3 | 4

export type ControlMode = 'mouse' | 'body'

export type LevelConfig = {
  level: PlayLevel
  title: string
  subtitle: string
  speed: number
  spawn: number
  rewardScore: number
}

export type Entity = {
  active: boolean
  kind: EntityKind
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  value: number
  age: number
  hue: number
  icon: number
  reacted: boolean
}

export type Particle = {
  active: boolean
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  life: number
  maxLife: number
  color: string
}

export type FloatingText = {
  active: boolean
  x: number
  y: number
  vy: number
  life: number
  maxLife: number
  text: string
  color: string
}

export type InputState = {
  x: number
  y: number
  targetX: number
  targetY: number
  pointerActive: boolean
  activeHand?: HandCoord
  activeHandSide?: 'L' | 'R'
}

export type ShieldState = {
  angle: number
  previousAngle: number
  angularVelocity: number
  radius: number
  arc: number
  thickness: number
}

export type CoreState = {
  x: number
  y: number
  radius: number
  health: number
  maxHealth: number
}


export type GameSnapshot = {
  phase: 'ready' | 'running' | 'gameover'
  level: number
  score: number
  health: number
  maxHealth: number
  combo: number
  playtime: number
  deflects: number
  nutrients: number
  handLeft?: HandCoord
  handRight?: HandCoord
}

export type GameState = {
  phase: GamePhase
  level: PlayLevel
  width: number
  height: number
  dpr: number
  elapsed: number
  spawnTimer: number
  nutrientTimer: number
  difficulty: number
  score: number
  combo: number
  deflects: number
  nutrients: number
  shake: number
  flash: number
  ecoMode: boolean
  input: InputState
  core: CoreState
  shield: ShieldState
  entities: Entity[]
  particles: Particle[]
  texts: FloatingText[]
}

export const LEVELS: LevelConfig[] = [
  {
    level: 1,
    title: 'ระดับ 1: รู้ทัน',
    subtitle: 'เริ่มต้นช้า เหมาะกับผู้เล่นใหม่',
    speed: 0.85,
    spawn: 1.15,
    rewardScore: 350,
  },
  {
    level: 2,
    title: 'ระดับ 2: ตั้งสติ',
    subtitle: 'เร็วขึ้น ต้องแยกสิ่งดีและสิ่งเสพติด',
    speed: 1.05,
    spawn: 0.95,
    rewardScore: 800,
  },
  {
    level: 3,
    title: 'ระดับ 3: ต้านแรงกดดัน',
    subtitle: 'ลูกพิษถี่ขึ้น วัดสมาธิและการตัดสินใจ',
    speed: 1.2,
    spawn: 0.86,
    rewardScore: 1350,
  },
  {
    level: 4,
    title: 'ระดับ 4: ปกป้องอนาคต',
    subtitle: 'ความเร็วใกล้เคียงระดับสาม แต่ไอเทมฟื้นฟูน้อยลง',
    speed: 1.3,
    spawn: 0.75,
    rewardScore: 2000,
  },
]

export function getLevelConfig(level: PlayLevel): LevelConfig {
  return LEVELS.find((config) => config.level === level) ?? LEVELS[0]
}

export function createGameState(level: PlayLevel = 1, controlMode: ControlMode = 'mouse'): GameState {
  return {
    phase: 'ready',
    level,
    width: 960,
    height: 640,
    dpr: 1,
    elapsed: 0,
    spawnTimer: 0,
    nutrientTimer: 1.8,
    difficulty: 1,
    score: 0,
    combo: 0,
    deflects: 0,
    nutrients: 0,
    shake: 0,
    flash: 0,
    ecoMode: false,
    input: {
      x: 480,
      y: 320,
      targetX: 480,
      targetY: 320,
      pointerActive: false,
    },
    core: {
      x: 480,
      y: 320,
      radius: 42,
      health: 100,
      maxHealth: 100,
    },
    shield: {
      angle: -Math.PI / 2,
      previousAngle: -Math.PI / 2,
      angularVelocity: 0,
      radius: 108,
      arc: controlMode === 'body' ? (Math.PI * 2) / 3 : Math.PI / 2,
      thickness: 18,
    },
    entities: [],
    particles: [],
    texts: [],
  }
}

export function resetGameState(state: GameState, level: PlayLevel = state.level, controlMode: ControlMode = 'mouse'): void {
  const width = state.width
  const height = state.height
  const dpr = state.dpr
  const entities = state.entities
  const particles = state.particles
  const texts = state.texts
  Object.assign(state, createGameState(level, controlMode))
  state.width = width
  state.height = height
  state.dpr = dpr
  state.entities = entities
  state.particles = particles
  state.texts = texts
  state.entities.forEach((entity) => {
    entity.active = false
    entity.reacted = false
  })
  state.particles.forEach((particle) => {
    particle.active = false
  })
  state.texts.forEach((text) => {
    text.active = false
  })
  resizeGameState(state, width, height, dpr)
  state.phase = 'running'
}

export function resizeGameState(
  state: GameState,
  width: number,
  height: number,
  dpr: number,
): void {
  state.width = width
  state.height = height
  state.dpr = dpr
  state.core.x = width / 2
  state.core.y = height / 2
  state.core.radius = Math.max(34, Math.min(width, height) * 0.065)
  state.shield.radius = state.core.radius + Math.max(62, Math.min(width, height) * 0.11)
  state.shield.thickness = Math.max(14, Math.min(width, height) * 0.024)
  state.input.targetX = state.input.pointerActive ? state.input.targetX : state.core.x
  state.input.targetY = state.input.pointerActive ? state.input.targetY : state.core.y - state.shield.radius
  state.input.x = state.input.targetX
  state.input.y = state.input.targetY
}

export function toSnapshot(state: GameState): GameSnapshot {
  return {
    phase: state.phase,
    level: state.level,
    score: Math.floor(state.score),
    health: Math.max(0, Math.ceil(state.core.health)),
    maxHealth: state.core.maxHealth,
    combo: state.combo,
    playtime: state.elapsed,
    deflects: state.deflects,
    nutrients: state.nutrients,
  }
}
