import { createGameState, applyInput, stepGame, snapshot } from './game.js'
import { pickBotDirection } from './bot.js'
import { CLIENT_MSG, SERVER_MSG, MAX_SLOTS, MAX_LOCAL_SLOTS, TICK_MS } from './protocol.js'

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no O/0/I/1

function randomCode() {
  let code = ''
  for (let i = 0; i < 4; i += 1) {
    code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)]
  }
  return code
}

/**
 * @typedef {Object} Member
 * @property {string} connId
 * @property {string} name
 * @property {import('ws').WebSocket} ws
 */

/**
 * @typedef {Object} Room
 * @property {string} code
 * @property {string} hostConnId
 * @property {'lobby'|'playing'|'gameover'} status
 * @property {Map<string, Member>} members
 * @property {(string|null)[]} slotAssignments  // length MAX_SLOTS, value is connId or null
 * @property {Map<number, number>} totalScores  // slotIndex -> totalScore (persists across rounds in a room)
 * @property {any|null} game
 * @property {NodeJS.Timeout|null} tickInterval
 */

const rooms = new Map() // code -> Room
const connToRoom = new Map() // connId -> code
const connToMeta = new Map() // connId -> { ws }

let nextConnId = 1
function makeConnId() {
  return `c${nextConnId++}`
}

function sendJson(ws, obj) {
  if (ws.readyState !== ws.OPEN) return
  try {
    ws.send(JSON.stringify(obj))
  } catch (err) {
    console.error('send error', err)
  }
}

function sendError(ws, message) {
  sendJson(ws, { type: SERVER_MSG.ERROR, message })
}

function freeSlotCount(room) {
  return room.slotAssignments.filter((v) => v === null).length
}

function assignSlots(room, connId, count) {
  const assigned = []
  for (let i = 0; i < room.slotAssignments.length && assigned.length < count; i += 1) {
    if (room.slotAssignments[i] === null) {
      room.slotAssignments[i] = connId
      assigned.push(i)
    }
  }
  return assigned
}

function releaseSlots(room, connId) {
  for (let i = 0; i < room.slotAssignments.length; i += 1) {
    if (room.slotAssignments[i] === connId) {
      room.slotAssignments[i] = null
    }
  }
}

function slotsOfMember(room, connId) {
  const indexes = []
  for (let i = 0; i < room.slotAssignments.length; i += 1) {
    if (room.slotAssignments[i] === connId) indexes.push(i)
  }
  return indexes
}

function buildRoomState(room) {
  const memberList = []
  for (const m of room.members.values()) {
    memberList.push({
      connId: m.connId,
      name: m.name,
      slots: slotsOfMember(room, m.connId),
    })
  }
  return {
    type: SERVER_MSG.ROOM_STATE,
    code: room.code,
    hostConnId: room.hostConnId,
    status: room.status,
    members: memberList,
    slotAssignments: room.slotAssignments, // array of connId|null per slot
    totalScores: Object.fromEntries(room.totalScores),
  }
}

function broadcastRoomState(room) {
  const msg = buildRoomState(room)
  for (const m of room.members.values()) sendJson(m.ws, msg)
}

function broadcastGameState(room, now) {
  const snap = snapshot(room.game, now)
  const msg = { type: SERVER_MSG.GAME_STATE, state: snap }
  for (const m of room.members.values()) sendJson(m.ws, msg)
}

function broadcastGameOver(room) {
  const msg = { type: SERVER_MSG.GAME_OVER, winnerSlotIndex: room.game?.winnerSlotIndex ?? null }
  for (const m of room.members.values()) sendJson(m.ws, msg)
}

function makeSlotDescriptors(room) {
  // Build slot list for createGameState: every slot index 0..MAX_SLOTS-1,
  // labeled by owner (member name) or 'Bot N', flagged isBot.
  const slots = []
  for (let i = 0; i < MAX_SLOTS; i += 1) {
    const ownerId = room.slotAssignments[i]
    const owner = ownerId ? room.members.get(ownerId) : null
    let label
    if (owner) {
      // If member has multiple slots, suffix with local index.
      const memberSlots = slotsOfMember(room, ownerId)
      if (memberSlots.length > 1) {
        const localIdx = memberSlots.indexOf(i) + 1
        label = `${owner.name} (${localIdx})`
      } else {
        label = owner.name
      }
    } else {
      label = `Bot ${i + 1}`
    }
    slots.push({
      slotIndex: i,
      label,
      isBot: !owner,
      totalScore: room.totalScores.get(i) ?? 0,
    })
  }
  return slots
}

function startGame(room) {
  if (room.tickInterval) {
    clearInterval(room.tickInterval)
    room.tickInterval = null
  }
  const slots = makeSlotDescriptors(room)
  const now = Date.now()
  room.game = createGameState(slots, now)
  room.status = 'playing'

  room.tickInterval = setInterval(() => tick(room), TICK_MS)
  broadcastRoomState(room)
  broadcastGameState(room, now)
}

function stopGameLoop(room) {
  if (room.tickInterval) {
    clearInterval(room.tickInterval)
    room.tickInterval = null
  }
}

function tick(room) {
  if (!room.game || room.status !== 'playing') return
  const now = Date.now()

  // Bot inputs before stepping.
  for (const snake of room.game.snakes) {
    if (!snake.isBot) continue
    const dir = pickBotDirection(room.game, snake, now)
    if (dir) applyInput(room.game, snake.slotIndex, dir)
  }

  const ended = stepGame(room.game, now)
  broadcastGameState(room, now)

  if (ended) {
    room.status = 'gameover'
    stopGameLoop(room)
    // Persist round totals to room-level totalScores.
    for (const snake of room.game.snakes) {
      room.totalScores.set(snake.slotIndex, snake.totalScore)
    }
    broadcastGameOver(room)
    broadcastRoomState(room)
  }
}

function createRoom(connId, ws, playerName, localSlots) {
  let code = randomCode()
  let guard = 0
  while (rooms.has(code) && guard < 100) {
    code = randomCode()
    guard += 1
  }

  const room = {
    code,
    hostConnId: connId,
    status: 'lobby',
    members: new Map(),
    slotAssignments: Array(MAX_SLOTS).fill(null),
    totalScores: new Map(),
    game: null,
    tickInterval: null,
  }
  rooms.set(code, room)

  const member = { connId, name: playerName, ws }
  room.members.set(connId, member)
  connToRoom.set(connId, code)

  const desired = Math.max(1, Math.min(MAX_LOCAL_SLOTS, localSlots ?? 1))
  assignSlots(room, connId, desired)

  broadcastRoomState(room)
  return room
}

function joinRoom(connId, ws, code, playerName, localSlots) {
  const room = rooms.get(code)
  if (!room) {
    sendError(ws, `Raum ${code} existiert nicht`)
    return null
  }
  if (room.status === 'playing') {
    sendError(ws, 'Spiel läuft bereits — bitte warten')
    return null
  }
  const desired = Math.max(1, Math.min(MAX_LOCAL_SLOTS, localSlots ?? 1))
  if (freeSlotCount(room) < desired) {
    sendError(ws, `Raum hat nur noch ${freeSlotCount(room)} freie Slots`)
    return null
  }

  const member = { connId, name: playerName, ws }
  room.members.set(connId, member)
  connToRoom.set(connId, code)
  assignSlots(room, connId, desired)

  broadcastRoomState(room)
  return room
}

function leaveRoom(connId) {
  const code = connToRoom.get(connId)
  if (!code) return
  const room = rooms.get(code)
  if (!room) {
    connToRoom.delete(connId)
    return
  }

  const wasHost = room.hostConnId === connId
  room.members.delete(connId)
  connToRoom.delete(connId)

  if (room.status === 'playing') {
    // Convert their slots into bots (set ownership to null; game state already
    // has the snakes — flip isBot so server controls them).
    const indexes = slotsOfMember(room, connId)
    releaseSlots(room, connId)
    if (room.game) {
      for (const snake of room.game.snakes) {
        if (indexes.includes(snake.slotIndex)) {
          snake.isBot = true
          snake.label = `Bot ${snake.slotIndex + 1}`
        }
      }
    }
  } else {
    releaseSlots(room, connId)
  }

  // Host migration
  if (wasHost) {
    const next = room.members.values().next().value
    room.hostConnId = next ? next.connId : null
  }

  if (room.members.size === 0) {
    stopGameLoop(room)
    rooms.delete(code)
    return
  }

  broadcastRoomState(room)
}

function handleMessage(connId, ws, raw) {
  let msg
  try {
    msg = JSON.parse(raw)
  } catch {
    sendError(ws, 'Invalid JSON')
    return
  }

  switch (msg.type) {
    case CLIENT_MSG.CREATE_ROOM: {
      if (connToRoom.has(connId)) {
        sendError(ws, 'Du bist bereits in einem Raum')
        return
      }
      const name = (msg.playerName || 'Spieler').trim().slice(0, 20) || 'Spieler'
      createRoom(connId, ws, name, msg.localSlots)
      return
    }
    case CLIENT_MSG.JOIN_ROOM: {
      if (connToRoom.has(connId)) {
        sendError(ws, 'Du bist bereits in einem Raum')
        return
      }
      const name = (msg.playerName || 'Spieler').trim().slice(0, 20) || 'Spieler'
      const code = (msg.code || '').toUpperCase().trim()
      if (!/^[A-Z0-9]{4}$/.test(code)) {
        sendError(ws, 'Code muss 4 Zeichen lang sein')
        return
      }
      joinRoom(connId, ws, code, name, msg.localSlots)
      return
    }
    case CLIENT_MSG.LEAVE_ROOM: {
      leaveRoom(connId)
      return
    }
    case CLIENT_MSG.START_GAME: {
      const code = connToRoom.get(connId)
      const room = code ? rooms.get(code) : null
      if (!room) return
      if (room.hostConnId !== connId) {
        sendError(ws, 'Nur der Host kann starten')
        return
      }
      if (room.status === 'playing') return
      startGame(room)
      return
    }
    case CLIENT_MSG.RESTART_ROUND: {
      const code = connToRoom.get(connId)
      const room = code ? rooms.get(code) : null
      if (!room) return
      if (room.hostConnId !== connId) {
        sendError(ws, 'Nur der Host kann neu starten')
        return
      }
      stopGameLoop(room)
      startGame(room)
      return
    }
    case CLIENT_MSG.RESET_SCORES: {
      const code = connToRoom.get(connId)
      const room = code ? rooms.get(code) : null
      if (!room) return
      if (room.hostConnId !== connId) {
        sendError(ws, 'Nur der Host kann Punkte resetten')
        return
      }
      room.totalScores.clear()
      if (room.game) {
        for (const snake of room.game.snakes) {
          snake.totalScore = 0
        }
      }
      broadcastRoomState(room)
      return
    }
    case CLIENT_MSG.INPUT: {
      const code = connToRoom.get(connId)
      const room = code ? rooms.get(code) : null
      if (!room || !room.game || room.status !== 'playing') return
      const slotIndex = Number(msg.slotIndex)
      if (!Number.isInteger(slotIndex)) return
      if (room.slotAssignments[slotIndex] !== connId) return // not your slot
      applyInput(room.game, slotIndex, msg.direction)
      return
    }
    default:
      sendError(ws, `Unbekannter type: ${msg.type}`)
  }
}

export function handleConnection(ws) {
  const connId = makeConnId()
  connToMeta.set(connId, { ws })

  sendJson(ws, { type: SERVER_MSG.WELCOME, connId })

  ws.on('message', (data) => {
    handleMessage(connId, ws, data.toString())
  })

  ws.on('close', () => {
    leaveRoom(connId)
    connToMeta.delete(connId)
  })

  ws.on('error', (err) => {
    console.error('ws error', connId, err.message)
  })
}
