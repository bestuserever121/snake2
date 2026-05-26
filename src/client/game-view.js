import { startInputCapture } from './input.js'
import { createPredictor } from './predictor.js'

const CELL_SIZE = 22
const GRID_WIDTH = 44
const GRID_HEIGHT = 30
const FLOATING_MESSAGE_MS = 1600
const TICK_MS = 50

export function mountGameView(net, { root, roomState, onBackToLobby }) {
  // Find this client's slot indexes.
  const mySlotIndexes = (roomState.slotAssignments || [])
    .map((ownerId, idx) => (ownerId === net.connId ? idx : -1))
    .filter((i) => i !== -1)

  const predictor = createPredictor(mySlotIndexes)
  const input = startInputCapture({
    net,
    mySlotIndexes,
    onLocalInput: (slot, dir) => predictor.onLocalInput(slot, dir),
  })
  const slotControls = input.getSlotControlLabels()

  let prevSnapshot = null
  let currSnapshot = null
  let currReceivedAt = 0
  let isHost = roomState.hostConnId === net.connId
  let stopped = false
  let lastBonusInfo = ''

  root.innerHTML = renderShell(roomState, isHost)
  const canvas = root.querySelector('#game-board')
  const ctx = canvas.getContext('2d')
  const statusEl = root.querySelector('#status')
  const bonusEl = root.querySelector('#bonus-info')
  const codeEl = root.querySelector('#room-code-display')
  const panelsEl = root.querySelector('#panels')
  const overlayEl = root.querySelector('#overlay')
  const overlayTitleEl = root.querySelector('#overlay-title')
  const overlaySubEl = root.querySelector('#overlay-sub')
  const overlayBtnEl = root.querySelector('#overlay-restart')
  const leaveBtn = root.querySelector('#btn-leave-game')
  const restartBtn = root.querySelector('#btn-restart')
  const resetBtn = root.querySelector('#btn-reset-scores')
  const gamepadStatusEl = root.querySelector('#gamepad-status')

  if (codeEl) codeEl.textContent = roomState.code

  function updateButtons() {
    if (restartBtn) restartBtn.style.display = isHost ? '' : 'none'
    if (resetBtn) resetBtn.style.display = isHost ? '' : 'none'
    if (overlayBtnEl) overlayBtnEl.style.display = isHost ? '' : 'none'
  }
  updateButtons()

  leaveBtn?.addEventListener('click', () => {
    net.send({ type: 'leave-room' })
    cleanup()
    onBackToLobby()
  })

  restartBtn?.addEventListener('click', () => {
    if (isHost) net.send({ type: 'restart-round' })
  })

  resetBtn?.addEventListener('click', () => {
    if (isHost && confirm('Alle Punkte in diesem Raum zurücksetzen?')) {
      net.send({ type: 'reset-scores' })
    }
  })

  overlayBtnEl?.addEventListener('click', () => {
    if (isHost) net.send({ type: 'restart-round' })
  })

  const unsubscribe = net.on((msg) => {
    if (msg.type === 'game-state') {
      prevSnapshot = currSnapshot
      currSnapshot = msg.state
      currReceivedAt = performance.now()
      predictor.onSnapshot(msg.state)
      renderHud()
    } else if (msg.type === 'room-state') {
      // Host may have changed; update buttons.
      isHost = msg.hostConnId === net.connId
      updateButtons()
      // If the host clicked restart, status flips back to playing; hide overlay.
      if (msg.status === 'playing' && overlayEl) overlayEl.classList.remove('show')
      // If we got kicked back to lobby somehow.
      if (msg.status === 'lobby') {
        cleanup()
        onBackToLobby()
      }
    } else if (msg.type === 'game-over') {
      // The next game-state snapshot will arrive with status='gameover'; overlay
      // is drawn from that.
    } else if (msg.type === 'disconnected') {
      cleanup()
      onBackToLobby()
    }
  })

  function cleanup() {
    if (stopped) return
    stopped = true
    unsubscribe()
    input.dispose()
    cancelAnimationFrame(rafId)
  }

  // Render loop (decoupled from server tick rate for animation smoothness).
  let rafId = 0
  function frame() {
    if (stopped) return
    if (currSnapshot) {
      const perfNow = performance.now()
      const serverProgress = Math.max(0, Math.min(1, (perfNow - currReceivedAt) / TICK_MS))
      const predicted = predictor.getPrediction(perfNow)
      draw(currSnapshot, prevSnapshot, serverProgress, predicted)
    }
    rafId = requestAnimationFrame(frame)
  }
  rafId = requestAnimationFrame(frame)

  function draw(snap, prev, serverProgress, predicted) {
    const now = Date.now()

    ctx.fillStyle = '#0b1220'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    drawGrid(ctx)
    drawFoods(ctx, snap.foods)
    drawBonus(ctx, snap.bonus, now)

    const prevById = new Map(prev ? prev.snakes.map((s) => [s.slotIndex, s]) : [])
    const predNowById = predicted ? new Map(predicted.snakesNow.map((s) => [s.slotIndex, s])) : null
    const predNextById = predicted ? new Map(predicted.snakesNext.map((s) => [s.slotIndex, s])) : null

    for (const snake of snap.snakes) {
      if (!snake.alive) continue
      if (predicted && predicted.ownSlots.has(snake.slotIndex)) {
        // Own snake: render predicted, interpolating between predicted-now and predicted-next.
        const sNow = predNowById.get(snake.slotIndex)
        const sNext = predNextById.get(snake.slotIndex)
        if (sNow && sNext && sNow.alive && sNext.alive) {
          drawSnake(ctx, sNext, sNow, predicted.progress, now)
          continue
        }
      }
      // Other snakes (or own when prediction unavailable): interpolate server prev->curr.
      const prevSnake = prevById.get(snake.slotIndex)
      drawSnake(ctx, snake, prevSnake, serverProgress, now)
    }

    drawFloatingMessages(ctx, snap.floatingMessages, now)

    if (snap.status === 'gameover') {
      drawOverlay(ctx, snap)
      if (overlayEl) {
        overlayEl.classList.add('show')
        if (overlayTitleEl) overlayTitleEl.textContent = 'Runde beendet'
        if (overlaySubEl) {
          const winner = snap.winnerSlotIndex != null ? snap.snakes.find((s) => s.slotIndex === snap.winnerSlotIndex) : null
          overlaySubEl.innerHTML = winner
            ? `<span class="winner-name" style="border-color: ${winner.color}; color: ${winner.headColor};">🏆 ${escapeHtml(winner.label)}</span><br/><span style="display:inline-block;margin-top:6px">gewinnt die Runde · +10 Bonuspunkte</span>`
            : 'Unentschieden — niemand überlebt'
        }
      }
    } else if (overlayEl) {
      overlayEl.classList.remove('show')
    }
  }

  function renderHud() {
    if (!currSnapshot) return
    const now = Date.now()

    if (statusEl) {
      const playing = currSnapshot.status === 'playing'
      statusEl.className = `status ${playing ? 'live' : 'ended'}`
      statusEl.innerHTML = `<span class="status-dot ${playing ? 'live' : 'idle'}"></span>${playing ? 'Läuft' : 'Runde beendet'}`
    }

    if (bonusEl) {
      bonusEl.classList.remove('urgent', 'spawned')
      if (currSnapshot.bonus) {
        const remaining = currSnapshot.bonus.expiresAt - now
        const secs = Math.max(0, Math.ceil(remaining / 1000))
        const info = `🎁 ${currSnapshot.bonus.type.label} · ${secs}s`
        if (info !== lastBonusInfo) { bonusEl.textContent = info; lastBonusInfo = info }
        if (remaining < 2500) bonusEl.classList.add('urgent')
        else bonusEl.classList.add('spawned')
      } else {
        const secs = Math.max(0, Math.ceil((currSnapshot.nextBonusSpawnAt - now) / 1000))
        const info = `Nächster Bonus in ${secs}s`
        if (info !== lastBonusInfo) { bonusEl.textContent = info; lastBonusInfo = info }
      }
    }

    if (panelsEl) {
      panelsEl.innerHTML = currSnapshot.snakes.map((s) => renderPanel(s, mySlotIndexes.includes(s.slotIndex), slotControls[s.slotIndex], now)).join('')
    }

    if (gamepadStatusEl) {
      const status = input.getGamepadStatus()
      gamepadStatusEl.textContent = status || ''
      gamepadStatusEl.style.display = status ? '' : 'none'
    }
  }

  // Refresh HUD timers each second even if no new snapshot arrived.
  const hudInterval = setInterval(renderHud, 200)
  const origCleanup = cleanup
  // wrap cleanup once more to clear interval
  const wrappedCleanup = () => { clearInterval(hudInterval); origCleanup() }
  return { cleanup: wrappedCleanup }
}

function renderShell(roomState, isHost) {
  return `
    <div class="game-shell">
      <header class="hud">
        <h1>Snake Arena</h1>
        <div class="room-tag">Raum<strong id="room-code-display">${roomState.code}</strong></div>
        <div class="status live" id="status"><span class="status-dot live"></span>Läuft</div>
        <div class="bonus-info" id="bonus-info">Bonus wartet…</div>
        <span class="hud-spacer"></span>
        <button id="btn-reset-scores" type="button" class="btn ghost tiny" style="${isHost ? '' : 'display:none'}">Punkte reset</button>
        <button id="btn-restart" type="button" class="btn primary" style="${isHost ? '' : 'display:none'}">Neue Runde</button>
        <button id="btn-leave-game" type="button" class="btn ghost">Verlassen</button>
      </header>

      <section id="panels" class="panels"></section>

      <section class="board-wrap">
        <canvas id="game-board" width="${GRID_WIDTH * CELL_SIZE}" height="${GRID_HEIGHT * CELL_SIZE}"></canvas>
        <p class="help">Wandpass-Cooldown 10s. Bonus-Früchte geben zeitliche Vorteile. Sieger jeder Runde: +10 Punkte.</p>
        <div id="overlay" class="game-overlay">
          <h2 id="overlay-title">Runde beendet</h2>
          <p id="overlay-sub"></p>
          <button id="overlay-restart" class="btn primary">Neue Runde</button>
        </div>
        <p id="gamepad-status" class="gamepad-status"></p>
      </section>
    </div>
  `
}

function renderPanel(snake, isMine, controlLabel, now) {
  const isFrozen = snake.effects.frozenUntil > now
  let statusText, statusDotClass
  if (!snake.alive) { statusText = 'Ausgeschieden'; statusDotClass = 'dim' }
  else if (isFrozen) { statusText = 'Eingefroren'; statusDotClass = 'idle' }
  else { statusText = 'Aktiv'; statusDotClass = 'live' }

  const effects = []
  if (snake.effects.doubleScoreUntil > now) effects.push(`✨ Doppelpunkte ${secs(snake.effects.doubleScoreUntil - now)}s`)
  if (snake.effects.ghostUntil > now) effects.push(`👻 Phasenmodus ${secs(snake.effects.ghostUntil - now)}s`)
  if (snake.wallPassCooldownUntil > now) effects.push(`🧱 Wand-CD ${secs(snake.wallPassCooldownUntil - now)}s`)
  const effectText = effects.length ? effects.join(' · ') : '—'

  return `
    <article class="panel ${isMine ? 'mine' : ''} ${!snake.alive ? 'dead' : ''}" style="--snake-color: ${snake.color}; --snake-head: ${snake.headColor}">
      <header>
        <h2>${escapeHtml(snake.label)}</h2>
        ${snake.isBot ? '<span class="badge bot">Bot</span>' : ''}
        ${isMine ? '<span class="badge you">Du</span>' : ''}
      </header>
      ${controlLabel ? `<p class="controls">${controlLabel}</p>` : ''}
      <p class="score"><span><span class="label">Runde</span><strong>${snake.score}</strong></span><span><span class="label">Gesamt</span><strong>${snake.totalScore}</strong></span></p>
      <p class="state"><span class="status-dot ${statusDotClass}"></span>${statusText}</p>
      <p class="effects">${effectText}</p>
    </article>
  `
}

function secs(ms) {
  return Math.max(0, Math.ceil(ms / 1000))
}

// --- Drawing ---

function drawGrid(ctx) {
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
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

function drawFoods(ctx, foods) {
  for (const f of foods) {
    const cx = f.x * CELL_SIZE + CELL_SIZE / 2
    const cy = f.y * CELL_SIZE + CELL_SIZE / 2
    ctx.fillStyle = '#ffe08a'
    ctx.beginPath(); ctx.arc(cx, cy, CELL_SIZE * 0.4, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#f8961e'
    ctx.beginPath(); ctx.arc(cx, cy, CELL_SIZE * 0.3, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#f94144'
    ctx.beginPath(); ctx.arc(cx, cy, CELL_SIZE * 0.22, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = '#fff8de'
    ctx.lineWidth = 1.6
    ctx.beginPath(); ctx.arc(cx, cy, CELL_SIZE * 0.42, 0, Math.PI * 2); ctx.stroke()
    ctx.fillStyle = '#d8f3a4'
    ctx.beginPath()
    ctx.ellipse(cx + CELL_SIZE * 0.16, cy - CELL_SIZE * 0.2, CELL_SIZE * 0.1, CELL_SIZE * 0.06, -0.6, 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawBonus(ctx, bonus, now) {
  if (!bonus) return
  const cx = bonus.x * CELL_SIZE + CELL_SIZE / 2
  const cy = bonus.y * CELL_SIZE + CELL_SIZE / 2
  const [outer, mid, inner] = bonus.type.colors

  // Subtle pulsing as the bonus approaches expiry.
  const remaining = Math.max(0, bonus.expiresAt - now)
  const urgent = remaining < 2500
  const pulse = urgent ? (Math.sin(now / 90) + 1) / 2 : 0
  const scale = 1 + pulse * 0.08

  ctx.fillStyle = outer
  ctx.beginPath(); ctx.arc(cx, cy, CELL_SIZE * 0.42 * scale, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = mid
  ctx.beginPath(); ctx.arc(cx, cy, CELL_SIZE * 0.3 * scale, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = inner
  ctx.beginPath(); ctx.arc(cx, cy, CELL_SIZE * 0.18 * scale, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 1.4
  ctx.beginPath(); ctx.arc(cx, cy, CELL_SIZE * 0.44 * scale, 0, Math.PI * 2); ctx.stroke()
}

function lerpSegment(prev, curr, t) {
  if (!prev) return curr
  // Detect wrap (jumped more than 1 cell in any axis) — don't animate across the board.
  if (Math.abs(curr.x - prev.x) > 1 || Math.abs(curr.y - prev.y) > 1) return curr
  return { x: prev.x + (curr.x - prev.x) * t, y: prev.y + (curr.y - prev.y) * t }
}

function drawBodyCell(ctx, pos, color) {
  ctx.fillStyle = color
  ctx.fillRect(pos.x * CELL_SIZE + 2, pos.y * CELL_SIZE + 2, CELL_SIZE - 4, CELL_SIZE - 4)
}

function drawHeadCell(ctx, pos, snake, now) {
  const wallPassReady = snake.wallPassCooldownUntil <= now
  const pulse = wallPassReady ? 0 : (Math.sin(now / 120) + 1) / 2
  const inset = wallPassReady ? 2 : 2 + pulse * 2.6
  ctx.fillStyle = snake.headColor
  ctx.fillRect(pos.x * CELL_SIZE + inset, pos.y * CELL_SIZE + inset, CELL_SIZE - inset * 2, CELL_SIZE - inset * 2)
}

function drawSnake(ctx, snake, prevSnake, progress, now) {
  const segs = snake.segments
  const last = segs.length - 1

  // Receding tail: extra cell only present during the tween. Without it,
  // the snake would have a visible gap because curr's body[last] occupies
  // a cell that was prev's body[last-1].
  if (prevSnake && prevSnake.segments.length > 0) {
    const prevTail = prevSnake.segments[prevSnake.segments.length - 1]
    const currTail = segs[last]
    const tailPos = lerpSegment(prevTail, currTail, progress)
    drawBodyCell(ctx, tailPos, snake.color)
  }

  // Body cells (curr[1..last]).
  for (let i = last; i >= 1; i -= 1) {
    drawBodyCell(ctx, segs[i], snake.color)
  }

  // Head — interpolated from prev head to curr head.
  let headPos = segs[0]
  if (prevSnake && prevSnake.segments[0]) {
    headPos = lerpSegment(prevSnake.segments[0], segs[0], progress)
  }
  drawHeadCell(ctx, headPos, snake, now)
}

function drawFloatingMessages(ctx, messages, now) {
  for (const m of messages) {
    if (m.expiresAt <= now) continue
    const progress = (now - m.createdAt) / FLOATING_MESSAGE_MS
    if (progress < 0 || progress > 1) continue
    const offsetY = 22 + progress * 22
    const alpha = 1 - progress
    ctx.save()
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha))
    ctx.fillStyle = m.color
    ctx.textAlign = 'center'
    ctx.font = '700 16px "Trebuchet MS", Verdana, sans-serif'
    ctx.fillText(m.text, m.x, m.y - offsetY)
    ctx.restore()
  }
}

function drawOverlay(ctx, snap) {
  ctx.fillStyle = 'rgba(6,10,18,0.55)'
  ctx.fillRect(0, 0, GRID_WIDTH * CELL_SIZE, GRID_HEIGHT * CELL_SIZE)
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]))
}
