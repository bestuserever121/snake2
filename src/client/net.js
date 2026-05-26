export function connect() {
  return new Promise((resolve, reject) => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${proto}://${location.host}/ws`
    const ws = new WebSocket(url)
    const listeners = new Set()
    let connId = null

    const api = {
      get connId() { return connId },
      send(obj) {
        if (ws.readyState !== WebSocket.OPEN) return
        ws.send(JSON.stringify(obj))
      },
      on(handler) {
        listeners.add(handler)
        return () => listeners.delete(handler)
      },
    }

    ws.addEventListener('open', () => {
      // Wait for welcome before resolving so connId is known.
    })

    ws.addEventListener('message', (event) => {
      let msg
      try { msg = JSON.parse(event.data) } catch { return }
      if (msg.type === 'welcome') {
        connId = msg.connId
        resolve(api)
        return
      }
      for (const fn of listeners) fn(msg)
    })

    ws.addEventListener('error', () => {
      if (connId === null) reject(new Error('Verbindung zum Server fehlgeschlagen'))
    })

    ws.addEventListener('close', () => {
      for (const fn of listeners) fn({ type: 'disconnected' })
    })
  })
}
