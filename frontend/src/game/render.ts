import type { GameState } from './state'
import type { HandCoord } from '../vision'

function drawBackground(ctx: CanvasRenderingContext2D, state: GameState): void {
  const gradient = ctx.createRadialGradient(
    state.core.x,
    state.core.y,
    20,
    state.core.x,
    state.core.y,
    Math.max(state.width, state.height) * 0.68,
  )
  gradient.addColorStop(0, '#1e293b')
  gradient.addColorStop(0.48, '#0f172a')
  gradient.addColorStop(1, '#020617')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, state.width, state.height)

  if (!state.ecoMode) {
    ctx.save()
    ctx.globalAlpha = 0.45
    ctx.strokeStyle = '#334155'
    ctx.lineWidth = 1
    const gap = 48
    for (let x = (state.elapsed * 8) % gap; x < state.width; x += gap) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x - state.height * 0.28, state.height)
      ctx.stroke()
    }
    ctx.restore()
  }
}

function drawCore(ctx: CanvasRenderingContext2D, state: GameState): void {
  const { core } = state
  const pulse = 1 + Math.sin(state.elapsed * 5.4) * 0.035
  const healthRatio = Math.max(0, core.health / core.maxHealth)

  ctx.save()
  if (!state.ecoMode) {
    ctx.shadowBlur = 34
    ctx.shadowColor = `rgba(56, 189, 248, ${0.4 + healthRatio * 0.5})`
  }
  ctx.fillStyle = '#1e293b'
  ctx.beginPath()
  ctx.arc(core.x, core.y, core.radius * pulse, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#f472b6'
  ctx.strokeStyle = `rgba(56, 189, 248, ${0.6 + healthRatio * 0.4})`
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(core.x, core.y - core.radius * 0.62)
  ctx.bezierCurveTo(
    core.x - core.radius * 0.72,
    core.y - core.radius * 0.74,
    core.x - core.radius * 0.9,
    core.y + core.radius * 0.2,
    core.x - core.radius * 0.28,
    core.y + core.radius * 0.58,
  )
  ctx.bezierCurveTo(
    core.x,
    core.y + core.radius * 0.82,
    core.x + core.radius * 0.72,
    core.y + core.radius * 0.54,
    core.x + core.radius * 0.74,
    core.y - core.radius * 0.08,
  )
  ctx.bezierCurveTo(
    core.x + core.radius * 0.86,
    core.y - core.radius * 0.7,
    core.x + core.radius * 0.18,
    core.y - core.radius * 0.78,
    core.x,
    core.y - core.radius * 0.62,
  )
  ctx.fill()
  ctx.stroke()

  ctx.globalAlpha = 0.68
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(core.x, core.y - core.radius * 0.54)
  ctx.lineTo(core.x, core.y + core.radius * 0.5)
  ctx.moveTo(core.x - core.radius * 0.46, core.y - core.radius * 0.18)
  ctx.quadraticCurveTo(core.x - core.radius * 0.2, core.y - core.radius * 0.04, core.x, core.y - core.radius * 0.12)
  ctx.moveTo(core.x + core.radius * 0.46, core.y - core.radius * 0.2)
  ctx.quadraticCurveTo(core.x + core.radius * 0.18, core.y - core.radius * 0.02, core.x, core.y - core.radius * 0.12)
  ctx.moveTo(core.x - core.radius * 0.38, core.y + core.radius * 0.22)
  ctx.quadraticCurveTo(core.x - core.radius * 0.12, core.y + core.radius * 0.08, core.x, core.y + core.radius * 0.18)
  ctx.moveTo(core.x + core.radius * 0.38, core.y + core.radius * 0.2)
  ctx.quadraticCurveTo(core.x + core.radius * 0.12, core.y + core.radius * 0.08, core.x, core.y + core.radius * 0.18)
  ctx.stroke()
  ctx.restore()
}

const entitySpriteCache = new Map<string, HTMLCanvasElement>()

function getEntitySprite(
  kind: 'toxin' | 'nutrient',
  icon: number,
  radius: number,
  ecoMode: boolean,
): HTMLCanvasElement {
  const roundedRadius = Math.round(radius)
  const cacheKey = `${kind}-${icon}-${roundedRadius}-${ecoMode ? 'eco' : 'full'}`
  const cached = entitySpriteCache.get(cacheKey)

  if (cached) {
    return cached
  }

  const padding = ecoMode ? 2 : 24
  const size = (roundedRadius + padding) * 2
  const center = size / 2
  const sprite = document.createElement('canvas')
  const context = sprite.getContext('2d')

  sprite.width = size
  sprite.height = size

  if (!context) {
    entitySpriteCache.set(cacheKey, sprite)
    return sprite
  }

  const toxin = kind === 'toxin'

  if (!ecoMode) {
    context.shadowBlur = toxin ? 22 : 18
    context.shadowColor = toxin ? '#fb7185' : '#86efac'
  }

  if (!toxin) {
    context.fillStyle = 'rgba(20, 83, 45, 0.9)'
    context.beginPath()
    context.arc(center, center, roundedRadius * 1.12, 0, Math.PI * 2)
    context.fill()
  } else {
    context.fillStyle = 'rgba(127, 29, 29, 0.9)'
    context.beginPath()
    context.arc(center, center, roundedRadius * 1.12, 0, Math.PI * 2)
    context.fill()
  }

  context.shadowBlur = 0

  if (toxin) {
    const icons = ['💊', '💉', '🚬']
    const emoji = icons[icon % icons.length]
    context.font = `${Math.round(roundedRadius * 1.5)}px sans-serif`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(emoji, center, center)
  } else {
    const icons = ['🍎', '🥗', '📚', '❤️']
    const emoji = icons[icon % icons.length]
    context.font = `${Math.round(roundedRadius * 1.5)}px sans-serif`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(emoji, center, center)
  }

  entitySpriteCache.set(cacheKey, sprite)
  return sprite
}

function drawEntities(ctx: CanvasRenderingContext2D, state: GameState): void {
  state.entities.forEach((entity) => {
    if (!entity.active) return
    ctx.save()
    const toxin = entity.kind === 'toxin'
    ctx.globalAlpha = entity.reacted ? 0.42 : 1
    
    ctx.translate(entity.x, entity.y)
    ctx.rotate(entity.age * (toxin ? 2.3 : -1.6))
    
    const sprite = getEntitySprite(entity.kind, entity.icon, entity.radius, state.ecoMode)
    const halfSize = sprite.width / 2
    ctx.drawImage(sprite, -halfSize, -halfSize)
    
    ctx.restore()
  })
}

function drawShield(ctx: CanvasRenderingContext2D, state: GameState): void {
  const { core, shield } = state
  const start = shield.angle - shield.arc / 2
  const end = shield.angle + shield.arc / 2

  ctx.save()
  ctx.lineCap = 'round'
  if (!state.ecoMode) {
    ctx.shadowBlur = 24 + Math.min(26, Math.abs(shield.angularVelocity) * 0.012)
    ctx.shadowColor = '#8b5cf6'
  }
  ctx.strokeStyle = '#a78bfa'
  ctx.lineWidth = shield.thickness
  ctx.beginPath()
  ctx.arc(core.x, core.y, shield.radius, start, end)
  ctx.stroke()

  ctx.globalAlpha = 0.32
  ctx.strokeStyle = '#67e8f9'
  ctx.lineWidth = shield.thickness + 13
  ctx.beginPath()
  ctx.arc(core.x, core.y, shield.radius, start, end)
  ctx.stroke()
  ctx.restore()
}

function drawInputCue(ctx: CanvasRenderingContext2D, state: GameState): void {
  if (!state.input.pointerActive) return

  const { input, core } = state
  const angle = Math.atan2(input.y - core.y, input.x - core.x)
  const anchorX = core.x + Math.cos(angle) * state.shield.radius
  const anchorY = core.y + Math.sin(angle) * state.shield.radius

  ctx.save()
  ctx.globalAlpha = 0.72
  ctx.strokeStyle = 'rgba(103, 232, 249, 0.72)'
  ctx.lineWidth = 2
  ctx.setLineDash([7, 10])
  ctx.beginPath()
  ctx.moveTo(input.x, input.y)
  ctx.lineTo(anchorX, anchorY)
  ctx.stroke()

  ctx.setLineDash([])
  ctx.shadowBlur = 18
  ctx.shadowColor = '#67e8f9'
  ctx.strokeStyle = '#67e8f9'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(input.x, input.y, 12 + Math.sin(state.elapsed * 7) * 2, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

function drawParticles(ctx: CanvasRenderingContext2D, state: GameState): void {
  state.particles.forEach((particle) => {
    if (!particle.active) return
    const alpha = Math.max(0, particle.life / particle.maxLife)
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.fillStyle = particle.color
    ctx.beginPath()
    ctx.arc(particle.x, particle.y, particle.radius * alpha, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  })
}

function drawFloatingTexts(ctx: CanvasRenderingContext2D, state: GameState): void {
  ctx.save()
  ctx.font = '700 18px ui-monospace, SFMono-Regular, Consolas, monospace'
  ctx.textAlign = 'center'
  state.texts.forEach((text) => {
    if (!text.active) return
    ctx.globalAlpha = Math.max(0, text.life / text.maxLife)
    ctx.fillStyle = text.color
    ctx.fillText(text.text, text.x, text.y)
  })
  ctx.restore()
}

function drawHand(
  context: CanvasRenderingContext2D,
  hand: HandCoord | undefined | null,
  color: string,
  label: string,
  state: GameState
) {
  if (!hand || !hand.visible) return

  // Draw skeleton if landmarks exist
  if (hand.landmarks && hand.landmarks.length > 0) {
    context.save()
    context.beginPath()
    context.strokeStyle = color
    context.lineWidth = 4
    context.lineCap = 'round'
    context.lineJoin = 'round'

    const connections = [
      [0, 1], [1, 2], [2, 3], [3, 4], // Thumb
      [0, 5], [5, 6], [6, 7], [7, 8], // Index
      [5, 9], [9, 10], [10, 11], [11, 12], // Middle
      [9, 13], [13, 14], [14, 15], [15, 16], // Ring
      [13, 17], [0, 17], [17, 18], [18, 19], [19, 20] // Pinky & Palm
    ]

    connections.forEach(([start, end]) => {
      const p1 = hand.landmarks[start]
      const p2 = hand.landmarks[end]
      if (p1 && p2) {
        context.moveTo(p1.x * state.width, p1.y * state.height)
        context.lineTo(p2.x * state.width, p2.y * state.height)
      }
    })
    context.stroke()

    // Draw joints
    hand.landmarks.forEach((p, i) => {
      context.beginPath()
      context.arc(p.x * state.width, p.y * state.height, i === 9 ? 8 : 4, 0, Math.PI * 2)
      context.fillStyle = i === 9 ? '#ffff00' : 'rgba(255, 255, 255, 0.6)'
      context.fill()
    })
    context.restore()
  }

  const cx = hand.x * state.width
  const cy = hand.y * state.height
  const radius = hand.size * Math.max(state.width, state.height) * 0.4

  // Draw collision area
  context.save()
  context.beginPath()
  context.strokeStyle = 'rgba(255, 255, 255, 0.92)'
  context.lineWidth = 2
  context.setLineDash([4, 4])
  context.arc(cx, cy, radius, 0, Math.PI * 2)
  context.stroke()
  context.setLineDash([])

  context.fillStyle = '#ffffff'
  context.font = '700 13px system-ui'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(label, cx, cy - radius - 12)
  context.restore()
}

function drawHands(ctx: CanvasRenderingContext2D, state: GameState) {
  if (!state.input.pointerActive || !state.input.activeHand) return

  const color = state.input.activeHandSide === 'L' ? 'rgba(76, 201, 240, 0.86)' : 'rgba(61, 220, 151, 0.86)'
  drawHand(ctx, state.input.activeHand, color, state.input.activeHandSide || 'Hand', state)
}

export function renderGame(ctx: CanvasRenderingContext2D, state: GameState): void {
  ctx.save()
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0)
  ctx.clearRect(0, 0, state.width, state.height)

  const shake = state.shake * state.shake * 9
  if (shake > 0.01) {
    ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake)
  }

  drawBackground(ctx, state)
  if (!state.ecoMode) {
    drawParticles(ctx, state)
  }
  drawCore(ctx, state)
  drawShield(ctx, state)
  drawInputCue(ctx, state)
  drawHands(ctx, state)
  drawEntities(ctx, state)
  if (!state.ecoMode) {
    drawFloatingTexts(ctx, state)
  }

  if (state.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${Math.min(0.18, state.flash * 0.16)})`
    ctx.fillRect(0, 0, state.width, state.height)
  }
  ctx.restore()
}
