import './style.css'
import { connect } from './client/net.js'
import { mountLobby } from './client/lobby.js'
import { mountGameView } from './client/game-view.js'

const root = document.querySelector('#app')

function showConnecting() {
  root.innerHTML = `
    <div class="connecting">
      <div class="spinner" aria-hidden="true"></div>
      <p>Verbinde mit Server…</p>
    </div>
  `
}

function showError(msg) {
  const safe = String(msg).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  root.innerHTML = `
    <div class="error-screen">
      <h2>Verbindung fehlgeschlagen</h2>
      <p>${safe}</p>
      <button class="btn primary" onclick="location.reload()">Neu laden</button>
    </div>
  `
}

async function start() {
  showConnecting()
  let net
  try {
    net = await connect()
  } catch (err) {
    showError(err.message || String(err))
    return
  }

  let currentView = null

  function showLobby() {
    if (currentView?.cleanup) currentView.cleanup()
    currentView = mountLobby(net, {
      root,
      onGameStart: ({ roomState }) => {
        if (currentView?.cleanup) currentView.cleanup()
        currentView = mountGameView(net, {
          root,
          roomState,
          onBackToLobby: () => {
            currentView = null
            showLobby()
          },
        })
      },
    })
  }

  showLobby()
}

start()
