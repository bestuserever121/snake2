const GAMEPAD_DEADZONE = 0.12

const KEYBOARD_MAPS = [
  { w: 'up', s: 'down', a: 'left', d: 'right' },
  { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' },
]

/**
 * Manages local input for slots owned by this connection.
 * - First local slot → WASD
 * - Second local slot → Arrow keys
 * - Third local slot → Gamepad
 *
 * Returns { dispose, getGamepadStatus, getSlotControlLabels }.
 */
export function startInputCapture({ net, mySlotIndexes, onLocalInput }) {
  const lastSentDirection = new Map() // slotIndex -> direction
  let activeGamepadIndex = null
  let lastGamepadDirection = null
  let stopped = false
  let rafId = 0

  const keyboardSlots = mySlotIndexes.slice(0, 2)
  const gamepadSlot = mySlotIndexes[2] ?? null

  function sendDirection(slotIndex, direction) {
    if (!direction) return
    if (lastSentDirection.get(slotIndex) === direction) return
    lastSentDirection.set(slotIndex, direction)
    net.send({ type: 'input', slotIndex, direction })
    onLocalInput?.(slotIndex, direction)
  }

  function onKeyDown(event) {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
    let consumed = false
    for (let i = 0; i < keyboardSlots.length; i += 1) {
      const slotIndex = keyboardSlots[i]
      const map = KEYBOARD_MAPS[i]
      const direction = map[key]
      if (direction) {
        sendDirection(slotIndex, direction)
        consumed = true
      }
    }
    if (consumed) event.preventDefault()
  }

  window.addEventListener('keydown', onKeyDown)

  function getConnectedGamepad() {
    if (!navigator.getGamepads) return null
    const pads = Array.from(navigator.getGamepads()).filter((g) => g && g.connected)
    if (pads.length === 0) { activeGamepadIndex = null; return null }

    let best = null
    let bestScore = -1
    for (const pad of pads) {
      let score = 0
      for (const axis of pad.axes ?? []) score = Math.max(score, Math.abs(axis))
      for (const btn of pad.buttons ?? []) score = Math.max(score, btn.value ?? (btn.pressed ? 1 : 0))
      if (score > bestScore) { bestScore = score; best = pad }
    }
    if (best && bestScore >= GAMEPAD_DEADZONE) { activeGamepadIndex = best.index; return best }
    if (activeGamepadIndex !== null) {
      const remembered = pads.find((p) => p.index === activeGamepadIndex)
      if (remembered) return remembered
    }
    activeGamepadIndex = pads[0].index
    return pads[0]
  }

  function buttonPressed(pad, idx) {
    return Boolean(pad?.buttons?.[idx]?.pressed)
  }

  function readGamepadDirection(pad) {
    if (!pad) return null
    const axes = pad.axes ?? []
    const left = { x: axes[0] ?? 0, y: axes[1] ?? 0 }
    const right = { x: axes[2] ?? 0, y: axes[3] ?? 0 }
    const lp = Math.max(Math.abs(left.x), Math.abs(left.y))
    const rp = Math.max(Math.abs(right.x), Math.abs(right.y))
    const stick = rp > lp ? right : left
    const { x, y } = stick

    if (buttonPressed(pad, 12) || buttonPressed(pad, 3)) return 'up'
    if (buttonPressed(pad, 13) || buttonPressed(pad, 0)) return 'down'
    if (buttonPressed(pad, 14) || buttonPressed(pad, 2)) return 'left'
    if (buttonPressed(pad, 15) || buttonPressed(pad, 1)) return 'right'

    const hatX = pad.axes?.[6] ?? 0
    const hatY = pad.axes?.[7] ?? 0
    if (Math.abs(hatY) >= GAMEPAD_DEADZONE) return hatY > 0 ? 'down' : 'up'
    if (Math.abs(hatX) >= GAMEPAD_DEADZONE) return hatX > 0 ? 'right' : 'left'

    const ax = Math.abs(x), ay = Math.abs(y)
    if (ax < GAMEPAD_DEADZONE && ay < GAMEPAD_DEADZONE) return null
    if (ax > ay) return x > 0 ? 'right' : 'left'
    return y > 0 ? 'down' : 'up'
  }

  function pollGamepad() {
    if (stopped) return
    if (gamepadSlot !== null) {
      const pad = getConnectedGamepad()
      const dir = readGamepadDirection(pad)
      if (dir && dir !== lastGamepadDirection) {
        lastGamepadDirection = dir
        sendDirection(gamepadSlot, dir)
      } else if (!dir) {
        lastGamepadDirection = null
      }
    }
    rafId = requestAnimationFrame(pollGamepad)
  }

  rafId = requestAnimationFrame(pollGamepad)

  function getGamepadStatus() {
    if (gamepadSlot === null) return null
    if (!navigator.getGamepads) return 'Joystick: nicht unterstützt'
    const pad = getConnectedGamepad()
    return pad ? 'Joystick: verbunden' : 'Joystick: nicht verbunden'
  }

  function getSlotControlLabels() {
    const labels = {}
    keyboardSlots.forEach((slotIndex, i) => {
      labels[slotIndex] = i === 0 ? 'WASD' : 'Pfeiltasten'
    })
    if (gamepadSlot !== null) labels[gamepadSlot] = 'Gamepad'
    return labels
  }

  function dispose() {
    stopped = true
    cancelAnimationFrame(rafId)
    window.removeEventListener('keydown', onKeyDown)
  }

  return { dispose, getGamepadStatus, getSlotControlLabels }
}
