// Client-side prediction: render OWN snakes immediately using local inputs,
// without waiting for the server roundtrip. Server snapshots are still
// authoritative — on each snapshot we reset prediction to that base state.

const TICK_MS = 50
const GRID_WIDTH = 44
const GRID_HEIGHT = 30

const DIRECTIONS = {
  up:    { x: 0, y: -1 },
  down:  { x: 0, y: 1 },
  left:  { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

function isOpposite(a, b) {
  return (a === 'up' && b === 'down') || (a === 'down' && b === 'up')
    || (a === 'left' && b === 'right') || (a === 'right' && b === 'left')
}

function cloneSnake(s) {
  return { ...s, segments: s.segments.map((seg) => ({ ...seg })) }
}

// Returns true if advanced, false if blocked (wall or self-collision).
function advanceOneTick(snake) {
  const v = DIRECTIONS[snake.direction]
  const head = snake.segments[0]
  const next = { x: head.x + v.x, y: head.y + v.y }
  // Don't predict past walls (server might wrap or kill — let server decide).
  if (next.x < 0 || next.x >= GRID_WIDTH || next.y < 0 || next.y >= GRID_HEIGHT) {
    return false
  }
  // Don't run into our own body (tail will move out, so skip it).
  for (let i = 0; i < snake.segments.length - 1; i += 1) {
    if (snake.segments[i].x === next.x && snake.segments[i].y === next.y) return false
  }
  snake.segments.unshift(next)
  snake.segments.pop()
  return true
}

export function createPredictor(mySlotIndexes) {
  const ownSlots = new Set(mySlotIndexes)
  let baseSnapshot = null
  let baseAt = 0
  const pendingDirection = new Map() // slotIndex -> direction (latest local input)

  return {
    isOwn(slotIndex) {
      return ownSlots.has(slotIndex)
    },

    onSnapshot(snapshot) {
      baseSnapshot = snapshot
      baseAt = performance.now()
      // Snapshot includes effects of all previously sent inputs (server is past us).
      // Drop pending inputs that the server has already absorbed.
      pendingDirection.clear()
    },

    onLocalInput(slotIndex, direction) {
      if (!ownSlots.has(slotIndex)) return
      pendingDirection.set(slotIndex, direction)
    },

    /**
     * Returns predicted state at `now` (performance.now()).
     * - snakesNow: snake positions at floor(ticksElapsed) ticks after snapshot
     * - snakesNext: snake positions at floor(ticksElapsed)+1 ticks
     * - progress: 0..1 fractional position within current tick
     *
     * Own snakes use prediction with pending direction inputs.
     * Other snakes return base snapshot positions unchanged.
     */
    getPrediction(now) {
      if (!baseSnapshot) return null
      const elapsed = Math.max(0, now - baseAt)
      const tickFloat = elapsed / TICK_MS
      const baseTicks = Math.floor(tickFloat)
      const progress = tickFloat - baseTicks

      return {
        snakesNow: simulateAll(baseSnapshot.snakes, baseTicks, ownSlots, pendingDirection),
        snakesNext: simulateAll(baseSnapshot.snakes, baseTicks + 1, ownSlots, pendingDirection),
        progress,
        ownSlots,
      }
    },
  }
}

function simulateAll(baseSnakes, ticks, ownSlots, pendingDir) {
  return baseSnakes.map((snake) => {
    if (!ownSlots.has(snake.slotIndex)) return snake
    if (!snake.alive) return snake

    const sim = cloneSnake(snake)
    const pending = pendingDir.get(snake.slotIndex)
    if (pending && !isOpposite(sim.direction, pending)) {
      sim.direction = pending
    }

    for (let t = 0; t < ticks; t += 1) {
      if (!advanceOneTick(sim)) break
    }
    return sim
  })
}
