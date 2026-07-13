import { randomBytes, randomUUID } from 'node:crypto';

import { applyAction, createGame } from '../shared/game';
import type {
  GameAction,
  GameState,
  RoomSnapshot,
  RoomStatus,
} from '../shared/types';

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class RoomError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'RoomError';
  }
}

export interface JoinResult {
  roomCode: string;
  playerId: string;
  sessionToken: string;
}

export interface RoomPlayer {
  id: string;
  nickname: string;
  sessionToken: string;
  socketId: string | null;
  chips: number;
  connected: boolean;
  joinedAt: number;
  disconnectDeadline: number | null;
}

export interface Room {
  code: string;
  hostId: string;
  status: RoomStatus;
  players: RoomPlayer[];
  game: GameState | null;
}

export interface RoomManagerOptions {
  codeGenerator?: () => string;
  idGenerator?: () => string;
  tokenGenerator?: () => string;
  now?: () => number;
}

function generatedRoomCode(): string {
  const bytes = randomBytes(6);
  return [...bytes].map((byte) => ROOM_ALPHABET[byte % ROOM_ALPHABET.length]).join('');
}

function validateNickname(value: string): string {
  const nickname = value.trim();
  const length = Array.from(nickname).length;
  if (length < 1 || length > 12) {
    throw new RoomError('INVALID_NICKNAME');
  }
  return nickname;
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly codeGenerator: () => string;
  private readonly idGenerator: () => string;
  private readonly tokenGenerator: () => string;
  private readonly now: () => number;

  constructor(options: RoomManagerOptions = {}) {
    this.codeGenerator = options.codeGenerator ?? generatedRoomCode;
    this.idGenerator = options.idGenerator ?? randomUUID;
    this.tokenGenerator = options.tokenGenerator ?? (() => randomBytes(24).toString('base64url'));
    this.now = options.now ?? Date.now;
  }

  create(rawNickname: string): JoinResult {
    const nickname = validateNickname(rawNickname);
    let code = '';
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidate = this.codeGenerator().trim().toUpperCase();
      if (/^[A-Z2-9]{6}$/.test(candidate) && !this.rooms.has(candidate)) {
        code = candidate;
        break;
      }
    }
    if (!code) {
      throw new RoomError('CODE_GENERATION_FAILED');
    }

    const player = this.makePlayer(nickname);
    const room: Room = {
      code,
      hostId: player.id,
      status: 'waiting',
      players: [player],
      game: null,
    };
    this.rooms.set(code, room);
    return this.joinResult(room, player);
  }

  join(rawRoomCode: string, rawNickname: string): JoinResult {
    const room = this.requireRoom(rawRoomCode);
    const nickname = validateNickname(rawNickname);
    if (room.status !== 'waiting') {
      throw new RoomError('GAME_IN_PROGRESS');
    }
    if (room.players.length >= 6) {
      throw new RoomError('ROOM_FULL');
    }
    if (room.players.some((player) => player.nickname === nickname)) {
      throw new RoomError('NAME_TAKEN');
    }

    const player = this.makePlayer(nickname);
    room.players.push(player);
    return this.joinResult(room, player);
  }

  get(roomCode: string): Room | undefined {
    return this.rooms.get(roomCode.trim().toUpperCase());
  }

  roomForPlayer(playerId: string): Room | undefined {
    return [...this.rooms.values()].find((room) => room.players.some((player) => player.id === playerId));
  }

  attach(playerId: string, socketId: string): void {
    const player = this.requirePlayer(playerId);
    player.socketId = socketId;
    player.connected = true;
    player.disconnectDeadline = null;
  }

  resume(sessionToken: string, socketId: string): JoinResult {
    for (const room of this.rooms.values()) {
      const player = room.players.find((candidate) => candidate.sessionToken === sessionToken);
      if (player) {
        player.socketId = socketId;
        player.connected = true;
        player.disconnectDeadline = null;
        return this.joinResult(room, player);
      }
    }
    throw new RoomError('SESSION_EXPIRED');
  }

  disconnect(playerId: string): void {
    const player = this.requirePlayer(playerId);
    player.connected = false;
    player.socketId = null;
    player.disconnectDeadline = this.now() + 60_000;
  }

  leave(rawRoomCode: string, playerId: string): void {
    const room = this.requireRoom(rawRoomCode);
    const index = room.players.findIndex((player) => player.id === playerId);
    if (index < 0) {
      throw new RoomError('PLAYER_NOT_FOUND');
    }
    if (room.status === 'playing') {
      throw new RoomError('GAME_IN_PROGRESS');
    }

    room.players.splice(index, 1);
    if (room.players.length === 0) {
      this.rooms.delete(room.code);
      return;
    }
    if (room.hostId === playerId) {
      room.hostId = room.players[0].id;
    }
  }

  start(rawRoomCode: string, playerId: string): GameState {
    const room = this.requireRoom(rawRoomCode);
    if (room.hostId !== playerId) {
      throw new RoomError('HOST_ONLY');
    }
    const connected = room.players.filter((player) => player.connected);
    if (connected.length < 2) {
      throw new RoomError('NEED_MORE_PLAYERS');
    }
    if (room.status === 'playing') {
      throw new RoomError('GAME_IN_PROGRESS');
    }

    room.game = createGame({
      players: connected.map((player) => ({
        id: player.id,
        name: player.nickname,
        chips: player.chips >= 10 ? player.chips : 1000,
      })),
      startingChips: 1000,
      ante: 10,
    });
    room.status = 'playing';
    return room.game;
  }

  act(rawRoomCode: string, playerId: string, action: GameAction): GameState {
    const room = this.requireRoom(rawRoomCode);
    if (!room.game || room.status !== 'playing') {
      throw new RoomError('GAME_NOT_ACTIVE');
    }
    if (action.playerId !== playerId) {
      throw new RoomError('PLAYER_MISMATCH');
    }

    room.game = applyAction(room.game, action);
    if (room.game.status === 'finished') {
      room.status = 'result';
      for (const player of room.players) {
        const gamePlayer = room.game.players.find((candidate) => candidate.id === player.id);
        if (gamePlayer) {
          player.chips = gamePlayer.chips;
        }
      }
    }
    return room.game;
  }

  snapshot(rawRoomCode: string): RoomSnapshot {
    const room = this.requireRoom(rawRoomCode);
    return {
      code: room.code,
      hostId: room.hostId,
      status: room.status,
      players: room.players.map((player) => ({
        id: player.id,
        nickname: player.nickname,
        chips: player.chips,
        connected: player.connected,
        isHost: player.id === room.hostId,
        disconnectDeadline: player.disconnectDeadline,
      })),
    };
  }

  private makePlayer(nickname: string): RoomPlayer {
    return {
      id: this.idGenerator(),
      nickname,
      sessionToken: this.tokenGenerator(),
      socketId: null,
      chips: 1000,
      connected: true,
      joinedAt: this.now(),
      disconnectDeadline: null,
    };
  }

  private joinResult(room: Room, player: RoomPlayer): JoinResult {
    return { roomCode: room.code, playerId: player.id, sessionToken: player.sessionToken };
  }

  private requireRoom(roomCode: string): Room {
    const room = this.get(roomCode);
    if (!room) {
      throw new RoomError('ROOM_NOT_FOUND');
    }
    return room;
  }

  private requirePlayer(playerId: string): RoomPlayer {
    for (const room of this.rooms.values()) {
      const player = room.players.find((candidate) => candidate.id === playerId);
      if (player) {
        return player;
      }
    }
    throw new RoomError('PLAYER_NOT_FOUND');
  }
}
