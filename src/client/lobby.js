const NAME_KEY = 'snake-arena-name'
const SLOTS_KEY = 'snake-arena-local-slots'

const SLOT_CONTROL_LABELS = [
  'WASD',
  'Pfeiltasten',
  'Gamepad / Joystick',
]

function readStoredName() {
  try { return localStorage.getItem(NAME_KEY) || '' } catch { return '' }
}

function storeName(name) {
  try { localStorage.setItem(NAME_KEY, name) } catch { /* noop */ }
}

function readStoredSlots() {
  try {
    const v = Number(localStorage.getItem(SLOTS_KEY))
    return Number.isInteger(v) && v >= 1 && v <= 3 ? v : 1
  } catch { return 1 }
}

function storeSlots(n) {
  try { localStorage.setItem(SLOTS_KEY, String(n)) } catch { /* noop */ }
}

export function mountLobby(net, { onGameStart, root }) {
  let view = 'welcome'        // 'welcome' | 'lobby' | 'gameover'
  let pendingAction = null    // 'create' | 'join'
  let pendingCode = ''
  let name = readStoredName() || 'Spieler'
  let localSlots = readStoredSlots()
  let roomState = null
  let errorMsg = ''
  let gameOverMsg = ''

  const unsubscribe = net.on((msg) => {
    if (msg.type === 'room-state') {
      roomState = msg
      errorMsg = ''
      // Transition from welcome to lobby on first room-state.
      if (view === 'welcome' || view === 'gameover') {
        view = 'lobby'
      }
      // If status flipped to 'playing' and we're in lobby, hand off to game view.
      if (roomState.status === 'playing') {
        cleanup()
        onGameStart({ roomState, name, localSlots })
        return
      }
      render()
    } else if (msg.type === 'error') {
      errorMsg = msg.message
      render()
    } else if (msg.type === 'game-over') {
      // Handled in game-view; lobby will get next room-state with status='gameover'.
    } else if (msg.type === 'disconnected') {
      errorMsg = 'Verbindung verloren. Bitte Seite neu laden.'
      render()
    }
  })

  function cleanup() {
    unsubscribe()
  }

  function render() {
    if (view === 'welcome') renderWelcome()
    else if (view === 'lobby') renderRoomLobby()
  }

  function renderWelcome() {
    root.innerHTML = `
      <div class="welcome">
        <h1>Snake Arena Online</h1>
        <p class="tagline">4-Spieler Snake im Browser. Räume per Code teilen, leere Plätze füllen Bots.</p>

        <label class="field">
          <span>Dein Name</span>
          <input type="text" id="welcome-name" maxlength="20" value="${escapeHtml(name)}" placeholder="Spieler"/>
        </label>

        <fieldset class="field slots-field">
          <legend>Lokale Spieler an diesem Gerät</legend>
          <p class="hint">Du kannst bis zu 3 Spieler von einem Browser steuern (z.B. WASD + Pfeile + Gamepad).</p>
          <div class="slot-options">
            ${[1, 2, 3].map((n) => `
              <label class="slot-option ${localSlots === n ? 'active' : ''}">
                <input type="radio" name="local-slots" value="${n}" ${localSlots === n ? 'checked' : ''}/>
                <strong>${n} Spieler</strong>
                <span class="ctrl">${slotControlsPreview(n)}</span>
              </label>
            `).join('')}
          </div>
        </fieldset>

        <div class="actions">
          <button class="btn primary" id="btn-create">Raum erstellen</button>
          <div class="join-group">
            <input type="text" id="join-code" maxlength="4" placeholder="CODE" autocomplete="off"/>
            <button class="btn secondary" id="btn-join">Beitreten</button>
          </div>
        </div>

        ${errorMsg ? `<p class="error">${escapeHtml(errorMsg)}</p>` : ''}
      </div>
    `

    const nameEl = root.querySelector('#welcome-name')
    nameEl.addEventListener('input', () => {
      name = nameEl.value
      storeName(name)
    })

    root.querySelectorAll('input[name="local-slots"]').forEach((el) => {
      el.addEventListener('change', () => {
        localSlots = Number(el.value)
        storeSlots(localSlots)
        render()
      })
    })

    root.querySelector('#btn-create').addEventListener('click', () => {
      const trimmed = (name || '').trim()
      if (!trimmed) { errorMsg = 'Bitte gib deinen Namen ein'; render(); return }
      net.send({ type: 'create-room', playerName: trimmed, localSlots })
    })

    const joinCodeEl = root.querySelector('#join-code')
    joinCodeEl.addEventListener('input', () => {
      joinCodeEl.value = joinCodeEl.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)
    })

    root.querySelector('#btn-join').addEventListener('click', () => {
      const trimmed = (name || '').trim()
      const code = joinCodeEl.value
      if (!trimmed) { errorMsg = 'Bitte gib deinen Namen ein'; render(); return }
      if (code.length !== 4) { errorMsg = 'Code muss 4 Zeichen lang sein'; render(); return }
      net.send({ type: 'join-room', code, playerName: trimmed, localSlots })
    })
  }

  function renderRoomLobby() {
    const isHost = roomState.hostConnId === net.connId
    const status = roomState.status
    const slotAssignments = roomState.slotAssignments || [null, null, null, null]
    const members = roomState.members || []
    const memberById = new Map(members.map((m) => [m.connId, m]))
    const slotColors = ['#43aa8b', '#f3722c', '#5b7cfa', '#e879f9']

    root.innerHTML = `
      <div class="room-lobby">
        <header class="room-header">
          <div>
            <p class="label">Raum-Code</p>
            <p class="code">${escapeHtml(roomState.code)}</p>
            <div class="code-actions">
              <button class="copy-btn" id="btn-copy"><span class="check">📋</span> <span id="copy-label">kopieren</span></button>
            </div>
          </div>
          <div class="status-pill ${status}">
            <span class="status-dot ${status === 'playing' ? 'live' : status === 'gameover' ? 'idle' : 'dim'}"></span>
            ${statusLabel(status)}
          </div>
        </header>

        <section class="slots-grid">
          ${slotAssignments.map((ownerId, idx) => slotCard(idx, ownerId, memberById)).join('')}
        </section>

        <section class="members">
          <h3>Spieler im Raum (${members.length})</h3>
          <ul>
            ${members.map((m) => `
              <li>
                <span class="player-dots">
                  ${m.slots.map((s) => `<span class="player-dot" style="--dot-color:${slotColors[s]}" title="Slot ${s + 1}"></span>`).join('')}
                </span>
                <strong>${escapeHtml(m.name)}</strong>
                ${m.connId === roomState.hostConnId ? '<span class="badge host">Host</span>' : ''}
                ${m.connId === net.connId ? '<span class="badge you">Du</span>' : ''}
                <span class="muted">${m.slots.length} Slot${m.slots.length === 1 ? '' : 's'}</span>
              </li>
            `).join('')}
          </ul>
        </section>

        <div class="actions">
          ${isHost ? `<button class="btn primary" id="btn-start">${status === 'gameover' ? 'Neue Runde' : 'Spiel starten'}</button>` : `<p class="hint">Warte auf Host…</p>`}
          ${isHost ? `<button class="btn ghost" id="btn-reset-scores">Punkte zurücksetzen</button>` : ''}
          <button class="btn ghost" id="btn-leave">Raum verlassen</button>
        </div>

        ${errorMsg ? `<p class="error">${escapeHtml(errorMsg)}</p>` : ''}
      </div>
    `

    const copyBtn = root.querySelector('#btn-copy')
    const copyLabel = root.querySelector('#copy-label')
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(roomState.code)
        copyBtn.classList.add('copied')
        copyLabel.textContent = '✓ kopiert'
        clearTimeout(copyBtn._t)
        copyBtn._t = setTimeout(() => {
          copyBtn.classList.remove('copied')
          copyLabel.textContent = 'kopieren'
        }, 1500)
      } catch { /* noop */ }
    })

    if (isHost) {
      const startBtn = root.querySelector('#btn-start')
      if (startBtn) startBtn.addEventListener('click', () => {
        if (status === 'gameover') net.send({ type: 'restart-round' })
        else net.send({ type: 'start-game' })
      })
      const resetBtn = root.querySelector('#btn-reset-scores')
      if (resetBtn) resetBtn.addEventListener('click', () => {
        if (confirm('Alle Punkte in diesem Raum zurücksetzen?')) net.send({ type: 'reset-scores' })
      })
    }

    root.querySelector('#btn-leave').addEventListener('click', () => {
      net.send({ type: 'leave-room' })
      roomState = null
      view = 'welcome'
      render()
    })
  }

  render()

  return {
    showGameOver(msg) {
      gameOverMsg = msg
      view = 'lobby'
      render()
    },
    cleanup,
  }
}

function statusLabel(status) {
  if (status === 'lobby') return 'Wartet auf Start'
  if (status === 'playing') return 'Läuft'
  if (status === 'gameover') return 'Runde beendet'
  return status
}

function slotControlsPreview(n) {
  return Array.from({ length: n }, (_, i) => SLOT_CONTROL_LABELS[i]).join(' • ')
}

function slotCard(idx, ownerId, memberById) {
  const colors = ['#43aa8b', '#f3722c', '#5b7cfa', '#e879f9']
  const owner = ownerId ? memberById.get(ownerId) : null
  const isEmpty = !owner
  const label = owner ? owner.name : 'wird Bot'
  return `
    <div class="slot-card ${isEmpty ? 'empty' : ''}" style="--slot-color: ${colors[idx]}">
      <span class="slot-color-bar" aria-hidden="true"></span>
      <div class="slot-num">Slot ${idx + 1}</div>
      <div class="slot-owner">${escapeHtml(label)}</div>
      ${isEmpty ? '<div class="slot-badge">Bot</div>' : ''}
    </div>
  `
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]))
}
