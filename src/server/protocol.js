export const CLIENT_MSG = {
  CREATE_ROOM: 'create-room',
  JOIN_ROOM: 'join-room',
  LEAVE_ROOM: 'leave-room',
  START_GAME: 'start-game',
  INPUT: 'input',
  RESTART_ROUND: 'restart-round',
  RESET_SCORES: 'reset-scores',
}

export const SERVER_MSG = {
  ROOM_STATE: 'room-state',
  GAME_STATE: 'game-state',
  GAME_OVER: 'game-over',
  ERROR: 'error',
  WELCOME: 'welcome',
}

export const MAX_SLOTS = 4
export const MAX_LOCAL_SLOTS = 3
export const TICK_MS = 110
