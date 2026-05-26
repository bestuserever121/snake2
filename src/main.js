import './style.css'

const CELL_SIZE = 22
const GRID_WIDTH = 44
const GRID_HEIGHT = 30
const TICK_MS = 110
const BONUS_MIN_SPAWN_MS = 6000
const BONUS_MAX_SPAWN_MS = 12000
const BONUS_LIFETIME_MS = 8500
const GAMEPAD_DEADZONE = 0.12
const SCORE_STORAGE_KEY = 'snake-arena-total-scores-v1'
const ROUND_WINNER_BONUS_POINTS = 10
const FLOATING_MESSAGE_MS = 1600
const MAX_ACTIVE_FOODS = 5
const WALL_PASS_COOLDOWN_MS = 10000

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
      <button id="reset-scores-btn" type="button">Punkte reset</button>
      <button id="restart-btn" type="button">Neu starten</button>
    </header>

    <section class="panels">
      <article class="panel player-one">
        <h2>Spieler 1</h2>
        <p class="controls">Steuerung: WASD</p>
        <p class="score" id="score-p1">Punkte Runde: 0 | Gesamt: 0</p>
        <p class="state" id="state-p1">Status: Aktiv</p>
        <p class="effects" id="effects-p1">Effekte: -</p>
      </article>

      <article class="panel player-two">
        <h2>Spieler 2</h2>
        <p class="controls">Steuerung: Pfeiltasten</p>
        <p class="score" id="score-p2">Punkte Runde: 0 | Gesamt: 0</p>
        <p class="state" id="state-p2">Status: Aktiv</p>
        <p class="effects" id="effects-p2">Effekte: -</p>
      </article>

      <article class="panel player-three">
        <h2>Spieler 3</h2>
        <p class="controls">Steuerung: Joystick/Gamepad</p>
        <p class="score" id="score-p3">Punkte Runde: 0 | Gesamt: 0</p>
        <p class="state" id="state-p3">Status: Aktiv</p>
        <p class="effects" id="effects-p3">Effekte: -</p>
        <p class="joystick" id="joystick-p3">Joystick: Nicht verbunden</p>
      </article>
    </section>

    <section class="board-wrap">
      <canvas id="game-board" width="${GRID_WIDTH * CELL_SIZE}" height="${GRID_HEIGHT * CELL_SIZE}"></canvas>
      <p class="help">Taste <strong>Leertaste</strong> oder <strong>Neu starten</strong> fuer eine neue Runde. Bonus-Fruechte geben zeitliche Vorteile. Sieger jeder Runde erhaelt +10 Punkte.</p>
    </section>
  </main>
`

const canvas = document.querySelector('#game-board')
const ctx = canvas.getContext('2d')
const restartBtn = document.querySelector('#restart-btn')
const resetScoresBtn = document.querySelector('#reset-scores-btn')
const statusEl = document.querySelector('#status')
const bonusInfoEl = document.querySelector('#bonus-info')
const p1ScoreEl = document.querySelector('#score-p1')
const p2ScoreEl = document.querySelector('#score-p2')
const p3ScoreEl = document.querySelector('#score-p3')
const p1StateEl = document.querySelector('#state-p1')
const p2StateEl = document.querySelector('#state-p2')
const p3StateEl = document.querySelector('#state-p3')
const p1EffectsEl = document.querySelector('#effects-p1')
const p2EffectsEl = document.querySelector('#effects-p2')
const p3EffectsEl = document.querySelector('#effects-p3')
const p3JoystickEl = document.querySelector('#joystick-p3')

const playerHudById = {
  p1: { scoreEl: p1ScoreEl, stateEl: p1StateEl, effectsEl: p1EffectsEl },
  p2: { scoreEl: p2ScoreEl, stateEl: p2StateEl, effectsEl: p2EffectsEl },
  p3: { scoreEl: p3ScoreEl, stateEl: p3StateEl, effectsEl: p3EffectsEl },
}

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

const EFFECT_EXPIRE_MESSAGES = [
  { key: 'doubleScoreUntil', label: 'Doppelpunkte', color: '#fde68a' },
  { key: 'ghostUntil', label: 'Phasenmodus', color: '#ddd6fe' },
  { key: 'frozenUntil', label: 'Freeze', color: '#bfdbfe' },
]

let isGameOver = false
let bonusFruit = null
let nextBonusSpawnAt = 0
let activeGamepadIndex = null
let pendingGamepadDirection = null
let lastGamepadInputAt = 0
let floatingMessages = []
let roundWinnerAwarded = false

function shouldSpawnTwoFoods() {
  return Math.random() < 0.2
}

let foods = []
let targetFoodCount = 1

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
    totalScore: 0,
    wallPassCooldownUntil: 0,
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
    totalScore: 0,
    wallPassCooldownUntil: 0,
    effects: {
      doubleScoreUntil: 0,
      ghostUntil: 0,
      frozenUntil: 0,
    },
  },
  {
    id: 'p3',
    label: 'Spieler 3',
    color: '#5b7cfa',
    headColor: '#b7c8ff',
    controls: {},
    usesGamepad: true,
    startSnake: [
      { x: 22, y: 4 },
      { x: 22, y: 3 },
      { x: 22, y: 2 },
      { x: 22, y: 1 },
    ],
    startDirection: 'down',
    snake: [],
    direction: 'down',
    nextDirection: 'down',
    alive: true,
    score: 0,
    totalScore: 0,
    wallPassCooldownUntil: 0,
    effects: {
      doubleScoreUntil: 0,
      ghostUntil: 0,
      frozenUntil: 0,
    },
  },
]

function loadTotalScores() {
  try {
    const raw = window.localStorage.getItem(SCORE_STORAGE_KEY)
    if (!raw) {
      return {}
    }

    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed ? parsed : {}
  } catch {
    return {}
  }
}

function saveTotalScores() {
  try {
    const payload = {}
    for (const player of players) {
      payload[player.id] = player.totalScore
    }
    window.localStorage.setItem(SCORE_STORAGE_KEY, JSON.stringify(payload))
  } catch {
  }
}

function applyStoredTotalScores() {
  const stored = loadTotalScores()

  for (const player of players) {
    const value = Number(stored[player.id])
    player.totalScore = Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
  }
}

function addFloatingMessageAtCell(cell, text, color, now) {
  floatingMessages.push({
    x: cell.x * CELL_SIZE + CELL_SIZE / 2,
    y: cell.y * CELL_SIZE + CELL_SIZE / 2,
    text,
    color,
    createdAt: now,
    expiresAt: now + FLOATING_MESSAGE_MS,
  })
}

function expireTimedEffects(now) {
  for (const player of players) {
    for (const effect of EFFECT_EXPIRE_MESSAGES) {
      const until = player.effects[effect.key]
      if (until > 0 && until <= now) {
        player.effects[effect.key] = 0
        if (player.alive && player.snake.length > 0) {
          addFloatingMessageAtCell(player.snake[0], `-Bonus: ${effect.label}`, effect.color, now)
        }
      }
    }
  }
}

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

function createOccupiedCells(extraCells = []) {
  const occupied = new Set()

  for (const player of players) {
    for (const segment of player.snake) {
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
  while (occupied.has(toCellKey(candidate))) {
    candidate = { x: randomInt(GRID_WIDTH), y: randomInt(GRID_HEIGHT) }
  }
  occupied.add(toCellKey(candidate))
  return candidate
}

function placeFoodSet() {
  targetFoodCount = shouldSpawnTwoFoods() ? 2 : 1
  const occupied = createOccupiedCells(bonusFruit ? [bonusFruit] : [])
  foods = []

  for (let i = 0; i < targetFoodCount; i += 1) {
    foods.push(pickFreeCell(occupied))
  }
}

function refillFoods() {
  const occupied = createOccupiedCells(bonusFruit ? [bonusFruit, ...foods] : foods)

  while (foods.length < targetFoodCount) {
    foods.push(pickFreeCell(occupied))
  }
}

function increaseFoodTargetBy(amount) {
  targetFoodCount = Math.min(MAX_ACTIVE_FOODS, targetFoodCount + amount)
}

function placeBonus(now) {
  const occupied = createOccupiedCells(foods)
  const candidate = pickFreeCell(occupied)

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

  const bonusType = bonusFruit.type
  const bonusId = bonusType.id

  if (bonusId === 'double') {
    player.effects.doubleScoreUntil = Math.max(player.effects.doubleScoreUntil, now + bonusType.durationMs)
  }

  if (bonusId === 'ghost') {
    player.effects.ghostUntil = Math.max(player.effects.ghostUntil, now + bonusType.durationMs)
  }

  if (bonusId === 'freeze') {
    const enemies = players.filter((other) => other.id !== player.id && other.alive)
    const enemy = enemies.length > 0 ? randomFrom(enemies) : null
    if (enemy) {
      enemy.effects.frozenUntil = Math.max(enemy.effects.frozenUntil, now + bonusType.durationMs)
    }
  }

  if (player.snake.length > 0) {
    addFloatingMessageAtCell(player.snake[0], `+Bonus: ${bonusType.label}`, bonusType.colors[0], now)
  }

  bonusFruit = null
  setNextBonusSpawn(now)
}

function isEffectActive(until, now) {
  return until > now
}

function canUseWallPass(player, now) {
  const ghostActive = isEffectActive(player.effects.ghostUntil, now)
  const cooldownActive = isEffectActive(player.wallPassCooldownUntil, now)
  return ghostActive || !cooldownActive
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

function getConnectedGamepad() {
  if (!navigator.getGamepads) {
    return null
  }

  const gamepads = Array.from(navigator.getGamepads()).filter((gamepad) => gamepad && gamepad.connected)

  if (gamepads.length === 0) {
    activeGamepadIndex = null
    return null
  }

  let bestGamepad = null
  let bestScore = -1

  for (const gamepad of gamepads) {
    let score = 0

    for (const axis of gamepad.axes ?? []) {
      score = Math.max(score, Math.abs(axis))
    }

    for (const button of gamepad.buttons ?? []) {
      score = Math.max(score, button.value ?? (button.pressed ? 1 : 0))
    }

    if (score > bestScore) {
      bestScore = score
      bestGamepad = gamepad
    }
  }

  if (bestGamepad && bestScore >= GAMEPAD_DEADZONE) {
    activeGamepadIndex = bestGamepad.index
    return bestGamepad
  }

  if (activeGamepadIndex !== null) {
    const remembered = gamepads.find((gamepad) => gamepad.index === activeGamepadIndex)
    if (remembered) {
      return remembered
    }
  }

  activeGamepadIndex = gamepads[0].index
  return gamepads[0]
}

function buttonPressed(gamepad, index) {
  return Boolean(gamepad?.buttons?.[index]?.pressed)
}

function readGamepadAxes(gamepad) {
  const axes = gamepad?.axes ?? []
  const left = { x: axes[0] ?? 0, y: axes[1] ?? 0 }
  const right = { x: axes[2] ?? 0, y: axes[3] ?? 0 }
  const leftPower = Math.max(Math.abs(left.x), Math.abs(left.y))
  const rightPower = Math.max(Math.abs(right.x), Math.abs(right.y))
  return rightPower > leftPower ? right : left
}

function getGamepadDirection(gamepad) {
  if (!gamepad) {
    return null
  }

  const { x: xAxis, y: yAxis } = readGamepadAxes(gamepad)
  const upPressed = buttonPressed(gamepad, 12)
  const downPressed = buttonPressed(gamepad, 13)
  const leftPressed = buttonPressed(gamepad, 14)
  const rightPressed = buttonPressed(gamepad, 15)

  const faceUp = buttonPressed(gamepad, 3)
  const faceDown = buttonPressed(gamepad, 0)
  const faceLeft = buttonPressed(gamepad, 2)
  const faceRight = buttonPressed(gamepad, 1)

  const hatX = gamepad.axes?.[6] ?? 0
  const hatY = gamepad.axes?.[7] ?? 0

  if (upPressed || faceUp) return 'up'
  if (downPressed || faceDown) return 'down'
  if (leftPressed || faceLeft) return 'left'
  if (rightPressed || faceRight) return 'right'

  if (Math.abs(hatY) >= GAMEPAD_DEADZONE) {
    return hatY > 0 ? 'down' : 'up'
  }

  if (Math.abs(hatX) >= GAMEPAD_DEADZONE) {
    return hatX > 0 ? 'right' : 'left'
  }

  const absX = Math.abs(xAxis)
  const absY = Math.abs(yAxis)

  if (absX < GAMEPAD_DEADZONE && absY < GAMEPAD_DEADZONE) {
    return null
  }

  if (absX > absY) {
    return xAxis > 0 ? 'right' : 'left'
  }

  return yAxis > 0 ? 'down' : 'up'
}

function handleGamepadInput() {
  const p3 = players.find((player) => player.id === 'p3')
  if (!p3 || !p3.alive) {
    return
  }

  const gamepad = getConnectedGamepad()
  const nextDirection = pendingGamepadDirection || getGamepadDirection(gamepad)

  if (!nextDirection || isOppositeDirection(p3.direction, nextDirection)) {
    return
  }

  p3.nextDirection = nextDirection
  pendingGamepadDirection = null
}

function gamepadStatusText() {
  if (!navigator.getGamepads) {
    return 'Joystick: not connected'
  }

  const gamepad = getConnectedGamepad()
  if (!gamepad) {
    return 'Joystick: not connected'
  }

  return 'Joystick: connected'
}

function pollGamepadLoop() {
  const gamepad = getConnectedGamepad()
  const direction = getGamepadDirection(gamepad)

  if (direction) {
    pendingGamepadDirection = direction
    lastGamepadInputAt = getNow()
  }

  if (p3JoystickEl) {
    p3JoystickEl.textContent = gamepadStatusText()
  }

  window.requestAnimationFrame(pollGamepadLoop)
}

function resetGame() {
  isGameOver = false
  bonusFruit = null
  pendingGamepadDirection = null
  floatingMessages = []
  roundWinnerAwarded = false

  const now = getNow()
  lastGamepadInputAt = now
  setNextBonusSpawn(now)

  for (const player of players) {
    player.snake = cloneSnake(player.startSnake)
    player.direction = player.startDirection
    player.nextDirection = player.startDirection
    player.alive = true
    player.score = 0
    player.wallPassCooldownUntil = 0
    player.effects.doubleScoreUntil = 0
    player.effects.ghostUntil = 0
    player.effects.frozenUntil = 0
  }

  placeFoodSet()
  draw()
  updateHud()
}

function resetAllScores() {
  for (const player of players) {
    player.score = 0
    player.totalScore = 0
  }

  saveTotalScores()
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
  expireTimedEffects(now)
  maybeSpawnBonus(now)
  handleGamepadInput()

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
    const ghostActive = isEffectActive(player.effects.ghostUntil, now)
    const wallPassReady = !isEffectActive(player.wallPassCooldownUntil, now)
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

    const eatenFoodIndex = foods.findIndex((foodItem) => nextHead.x === foodItem.x && nextHead.y === foodItem.y)
    const grows = eatenFoodIndex !== -1
    const bonus = bonusFruit && nextHead.x === bonusFruit.x && nextHead.y === bonusFruit.y

    return {
      player,
      nextHead,
      ghostActive,
      usedWallPass,
      grows,
      eatenFoodIndex,
      bonus,
      dead: false,
    }
  })

  for (const move of moves) {
    if (!move || move.dead) {
      continue
    }

    const { nextHead, player, grows } = move

    if (!move.ghostActive && (nextHead.x < 0 || nextHead.x >= GRID_WIDTH || nextHead.y < 0 || nextHead.y >= GRID_HEIGHT)) {
      move.dead = true
      continue
    }

    for (const otherMove of moves) {
      if (!otherMove) {
        continue
      }

      const isOwnSnake = otherMove.player.id === player.id
      const skipTail = !otherMove.grows

      const ownBodyGhostPass = move.ghostActive && isOwnSnake

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

  const eatenFoodIndexes = new Set()

  for (const move of moves) {
    if (!move) {
      continue
    }

    if (move.dead) {
      move.player.alive = false
      continue
    }

    move.player.snake.unshift(move.nextHead)

    if (move.usedWallPass) {
      move.player.wallPassCooldownUntil = now + WALL_PASS_COOLDOWN_MS
      addFloatingMessageAtCell(move.player.snake[0], '-Wandpass 10s', '#fca5a5', now)
    }

    if (move.grows) {
      const points = isEffectActive(move.player.effects.doubleScoreUntil, now) ? 2 : 1
      move.player.score += points
      move.player.totalScore += points
      saveTotalScores()
      if (move.eatenFoodIndex >= 0) {
        eatenFoodIndexes.add(move.eatenFoodIndex)
      }
    } else {
      move.player.snake.pop()
    }

    if (move.bonus) {
      applyBonus(move.player, now)
    }
  }

  if (eatenFoodIndexes.size > 0) {
    increaseFoodTargetBy(eatenFoodIndexes.size)
    foods = foods.filter((_, index) => !eatenFoodIndexes.has(index))
    refillFoods()
  }

  const alivePlayers = players.filter((player) => player.alive)
  if (alivePlayers.length <= 1) {
    if (!roundWinnerAwarded && alivePlayers.length === 1) {
      const winner = alivePlayers[0]
      winner.score += ROUND_WINNER_BONUS_POINTS
      winner.totalScore += ROUND_WINNER_BONUS_POINTS
      saveTotalScores()
      if (winner.snake.length > 0) {
        addFloatingMessageAtCell(winner.snake[0], `+${ROUND_WINNER_BONUS_POINTS} Siegerbonus`, '#fde68a', now)
      }
      roundWinnerAwarded = true
    }
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
  for (const foodItem of foods) {
    const cx = foodItem.x * CELL_SIZE + CELL_SIZE / 2
    const cy = foodItem.y * CELL_SIZE + CELL_SIZE / 2

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
  const now = getNow()

  for (let i = player.snake.length - 1; i >= 0; i -= 1) {
    const segment = player.snake[i]
    const x = segment.x * CELL_SIZE
    const y = segment.y * CELL_SIZE

    if (i === 0) {
      const wallPassReady = canUseWallPass(player, now)
      const pulse = wallPassReady ? 0 : (Math.sin(now / 120) + 1) / 2
      const pulseInset = wallPassReady ? 2 : 2 + pulse * 2.6

      ctx.fillStyle = player.headColor
      ctx.fillRect(x + pulseInset, y + pulseInset, CELL_SIZE - pulseInset * 2, CELL_SIZE - pulseInset * 2)
      continue
    }

    ctx.fillStyle = player.color
    ctx.fillRect(x + 2, y + 2, CELL_SIZE - 4, CELL_SIZE - 4)
  }
}

function drawFloatingMessages() {
  const now = getNow()
  floatingMessages = floatingMessages.filter((message) => message.expiresAt > now)

  for (const message of floatingMessages) {
    const progress = (now - message.createdAt) / FLOATING_MESSAGE_MS
    const offsetY = 22 + progress * 22
    const alpha = 1 - progress

    ctx.save()
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha))
    ctx.fillStyle = message.color
    ctx.textAlign = 'center'
    ctx.font = '700 16px "Trebuchet MS", Verdana, sans-serif'
    ctx.fillText(message.text, message.x, message.y - offsetY)
    ctx.restore()
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

  drawFloatingMessages()

  drawOverlay()
}

function updateHud() {
  const now = getNow()
  for (const player of players) {
    const hud = playerHudById[player.id]
    if (!hud) {
      continue
    }

    hud.scoreEl.textContent = `Punkte Runde: ${player.score} | Gesamt: ${player.totalScore}`
    hud.stateEl.textContent = `Status: ${player.alive ? (isEffectActive(player.effects.frozenUntil, now) ? 'Eingefroren' : 'Aktiv') : 'Ausgeschieden'}`

    const effects = []
    if (isEffectActive(player.effects.doubleScoreUntil, now)) {
      effects.push(`Doppelpunkte ${secondsLeft(player.effects.doubleScoreUntil, now)}s`)
    }
    if (isEffectActive(player.effects.ghostUntil, now)) {
      effects.push(`Phasenmodus ${secondsLeft(player.effects.ghostUntil, now)}s`)
    }

    hud.effectsEl.textContent = `Effekte: ${effects.length > 0 ? effects.join(', ') : '-'}`
  }

  p3JoystickEl.textContent = gamepadStatusText()

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

window.addEventListener('gamepadconnected', (event) => {
  activeGamepadIndex = event.gamepad.index
  updateHud()
})

window.addEventListener('gamepaddisconnected', (event) => {
  if (activeGamepadIndex === event.gamepad.index) {
    activeGamepadIndex = null
  }
  updateHud()
})

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

resetScoresBtn.addEventListener('click', () => {
  resetAllScores()
})

applyStoredTotalScores()
resetGame()
pollGamepadLoop()
setInterval(step, TICK_MS)
