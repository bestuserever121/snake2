import {
  DIRECTIONS,
  GRID_WIDTH,
  GRID_HEIGHT,
  isOppositeDirection,
} from './game.js'

function isEffectActive(until, now) {
  return until > now
}

function wrap(value, max) {
  return ((value % max) + max) % max
}

function manhattan(a, b) {
  const dx = Math.min(Math.abs(a.x - b.x), GRID_WIDTH - Math.abs(a.x - b.x))
  const dy = Math.min(Math.abs(a.y - b.y), GRID_HEIGHT - Math.abs(a.y - b.y))
  return dx + dy
}

function buildBlocked(state, selfSlotIndex, ghostActive) {
  // Set of cell keys that would kill us if we entered them this tick.
  const blocked = new Set()
  for (const snake of state.snakes) {
    if (!snake.alive) continue
    const isOwn = snake.slotIndex === selfSlotIndex
    if (ghostActive && isOwn) continue
    // Skip the tail since it will move out (unless that snake is about to grow,
    // which we cannot easily predict — treat all segments as blocked for safety).
    for (const segment of snake.segments) {
      blocked.add(`${segment.x}:${segment.y}`)
    }
  }
  return blocked
}

function nearestTarget(head, targets) {
  let best = null
  let bestDist = Infinity
  for (const t of targets) {
    const d = manhattan(head, t)
    if (d < bestDist) {
      bestDist = d
      best = t
    }
  }
  return best ? { target: best, dist: bestDist } : null
}

/**
 * Decide next direction for a bot snake. Called once per tick BEFORE stepGame.
 * Returns a direction string or null (keep current).
 */
export function pickBotDirection(state, snake, now) {
  if (!snake.alive) return null
  if (isEffectActive(snake.effects.frozenUntil, now)) return null

  const head = snake.segments[0]
  const ghostActive = isEffectActive(snake.effects.ghostUntil, now)
  const wallPassReady = !isEffectActive(snake.wallPassCooldownUntil, now)
  const canWrap = ghostActive || wallPassReady

  const blocked = buildBlocked(state, snake.slotIndex, ghostActive)

  // Choose target: bonus if close & we don't have ghost (so we benefit), else nearest food.
  const wantBonus = state.bonus && (snake.effects.ghostUntil <= now || state.bonus.type.id !== 'ghost')
  const foodTarget = nearestTarget(head, state.foods)
  const bonusTarget = wantBonus && state.bonus
    ? { target: state.bonus, dist: manhattan(head, state.bonus) }
    : null

  let target = foodTarget?.target ?? null
  if (bonusTarget && (!foodTarget || bonusTarget.dist <= 6 || bonusTarget.dist < foodTarget.dist)) {
    target = bonusTarget.target
  }

  const options = []
  for (const dirName of ['up', 'down', 'left', 'right']) {
    if (isOppositeDirection(snake.direction, dirName)) continue
    const v = DIRECTIONS[dirName]
    const raw = { x: head.x + v.x, y: head.y + v.y }
    const outOfBounds = raw.x < 0 || raw.x >= GRID_WIDTH || raw.y < 0 || raw.y >= GRID_HEIGHT

    let cell = raw
    let wallPassCost = 0
    if (outOfBounds) {
      if (!canWrap) {
        // Lethal if we'd hit a wall without ghost/wallpass.
        continue
      }
      cell = { x: wrap(raw.x, GRID_WIDTH), y: wrap(raw.y, GRID_HEIGHT) }
      // Penalize burning the wall-pass cooldown when we aren't ghosting.
      if (!ghostActive) wallPassCost = 4
    }

    const key = `${cell.x}:${cell.y}`
    const isSafe = !blocked.has(key)

    // Compute score: lower is better.
    let dist = target ? manhattan(cell, target) : 0
    let score = dist + wallPassCost
    if (!isSafe) score += 1000 // strongly prefer safe moves; but allow as fallback

    options.push({ dirName, score, isSafe })
  }

  if (options.length === 0) return null

  // Pick lowest score, prefer safe; tie-break randomly to avoid robotic loops.
  options.sort((a, b) => a.score - b.score)
  const bestScore = options[0].score
  const ties = options.filter((o) => o.score === bestScore)
  const chosen = ties[Math.floor(Math.random() * ties.length)]
  return chosen.dirName
}
