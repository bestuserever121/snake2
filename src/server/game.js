// Pure game logic, no DOM, no Date.now() directly (caller passes `now`).
// Extracted and adapted from the original single-player main.js.

export const CELL_SIZE = 22
export const GRID_WIDTH = 44
export const GRID_HEIGHT = 30
export const BONUS_MIN_SPAWN_MS = 6000
export const BONUS_MAX_SPAWN_MS = 12000
export const BONUS_LIFETIME_MS = 8500
export const ROUND_WINNER_BONUS_POINTS = 10
export const FLOATING_MESSAGE_MS = 1600
export const MAX_ACTIVE_FOODS = 5
export const WALL_PASS_COOLDOWN_MS = 10000

export const DIRECTIONS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

export const BONUS_TYPES = [
  { id: 'double', label: 'Doppelpunkte', durationMs: 10000, colors: ['#fde68a', '#f59e0b', '#78350f'] },
  { id: 'ghost', label: 'Phasenmodus', durationMs: 8000, colors: ['#e9d5ff', '#c084fc', '#6b21a8'] },
  { id: 'freeze', label: 'Gegner-Freeze', durationMs: 4500, colors: ['#bfdbfe', '#60a5fa', '#1e3a8a'] },
]

// Four fixed slot definitions (color, spawn, start direction).
// Slot 0..2 mirror the original P1/P2/P3, slot 3 is new.
export const SLOT_DEFINITIONS = [
  {
    index: 0,
    color: '#43aa8b',
    headColor: '#95f9d7',
    startSnake: [{ x: 10, y: 15 }, { x: 9, y: 15 }, { x: 8, y: 15 }, { x: 7, y: 15 }],
    startDirection: 'right',
  },
  {
    index: 1,
    color: '#f3722c',
    headColor: '#ffc79e',
    startSnake: [{ x: 33, y: 15 }, { x: 34, y: 15 }, { x: 35, y: 15 }, { x: 36, y: 15 }],
    startDirection: 'left',
  },
  {
    index: 2,
    color: '#5b7cfa',
    headColor: '#b7c8ff',
    startSnake: [{ x: 22, y: 4 }, { x: 22, y: 3 }, { x: 22, y: 2 }, { x: 22, y: 1 }],
    startDirection: 'down',
  },
  {
    index: 3,
    color: '#e879f9',
    headColor: '#fbcfe8',
    startSnake: [{ x: 22, y: 25 }, { x: 22, y: 26 }, { x: 22, y: 27 }, { x: 22, y: 28 }],
    startDirection: 'up',
  },
]

const EFFECT_EXPIRE_MESSAGES = [
  { key: 'doubleScoreUntil', label: 'Doppelpunkte', color: '#fde68a' },
  { key: 'ghostUntil', label: 'Phasenmodus', color: '#ddd6fe' },
  { key: 'frozenUntil', label: 'Freeze', color: '#bfdbfe' },
]

function randomInt(max) {
  return Math.floor(Math.random() * max)
}

function randomBetween(min, max) {
  return min + randomInt(max - min + 1)
}

function randomFrom(items) {
  return items[randomInt(items.length)]
}

function toCellKey(cell) {
  return `${cell.x}:${cell.y}`
}

function cloneSnake(snake) {
  return snake.map((segment) => ({ ...segment }))
}

export function isOppositeDirection(a, b) {
  return (
    (a === 'up' && b === 'down') ||
    (a === 'down' && b === 'up') ||
    (a === 'left' && b === 'right') ||
    (a === 'right' && b === 'left')
  )
}

function wrapCell(cell) {
  return {
    x: (cell.x + GRID_WIDTH) % GRID_WIDTH,
    y: (cell.y + GRID_HEIGHT) % GRID_HEIGHT,
  }
}

function isEffectActive(until, now) {
  return until > now
}

function createOccupiedCells(snakes, extraCells = []) {
  const occupied = new Set()
  for (const snake of snakes) {
    for (const segment of snake.segments) {
      occupied.add(toCellKey(segment))
    }
  }
  for (const cell of extraCells) {
    occupied.add(toCellKey(cell))
  }
  return occupied
}

function pickFreeCell(occupied) {
  let candidate = { x: randomInt(GRID_WIDTH), y: randomInt(GRID_HEIGHT) }
  let guard = 0
  while (occupied.has(toCellKey(candidate)) && guard < 2000) {
    candidate = { x: randomInt(GRID_WIDTH), y: randomInt(GRID_HEIGHT) }
    guard += 1
  }
  occupied.add(toCellKey(candidate))
  return candidate
}

function shouldSpawnTwoFoods() {
  return Math.random() < 0.2
}

function addFloatingMessageAtCell(state, cell, text, color, now) {
  state.floatingMessages.push({
    x: cell.x * CELL_SIZE + CELL_SIZE / 2,
    y: cell.y * CELL_SIZE + CELL_SIZE / 2,
    text,
    color,
    createdAt: now,
    expiresAt: now + FLOATING_MESSAGE_MS,
  })
}

function expireTimedEffects(state, now) {
  for (const snake of state.snakes) {
    for (const effect of EFFECT_EXPIRE_MESSAGES) {
      const until = snake.effects[effect.key]
      if (until > 0 && until <= now) {
        snake.effects[effect.key] = 0
        if (snake.alive && snake.segments.length > 0) {
          addFloatingMessageAtCell(state, snake.segments[0], `-Bonus: ${effect.label}`, effect.color, now)
        }
      }
    }
  }
}

function setNextBonusSpawn(state, now) {
  state.nextBonusSpawnAt = now + randomBetween(BONUS_MIN_SPAWN_MS, BONUS_MAX_SPAWN_MS)
}

function placeFoodSet(state) {
  state.targetFoodCount = shouldSpawnTwoFoods() ? 2 : 1
  const occupied = createOccupiedCells(state.snakes, state.bonus ? [state.bonus] : [])
  state.foods = []
  for (let i = 0; i < state.targetFoodCount; i += 1) {
    state.foods.push(pickFreeCell(occupied))
  }
}

function refillFoods(state) {
  const occupied = createOccupiedCells(state.snakes, state.bonus ? [state.bonus, ...state.foods] : [...state.foods])
  while (state.foods.length < state.targetFoodCount) {
    state.foods.push(pickFreeCell(occupied))
  }
}

function increaseFoodTargetBy(state, amount) {
  state.targetFoodCount = Math.min(MAX_ACTIVE_FOODS, state.targetFoodCount + amount)
}

function placeBonus(state, now) {
  const occupied = createOccupiedCells(state.snakes, state.foods)
  const candidate = pickFreeCell(occupied)
  state.bonus = {
    x: candidate.x,
    y: candidate.y,
    type: randomFrom(BONUS_TYPES),
    expiresAt: now + BONUS_LIFETIME_MS,
  }
}

function maybeSpawnBonus(state, now) {
  if (state.bonus) {
    if (now >= state.bonus.expiresAt) {
      state.bonus = null
      setNextBonusSpawn(state, now)
    }
    return
  }
  if (now >= state.nextBonusSpawnAt) {
    placeBonus(state, now)
  }
}

function applyBonus(state, snake, now) {
  if (!state.bonus) return
  const bonusType = state.bonus.type
  const bonusId = bonusType.id

  if (bonusId === 'double') {
    snake.effects.doubleScoreUntil = Math.max(snake.effects.doubleScoreUntil, now + bonusType.durationMs)
  }
  if (bonusId === 'ghost') {
    snake.effects.ghostUntil = Math.max(snake.effects.ghostUntil, now + bonusType.durationMs)
  }
  if (bonusId === 'freeze') {
    const enemies = state.snakes.filter((other) => other.slotIndex !== snake.slotIndex && other.alive)
    const enemy = enemies.length > 0 ? randomFrom(enemies) : null
    if (enemy) {
      enemy.effects.frozenUntil = Math.max(enemy.effects.frozenUntil, now + bonusType.durationMs)
    }
  }

  if (snake.segments.length > 0) {
    addFloatingMessageAtCell(state, snake.segments[0], `+Bonus: ${bonusType.label}`, bonusType.colors[0], now)
  }

  state.bonus = null
  setNextBonusSpawn(state, now)
}

function containsCell(snake, cell, skipTail) {
  const length = skipTail ? snake.segments.length - 1 : snake.segments.length
  for (let i = 0; i < length; i += 1) {
    if (snake.segments[i].x === cell.x && snake.segments[i].y === cell.y) {
      return true
    }
  }
  return false
}

function pruneFloatingMessages(state, now) {
  state.floatingMessages = state.floatingMessages.filter((msg) => msg.expiresAt > now)
}

// --- Public API ---

/**
 * @param {Array<{slotIndex: number, label: string, isBot: boolean, totalScore?: number}>} slots
 * @param {number} now
 */
export function createGameState(slots, now) {
  const snakes = slots.map((slot) => {
    const def = SLOT_DEFINITIONS[slot.slotIndex]
    return {
      slotIndex: slot.slotIndex,
      label: slot.label,
      isBot: slot.isBot,
      color: def.color,
      headColor: def.headColor,
      segments: cloneSnake(def.startSnake),
      direction: def.startDirection,
      nextDirection: def.startDirection,
      alive: true,
      score: 0,
      totalScore: slot.totalScore ?? 0,
      wallPassCooldownUntil: 0,
      effects: {
        doubleScoreUntil: 0,
        ghostUntil: 0,
        frozenUntil: 0,
      },
    }
  })

  const state = {
    tick: 0,
    startedAt: now,
    snakes,
    foods: [],
    targetFoodCount: 1,
    bonus: null,
    nextBonusSpawnAt: 0,
    floatingMessages: [],
    status: 'playing',
    winnerSlotIndex: null,
    roundWinnerAwarded: false,
  }

  setNextBonusSpawn(state, now)
  placeFoodSet(state)
  return state
}

export function applyInput(state, slotIndex, direction) {
  if (!DIRECTIONS[direction]) return
  const snake = state.snakes.find((s) => s.slotIndex === slotIndex)
  if (!snake || !snake.alive) return
  if (isOppositeDirection(snake.direction, direction)) return
  snake.nextDirection = direction
}

/**
 * Run one tick. Returns true if the game ended this tick.
 */
export function stepGame(state, now) {
  if (state.status !== 'playing') return false

  state.tick += 1
  expireTimedEffects(state, now)
  maybeSpawnBonus(state, now)
  pruneFloatingMessages(state, now)

  const moves = state.snakes.map((snake) => {
    if (!snake.alive) return null
    if (isEffectActive(snake.effects.frozenUntil, now)) return null

    snake.direction = snake.nextDirection
    const vector = DIRECTIONS[snake.direction]
    const currentHead = snake.segments[0]
    const rawHead = { x: currentHead.x + vector.x, y: currentHead.y + vector.y }
    const ghostActive = isEffectActive(snake.effects.ghostUntil, now)
    const wallPassReady = !isEffectActive(snake.wallPassCooldownUntil, now)
    const outOfBounds = rawHead.x < 0 || rawHead.x >= GRID_WIDTH || rawHead.y < 0 || rawHead.y >= GRID_HEIGHT

    let nextHead = rawHead
    let usedWallPass = false

    if (outOfBounds) {
      if (ghostActive) {
        nextHead = wrapCell(rawHead)
      } else if (wallPassReady) {
        nextHead = wrapCell(rawHead)
        usedWallPass = true
      }
    }

    const eatenFoodIndex = state.foods.findIndex((f) => nextHead.x === f.x && nextHead.y === f.y)
    const grows = eatenFoodIndex !== -1
    const bonus = state.bonus && nextHead.x === state.bonus.x && nextHead.y === state.bonus.y

    return { snake, nextHead, ghostActive, usedWallPass, grows, eatenFoodIndex, bonus: Boolean(bonus), dead: false }
  })

  // Wall + body collisions
  for (const move of moves) {
    if (!move || move.dead) continue
    const { nextHead, snake, grows } = move

    if (!move.ghostActive && (nextHead.x < 0 || nextHead.x >= GRID_WIDTH || nextHead.y < 0 || nextHead.y >= GRID_HEIGHT)) {
      move.dead = true
      continue
    }

    for (const otherMove of moves) {
      if (!otherMove) continue
      const isOwn = otherMove.snake.slotIndex === snake.slotIndex
      const skipTail = !otherMove.grows
      const ownBodyGhostPass = move.ghostActive && isOwn
      if (!ownBodyGhostPass && containsCell(otherMove.snake, nextHead, skipTail)) {
        // Special case: moving into own tail when not growing is fine
        const tail = snake.segments[snake.segments.length - 1]
        if (isOwn && !grows && nextHead.x === tail.x && nextHead.y === tail.y) continue
        move.dead = true
        break
      }
    }
  }

  // Head-to-head
  for (let i = 0; i < moves.length; i += 1) {
    const a = moves[i]
    if (!a || a.dead) continue
    for (let j = i + 1; j < moves.length; j += 1) {
      const b = moves[j]
      if (!b || b.dead) continue
      if (a.nextHead.x === b.nextHead.x && a.nextHead.y === b.nextHead.y) {
        a.dead = true
        b.dead = true
      }
    }
  }

  const eatenFoodIndexes = new Set()

  for (const move of moves) {
    if (!move) continue
    if (move.dead) {
      move.snake.alive = false
      continue
    }

    move.snake.segments.unshift(move.nextHead)

    if (move.usedWallPass) {
      move.snake.wallPassCooldownUntil = now + WALL_PASS_COOLDOWN_MS
      addFloatingMessageAtCell(state, move.snake.segments[0], '-Wandpass 10s', '#fca5a5', now)
    }

    if (move.grows) {
      const points = isEffectActive(move.snake.effects.doubleScoreUntil, now) ? 2 : 1
      move.snake.score += points
      move.snake.totalScore += points
      if (move.eatenFoodIndex >= 0) {
        eatenFoodIndexes.add(move.eatenFoodIndex)
      }
    } else {
      move.snake.segments.pop()
    }

    if (move.bonus) {
      applyBonus(state, move.snake, now)
    }
  }

  if (eatenFoodIndexes.size > 0) {
    increaseFoodTargetBy(state, eatenFoodIndexes.size)
    state.foods = state.foods.filter((_, i) => !eatenFoodIndexes.has(i))
    refillFoods(state)
  }

  const alive = state.snakes.filter((s) => s.alive)
  if (alive.length <= 1) {
    if (!state.roundWinnerAwarded && alive.length === 1) {
      const winner = alive[0]
      winner.score += ROUND_WINNER_BONUS_POINTS
      winner.totalScore += ROUND_WINNER_BONUS_POINTS
      if (winner.segments.length > 0) {
        addFloatingMessageAtCell(state, winner.segments[0], `+${ROUND_WINNER_BONUS_POINTS} Siegerbonus`, '#fde68a', now)
      }
      state.winnerSlotIndex = winner.slotIndex
      state.roundWinnerAwarded = true
    }
    state.status = 'gameover'
    return true
  }

  return false
}

/**
 * Build a clean snapshot for transmission (drops internal fields, normalizes shape).
 */
export function snapshot(state, now) {
  return {
    tick: state.tick,
    startedAt: state.startedAt,
    now,
    status: state.status,
    winnerSlotIndex: state.winnerSlotIndex,
    snakes: state.snakes.map((s) => ({
      slotIndex: s.slotIndex,
      label: s.label,
      isBot: s.isBot,
      color: s.color,
      headColor: s.headColor,
      segments: s.segments,
      direction: s.direction,
      alive: s.alive,
      score: s.score,
      totalScore: s.totalScore,
      wallPassCooldownUntil: s.wallPassCooldownUntil,
      effects: { ...s.effects },
    })),
    foods: state.foods,
    bonus: state.bonus ? { x: state.bonus.x, y: state.bonus.y, type: state.bonus.type, expiresAt: state.bonus.expiresAt } : null,
    floatingMessages: state.floatingMessages,
    nextBonusSpawnAt: state.nextBonusSpawnAt,
  }
}
