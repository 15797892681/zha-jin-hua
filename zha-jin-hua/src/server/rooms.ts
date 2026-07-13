import { randomBytes, randomUUID } from 'node:crypto';

import { applyAction, createGame, forceFold } from '../shared/game';
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
  private readonly turnTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly subscribers = new Set<(roomCode: string) => void>();

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
    this.notify(code);
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
    this.notify(room.code);
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
    this.clearDisconnectTimer(playerId);
    player.socketId = socketId;
    player.connected = true;
    player.disconnectDeadline = null;
  }

  resume(sessionToken: string, socketId: string): JoinResult {
    for (const room of this.rooms.values()) {
      const player = room.players.find((candidate) => candidate.sessionToken === sessionToken);
      if (player) {
        player.socketId = socketId;
        this.clearDisconnectTimer(player.id);
        player.connected = true;
        player.disconnectDeadline = null;
        this.notify(room.code);
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
    this.clearDisconnectTimer(playerId);
    const room = this.roomForPlayer(playerId);
    if (room) {
      const timer = setTimeout(() => this.expireDisconnectedPlayer(room.code, playerId), 60_000);
      this.preventTimerFromKeepingProcessAlive(timer);
      this.disconnectTimers.set(playerId, timer);
      this.notify(room.code);
    }
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

    this.clearDisconnectTimer(playerId);
    room.players.splice(index, 1);
    if (room.players.length === 0) {
      this.rooms.delete(room.code);
      this.notify(room.code);
      return;
    }
    if (room.hostId === playerId) {
      room.hostId = room.players[0].id;
    }
    this.notify(room.code);
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
    this.scheduleTurn(room);
    this.notify(room.code);
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
      this.completeRound(room);
    } else {
      this.scheduleTurn(room);
    }
    this.notify(room.code);
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

  subscribe(listener: (roomCode: string) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  dispose(): void {
    for (const timer of this.turnTimers.values()) clearTimeout(timer);
    for (const timer of this.disconnectTimers.values()) clearTimeout(timer);
    this.turnTimers.clear();
    this.disconnectTimers.clear();
    this.subscribers.clear();
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

  private scheduleTurn(room: Room): void {
    this.clearTurnTimer(room.code);
    if (!room.game || room.game.status !== 'playing') return;

    const expectedTurnId = room.game.turnId;
    room.game.turnDeadline = this.now() + 30_000;
    const timer = setTimeout(() => {
      const latest = this.rooms.get(room.code);
      if (!latest?.game || latest.status !== 'playing' || latest.game.turnId !== expectedTurnId) return;
      const currentPlayerId = latest.game.currentPlayerId;
      if (!currentPlayerId) return;
      latest.game = forceFold(latest.game, currentPlayerId);
      if (latest.game.status === 'finished') {
        this.completeRound(latest);
      } else {
        this.scheduleTurn(latest);
      }
      this.notify(latest.code);
    }, 30_000);
    this.preventTimerFromKeepingProcessAlive(timer);
    this.turnTimers.set(room.code, timer);
  }

  private expireDisconnectedPlayer(roomCode: string, playerId: string): void {
    this.disconnectTimers.delete(playerId);
    const room = this.rooms.get(roomCode);
    const playerIndex = room?.players.findIndex((player) => player.id === playerId) ?? -1;
    if (!room || playerIndex < 0 || room.players[playerIndex].connected) return;

    if (room.game?.status === 'playing') {
      room.game = forceFold(room.game, playerId);
      if (room.game.status === 'finished') {
        this.completeRound(room);
      } else {
        this.scheduleTurn(room);
      }
    }

    room.players.splice(playerIndex, 1);
    if (room.players.length === 0) {
      this.clearTurnTimer(room.code);
      this.rooms.delete(room.code);
      this.notify(room.code);
      return;
    }
    if (room.hostId === playerId) {
      room.hostId = room.players[0].id;
    }
    this.notify(room.code);
  }

  private completeRound(room: Room): void {
    if (!room.game) return;
    room.status = 'result';
    room.game.turnDeadline = null;
    this.clearTurnTimer(room.code);
    for (const player of room.players) {
      const gamePlayer = room.game.players.find((candidate) => candidate.id === player.id);
      if (gamePlayer) player.chips = gamePlayer.chips;
    }
  }

  private clearTurnTimer(roomCode: string): void {
    const timer = this.turnTimers.get(roomCode);
    if (timer) clearTimeout(timer);
    this.turnTimers.delete(roomCode);
  }

  private clearDisconnectTimer(playerId: string): void {
    const timer = this.disconnectTimers.get(playerId);
    if (timer) clearTimeout(timer);
    this.disconnectTimers.delete(playerId);
  }

  private notify(roomCode: string): void {
    for (const subscriber of this.subscribers) subscriber(roomCode);
  }

  private preventTimerFromKeepingProcessAlive(timer: ReturnType<typeof setTimeout>): void {
    if (typeof timer === 'object' && 'unref' in timer) timer.unref();
  }
}
