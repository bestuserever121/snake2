import { startInputCapture } from './input.js'

const CELL_SIZE = 22
const GRID_WIDTH = 44
const GRID_HEIGHT = 30
const FLOATING_MESSAGE_MS = 1600

export function mountGameView(net, { root, roomState, onBackToLobby }) {
  // Find this client's slot indexes.
  const mySlotIndexes = (roomState.slotAssignments || [])
    .map((ownerId, idx) => (ownerId === net.connId ? idx : -1))
    .filter((i) => i !== -1)

  const input = startInputCapture({ net, mySlotIndexes })
  const slotControls = input.getSlotControlLabels()

  let latestSnapshot = null
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
      latestSnapshot = msg.state
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
    if (latestSnapshot) draw(latestSnapshot)
    rafId = requestAnimationFrame(frame)
  }
  rafId = requestAnimationFrame(frame)

  function draw(snap) {
    const now = Date.now()

    ctx.fillStyle = '#0b1220'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    drawGrid(ctx)
    drawFoods(ctx, snap.foods)
    drawBonus(ctx, snap.bonus, now)

    for (const snake of snap.snakes) {
      if (snake.alive) drawSnake(ctx, snake, now)
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
    if (!latestSnapshot) return
    const now = Date.now()

    if (statusEl) {
      const playing = latestSnapshot.status === 'playing'
      statusEl.className = `status ${playing ? 'live' : 'ended'}`
      statusEl.innerHTML = `<span class="status-dot ${playing ? 'live' : 'idle'}"></span>${playing ? 'Läuft' : 'Runde beendet'}`
    }

    if (bonusEl) {
      bonusEl.classList.remove('urgent', 'spawned')
      if (latestSnapshot.bonus) {
        const remaining = latestSnapshot.bonus.expiresAt - now
        const secs = Math.max(0, Math.ceil(remaining / 1000))
        const info = `🎁 ${latestSnapshot.bonus.type.label} · ${secs}s`
        if (info !== lastBonusInfo) { bonusEl.textContent = info; lastBonusInfo = info }
        if (remaining < 2500) bonusEl.classList.add('urgent')
        else bonusEl.classList.add('spawned')
      } else {
        const secs = Math.max(0, Math.ceil((latestSnapshot.nextBonusSpawnAt - now) / 1000))
        const info = `Nächster Bonus in ${secs}s`
        if (info !== lastBonusInfo) { bonusEl.textContent = info; lastBonusInfo = info }
      }
    }

    if (panelsEl) {
      panelsEl.innerHTML = latestSnapshot.snakes.map((s) => renderPanel(s, mySlotIndexes.includes(s.slotIndex), slotControls[s.slotIndex], now)).join('')
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

function drawSnake(ctx, snake, now) {
  for (let i = snake.segments.length - 1; i >= 0; i -= 1) {
    const seg = snake.segments[i]
    const x = seg.x * CELL_SIZE
    const y = seg.y * CELL_SIZE

    if (i === 0) {
      const wallPassReady = snake.wallPassCooldownUntil <= now
      const pulse = wallPassReady ? 0 : (Math.sin(now / 120) + 1) / 2
      const inset = wallPassReady ? 2 : 2 + pulse * 2.6
      ctx.fillStyle = snake.headColor
      ctx.fillRect(x + inset, y + inset, CELL_SIZE - inset * 2, CELL_SIZE - inset * 2)
      continue
    }
    ctx.fillStyle = snake.color
    ctx.fillRect(x + 2, y + 2, CELL_SIZE - 4, CELL_SIZE - 4)
  }
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
