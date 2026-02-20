import './style.css'

const CELL_SIZE = 22
const GRID_WIDTH = 44
const GRID_HEIGHT = 30
const TICK_MS = 110
const BONUS_MIN_SPAWN_MS = 6000
const BONUS_MAX_SPAWN_MS = 12000
const BONUS_LIFETIME_MS = 8500

const DIRECTIONS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

const app = document.querySelector('#app')

app.innerHTML = `
  <main class="game-shell">
    <header class="hud">
      <h1>Snake Arena</h1>
      <div class="status" id="status">Laufend</div>
      <div class="bonus-info" id="bonus-info">Bonus: wartet...</div>
      <button id="restart-btn" type="button">Neu starten</button>
    </header>

    <section class="panels">
      <article class="panel player-one">
        <h2>Spieler 1</h2>
        <p class="controls">Steuerung: WASD</p>
        <p class="score" id="score-p1">Punkte: 0</p>
        <p class="state" id="state-p1">Status: Aktiv</p>
        <p class="effects" id="effects-p1">Effekte: -</p>
      </article>

      <article class="panel player-two">
        <h2>Spieler 2</h2>
        <p class="controls">Steuerung: Pfeiltasten</p>
        <p class="score" id="score-p2">Punkte: 0</p>
        <p class="state" id="state-p2">Status: Aktiv</p>
        <p class="effects" id="effects-p2">Effekte: -</p>
      </article>
    </section>

    <section class="board-wrap">
      <canvas id="game-board" width="${GRID_WIDTH * CELL_SIZE}" height="${GRID_HEIGHT * CELL_SIZE}"></canvas>
      <p class="help">Taste <strong>Leertaste</strong> oder <strong>Neu starten</strong> fuer eine neue Runde. Bonus-Fruechte geben zeitliche Vorteile.</p>
    </section>
  </main>
`

const canvas = document.querySelector('#game-board')
const ctx = canvas.getContext('2d')
const restartBtn = document.querySelector('#restart-btn')
const statusEl = document.querySelector('#status')
const bonusInfoEl = document.querySelector('#bonus-info')
const p1ScoreEl = document.querySelector('#score-p1')
const p2ScoreEl = document.querySelector('#score-p2')
const p1StateEl = document.querySelector('#state-p1')
const p2StateEl = document.querySelector('#state-p2')
const p1EffectsEl = document.querySelector('#effects-p1')
const p2EffectsEl = document.querySelector('#effects-p2')

const BONUS_TYPES = [
  {
    id: 'double',
    label: 'Doppelpunkte',
    durationMs: 10000,
    colors: ['#d9f99d', '#84cc16', '#3f6212'],
  },
  {
    id: 'ghost',
    label: 'Phasenmodus',
    durationMs: 8000,
    colors: ['#e9d5ff', '#c084fc', '#6b21a8'],
  },
  {
    id: 'freeze',
    label: 'Gegner-Freeze',
    durationMs: 4500,
    colors: ['#bfdbfe', '#60a5fa', '#1e3a8a'],
  },
]

let food = { x: 0, y: 0 }
let isGameOver = false
let bonusFruit = null
let nextBonusSpawnAt = 0

const players = [
  {
    id: 'p1',
    label: 'Spieler 1',
    color: '#43aa8b',
    headColor: '#95f9d7',
    controls: { w: 'up', s: 'down', a: 'left', d: 'right' },
    startSnake: [
      { x: 10, y: 15 },
      { x: 9, y: 15 },
      { x: 8, y: 15 },
      { x: 7, y: 15 },
    ],
    startDirection: 'right',
    snake: [],
    direction: 'right',
    nextDirection: 'right',
    alive: true,
    score: 0,
    effects: {
      doubleScoreUntil: 0,
      ghostUntil: 0,
      frozenUntil: 0,
    },
  },
  {
    id: 'p2',
    label: 'Spieler 2',
    color: '#f3722c',
    headColor: '#ffc79e',
    controls: { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' },
    startSnake: [
      { x: 33, y: 15 },
      { x: 34, y: 15 },
      { x: 35, y: 15 },
      { x: 36, y: 15 },
    ],
    startDirection: 'left',
    snake: [],
    direction: 'left',
    nextDirection: 'left',
    alive: true,
    score: 0,
    effects: {
      doubleScoreUntil: 0,
      ghostUntil: 0,
      frozenUntil: 0,
    },
  },
]

function cloneSnake(snake) {
  return snake.map((segment) => ({ ...segment }))
}

function isOppositeDirection(a, b) {
  return (
    (a === 'up' && b === 'down') ||
    (a === 'down' && b === 'up') ||
    (a === 'left' && b === 'right') ||
    (a === 'right' && b === 'left')
  )
}

function toCellKey(cell) {
  return `${cell.x}:${cell.y}`
}

function randomInt(max) {
  return Math.floor(Math.random() * max)
}

function randomBetween(min, max) {
  return min + randomInt(max - min + 1)
}

function randomFrom(items) {
  return items[randomInt(items.length)]
}

function getNow() {
  return Date.now()
}

function setNextBonusSpawn(now) {
  nextBonusSpawnAt = now + randomBetween(BONUS_MIN_SPAWN_MS, BONUS_MAX_SPAWN_MS)
}

function placeFood() {
  const occupied = new Set()

  for (const player of players) {
    for (const segment of player.snake) {
      occupied.add(toCellKey(segment))
    }
  }

  let candidate = { x: randomInt(GRID_WIDTH), y: randomInt(GRID_HEIGHT) }

  while (occupied.has(toCellKey(candidate))) {
    candidate = { x: randomInt(GRID_WIDTH), y: randomInt(GRID_HEIGHT) }
  }

  food = candidate
}

function placeBonus(now) {
  const occupied = new Set([toCellKey(food)])

  for (const player of players) {
    for (const segment of player.snake) {
      occupied.add(toCellKey(segment))
    }
  }

  let candidate = { x: randomInt(GRID_WIDTH), y: randomInt(GRID_HEIGHT) }

  while (occupied.has(toCellKey(candidate))) {
    candidate = { x: randomInt(GRID_WIDTH), y: randomInt(GRID_HEIGHT) }
  }

  bonusFruit = {
    ...candidate,
    type: randomFrom(BONUS_TYPES),
    expiresAt: now + BONUS_LIFETIME_MS,
  }
}

function maybeSpawnBonus(now) {
  if (bonusFruit) {
    if (now >= bonusFruit.expiresAt) {
      bonusFruit = null
      setNextBonusSpawn(now)
    }
    return
  }

  if (now >= nextBonusSpawnAt) {
    placeBonus(now)
  }
}

function applyBonus(player, now) {
  if (!bonusFruit) {
    return
  }

  const bonusId = bonusFruit.type.id

  if (bonusId === 'double') {
    player.effects.doubleScoreUntil = Math.max(player.effects.doubleScoreUntil, now + bonusFruit.type.durationMs)
  }

  if (bonusId === 'ghost') {
    player.effects.ghostUntil = Math.max(player.effects.ghostUntil, now + bonusFruit.type.durationMs)
  }

  if (bonusId === 'freeze') {
    const enemy = players.find((other) => other.id !== player.id)
    if (enemy && enemy.alive) {
      enemy.effects.frozenUntil = Math.max(enemy.effects.frozenUntil, now + bonusFruit.type.durationMs)
    }
  }

  bonusFruit = null
  setNextBonusSpawn(now)
}

function isEffectActive(until, now) {
  return until > now
}

function wrapCell(cell) {
  return {
    x: (cell.x + GRID_WIDTH) % GRID_WIDTH,
    y: (cell.y + GRID_HEIGHT) % GRID_HEIGHT,
  }
}

function secondsLeft(until, now) {
  return Math.max(0, Math.ceil((until - now) / 1000))
}

function resetGame() {
  isGameOver = false
  bonusFruit = null

  const now = getNow()
  setNextBonusSpawn(now)

  for (const player of players) {
    player.snake = cloneSnake(player.startSnake)
    player.direction = player.startDirection
    player.nextDirection = player.startDirection
    player.alive = true
    player.score = 0
    player.effects.doubleScoreUntil = 0
    player.effects.ghostUntil = 0
    player.effects.frozenUntil = 0
  }

  placeFood()
  draw()
  updateHud()
}

function containsCell(snake, cell, skipTail) {
  const length = skipTail ? snake.length - 1 : snake.length
  for (let i = 0; i < length; i += 1) {
    if (snake[i].x === cell.x && snake[i].y === cell.y) {
      return true
    }
  }
  return false
}

function step() {
  if (isGameOver) {
    return
  }

  const now = getNow()
  maybeSpawnBonus(now)

  const moves = players.map((player) => {
    if (!player.alive) {
      return null
    }

    if (isEffectActive(player.effects.frozenUntil, now)) {
      return null
    }

    player.direction = player.nextDirection
    const vector = DIRECTIONS[player.direction]
    const currentHead = player.snake[0]
    const rawHead = { x: currentHead.x + vector.x, y: currentHead.y + vector.y }
    const nextHead = isEffectActive(player.effects.ghostUntil, now) ? wrapCell(rawHead) : rawHead
    const grows = nextHead.x === food.x && nextHead.y === food.y
    const bonus = bonusFruit && nextHead.x === bonusFruit.x && nextHead.y === bonusFruit.y

    return {
      player,
      nextHead,
      grows,
      bonus,
      dead: false,
    }
  })

  for (const move of moves) {
    if (!move || move.dead) {
      continue
    }

    const { nextHead, player, grows } = move

    const ghostActive = isEffectActive(player.effects.ghostUntil, now)

    if (!ghostActive && (nextHead.x < 0 || nextHead.x >= GRID_WIDTH || nextHead.y < 0 || nextHead.y >= GRID_HEIGHT)) {
      move.dead = true
      continue
    }

    for (const otherMove of moves) {
      if (!otherMove) {
        continue
      }

      const isOwnSnake = otherMove.player.id === player.id
      const skipTail = !otherMove.grows

      const ownBodyGhostPass = ghostActive && isOwnSnake

      if (!ownBodyGhostPass && containsCell(otherMove.player.snake, nextHead, skipTail)) {
        if (isOwnSnake && !grows && nextHead.x === player.snake[player.snake.length - 1].x && nextHead.y === player.snake[player.snake.length - 1].y) {
          continue
        }
        move.dead = true
        break
      }
    }
  }

  for (let i = 0; i < moves.length; i += 1) {
    const a = moves[i]
    if (!a || a.dead) {
      continue
    }

    for (let j = i + 1; j < moves.length; j += 1) {
      const b = moves[j]
      if (!b || b.dead) {
        continue
      }

      if (a.nextHead.x === b.nextHead.x && a.nextHead.y === b.nextHead.y) {
        a.dead = true
        b.dead = true
      }
    }
  }

  let foodWasEaten = false

  for (const move of moves) {
    if (!move) {
      continue
    }

    if (move.dead) {
      move.player.alive = false
      continue
    }

    move.player.snake.unshift(move.nextHead)

    if (move.grows) {
      const points = isEffectActive(move.player.effects.doubleScoreUntil, now) ? 2 : 1
      move.player.score += points
      foodWasEaten = true
    } else {
      move.player.snake.pop()
    }

    if (move.bonus) {
      applyBonus(move.player, now)
    }
  }

  if (foodWasEaten) {
    placeFood()
  }

  const alivePlayers = players.filter((player) => player.alive)
  if (alivePlayers.length <= 1) {
    isGameOver = true
  }

  draw()
  updateHud()
}

function drawGrid() {
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)'
  ctx.lineWidth = 1

  for (let x = 0; x <= GRID_WIDTH; x += 1) {
    ctx.beginPath()
    ctx.moveTo(x * CELL_SIZE + 0.5, 0)
    ctx.lineTo(x * CELL_SIZE + 0.5, GRID_HEIGHT * CELL_SIZE)
    ctx.stroke()
  }

  for (let y = 0; y <= GRID_HEIGHT; y += 1) {
    ctx.beginPath()
    ctx.moveTo(0, y * CELL_SIZE + 0.5)
    ctx.lineTo(GRID_WIDTH * CELL_SIZE, y * CELL_SIZE + 0.5)
    ctx.stroke()
  }
}

function drawFood() {
  const cx = food.x * CELL_SIZE + CELL_SIZE / 2
  const cy = food.y * CELL_SIZE + CELL_SIZE / 2

  ctx.fillStyle = '#ffe08a'
  ctx.beginPath()
  ctx.arc(cx, cy, CELL_SIZE * 0.4, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#f8961e'
  ctx.beginPath()
  ctx.arc(cx, cy, CELL_SIZE * 0.3, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#f94144'
  ctx.beginPath()
  ctx.arc(cx, cy, CELL_SIZE * 0.22, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = '#fff8de'
  ctx.lineWidth = 1.6
  ctx.beginPath()
  ctx.arc(cx, cy, CELL_SIZE * 0.42, 0, Math.PI * 2)
  ctx.stroke()

  ctx.fillStyle = '#d8f3a4'
  ctx.beginPath()
  ctx.ellipse(cx + CELL_SIZE * 0.16, cy - CELL_SIZE * 0.2, CELL_SIZE * 0.1, CELL_SIZE * 0.06, -0.6, 0, Math.PI * 2)
  ctx.fill()
}

function drawBonusFruit() {
  if (!bonusFruit) {
    return
  }

  const cx = bonusFruit.x * CELL_SIZE + CELL_SIZE / 2
  const cy = bonusFruit.y * CELL_SIZE + CELL_SIZE / 2
  const [outer, mid, inner] = bonusFruit.type.colors

  ctx.fillStyle = outer
  ctx.beginPath()
  ctx.arc(cx, cy, CELL_SIZE * 0.42, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = mid
  ctx.beginPath()
  ctx.arc(cx, cy, CELL_SIZE * 0.3, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = inner
  ctx.beginPath()
  ctx.arc(cx, cy, CELL_SIZE * 0.18, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 1.4
  ctx.beginPath()
  ctx.arc(cx, cy, CELL_SIZE * 0.44, 0, Math.PI * 2)
  ctx.stroke()
}

function drawSnake(player) {
  for (let i = player.snake.length - 1; i >= 0; i -= 1) {
    const segment = player.snake[i]
    const x = segment.x * CELL_SIZE
    const y = segment.y * CELL_SIZE
    ctx.fillStyle = i === 0 ? player.headColor : player.color
    ctx.fillRect(x + 2, y + 2, CELL_SIZE - 4, CELL_SIZE - 4)
  }
}

function drawOverlay() {
  if (!isGameOver) {
    return
  }

  ctx.fillStyle = 'rgba(6, 10, 18, 0.7)'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const alivePlayers = players.filter((player) => player.alive)
  const message = alivePlayers.length === 1 ? `${alivePlayers[0].label} gewinnt!` : 'Unentschieden!'

  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.font = '700 44px "Trebuchet MS", Verdana, sans-serif'
  ctx.fillText('Runde beendet', canvas.width / 2, canvas.height / 2 - 14)
  ctx.font = '600 30px "Trebuchet MS", Verdana, sans-serif'
  ctx.fillText(message, canvas.width / 2, canvas.height / 2 + 30)
}

function draw() {
  ctx.fillStyle = '#0b1220'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  drawGrid()
  drawFood()
  drawBonusFruit()

  for (const player of players) {
    if (player.alive) {
      drawSnake(player)
    }
  }

  drawOverlay()
}

function updateHud() {
  const now = getNow()
  const p1 = players[0]
  const p2 = players[1]

  p1ScoreEl.textContent = `Punkte: ${p1.score}`
  p2ScoreEl.textContent = `Punkte: ${p2.score}`
  p1StateEl.textContent = `Status: ${p1.alive ? (isEffectActive(p1.effects.frozenUntil, now) ? 'Eingefroren' : 'Aktiv') : 'Ausgeschieden'}`
  p2StateEl.textContent = `Status: ${p2.alive ? (isEffectActive(p2.effects.frozenUntil, now) ? 'Eingefroren' : 'Aktiv') : 'Ausgeschieden'}`

  const p1Effects = []
  const p2Effects = []

  if (isEffectActive(p1.effects.doubleScoreUntil, now)) {
    p1Effects.push(`Doppelpunkte ${secondsLeft(p1.effects.doubleScoreUntil, now)}s`)
  }
  if (isEffectActive(p1.effects.ghostUntil, now)) {
    p1Effects.push(`Phasenmodus ${secondsLeft(p1.effects.ghostUntil, now)}s`)
  }

  if (isEffectActive(p2.effects.doubleScoreUntil, now)) {
    p2Effects.push(`Doppelpunkte ${secondsLeft(p2.effects.doubleScoreUntil, now)}s`)
  }
  if (isEffectActive(p2.effects.ghostUntil, now)) {
    p2Effects.push(`Phasenmodus ${secondsLeft(p2.effects.ghostUntil, now)}s`)
  }

  p1EffectsEl.textContent = `Effekte: ${p1Effects.length > 0 ? p1Effects.join(', ') : '-'}`
  p2EffectsEl.textContent = `Effekte: ${p2Effects.length > 0 ? p2Effects.join(', ') : '-'}`

  if (bonusFruit) {
    bonusInfoEl.textContent = `Bonus: ${bonusFruit.type.label} (${secondsLeft(bonusFruit.expiresAt, now)}s)`
  } else {
    bonusInfoEl.textContent = `Bonus in: ${secondsLeft(nextBonusSpawnAt, now)}s`
  }

  if (!isGameOver) {
    statusEl.textContent = 'Laufend'
    return
  }

  const alivePlayers = players.filter((player) => player.alive)
  statusEl.textContent = alivePlayers.length === 1 ? `${alivePlayers[0].label} gewinnt` : 'Unentschieden'
}

window.addEventListener('keydown', (event) => {
  if (event.code === 'Space') {
    resetGame()
    return
  }

  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key

  for (const player of players) {
    if (!player.alive) {
      continue
    }

    const nextDirection = player.controls[key]
    if (!nextDirection || isOppositeDirection(player.direction, nextDirection)) {
      continue
    }

    player.nextDirection = nextDirection
    event.preventDefault()
  }
})

restartBtn.addEventListener('click', () => {
  resetGame()
})

resetGame()
setInterval(step, TICK_MS)
