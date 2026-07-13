import type { Server, Socket } from 'socket.io';
import type { ZodType } from 'zod';

import { toPlayerView } from '../shared/visibility';
import type { GameAction } from '../shared/types';
import { actionSchema, createRoomSchema, emptySchema, joinRoomSchema, resumeSchema } from './protocol';
import { RoomError, RoomManager, type JoinResult, type Room } from './rooms';

type Ack = (response: { ok: true; data?: unknown } | { ok: false; code: string; message: string }) => void;

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_PAYLOAD: '提交的数据格式不正确',
  INVALID_NICKNAME: '昵称需为 1 至 12 个字符',
  ROOM_NOT_FOUND: '没有找到这个房间',
  ROOM_FULL: '房间已经坐满',
  NAME_TAKEN: '房间内已有相同昵称',
  GAME_IN_PROGRESS: '牌局已经开始',
  HOST_ONLY: '只有房主可以开始游戏',
  NEED_MORE_PLAYERS: '至少需要两名在线玩家',
  NOT_YOUR_TURN: '还没有轮到你行动',
  STALE_TURN: '这个操作已经过期',
  PLAYER_MISMATCH: '无法替其他玩家操作',
  SESSION_EXPIRED: '会话已经失效，请重新加入',
  ILLEGAL_RAISE: '当前不能这样加注',
  ILLEGAL_COMPARE: '当前不能向该玩家发起比牌',
  INSUFFICIENT_CHIPS: '筹码不足',
};

function messageFor(code: string): string {
  return ERROR_MESSAGES[code] ?? '操作失败，请稍后重试';
}

function fail(ack: Ack, error: unknown): void {
  const code = error instanceof RoomError || error instanceof Error ? error.message : 'UNKNOWN_ERROR';
  ack({ ok: false, code, message: messageFor(code) });
}

function parse<T>(schema: ZodType<T>, payload: unknown): T {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new RoomError('INVALID_PAYLOAD');
  }
  return result.data;
}

function setIdentity(socket: Socket, result: JoinResult): void {
  socket.data.playerId = result.playerId;
  socket.data.roomCode = result.roomCode;
  socket.data.sessionToken = result.sessionToken;
}

function requireIdentity(socket: Socket): { playerId: string; roomCode: string } {
  const { playerId, roomCode } = socket.data as { playerId?: string; roomCode?: string };
  if (!playerId || !roomCode) {
    throw new RoomError('SESSION_EXPIRED');
  }
  return { playerId, roomCode };
}

function broadcastRoom(io: Server, rooms: RoomManager, room: Room): void {
  io.to(room.code).emit('room:snapshot', rooms.snapshot(room.code));
}

function broadcastGame(io: Server, room: Room): void {
  if (!room.game) return;
  for (const player of room.players) {
    if (!player.socketId) continue;
    io.sockets.sockets.get(player.socketId)?.emit('game:snapshot', toPlayerView(room.game, player.id));
  }
}

export function registerSocketHandlers(io: Server, rooms: RoomManager): void {
  io.on('connection', (socket) => {
    socket.on('room:create', async (payload: unknown, ack: Ack) => {
      try {
        const { nickname } = parse(createRoomSchema, payload);
        const result = rooms.create(nickname);
        rooms.attach(result.playerId, socket.id);
        setIdentity(socket, result);
        await socket.join(result.roomCode);
        ack({ ok: true, data: result });
        const room = rooms.get(result.roomCode);
        if (room) broadcastRoom(io, rooms, room);
      } catch (error) {
        fail(ack, error);
      }
    });

    socket.on('room:join', async (payload: unknown, ack: Ack) => {
      try {
        const { nickname, roomCode } = parse(joinRoomSchema, payload);
        const result = rooms.join(roomCode, nickname);
        rooms.attach(result.playerId, socket.id);
        setIdentity(socket, result);
        await socket.join(result.roomCode);
        ack({ ok: true, data: result });
        const room = rooms.get(result.roomCode);
        if (room) broadcastRoom(io, rooms, room);
      } catch (error) {
        fail(ack, error);
      }
    });

    socket.on('session:resume', async (payload: unknown, ack: Ack) => {
      try {
        const { sessionToken } = parse(resumeSchema, payload);
        const result = rooms.resume(sessionToken, socket.id);
        setIdentity(socket, result);
        await socket.join(result.roomCode);
        ack({ ok: true, data: result });
        const room = rooms.get(result.roomCode);
        if (room) {
          broadcastRoom(io, rooms, room);
          if (room.game) socket.emit('game:snapshot', toPlayerView(room.game, result.playerId));
        }
      } catch (error) {
        fail(ack, error);
      }
    });

    socket.on('room:start', (payload: unknown, ack: Ack) => {
      try {
        parse(emptySchema, payload);
        const identity = requireIdentity(socket);
        rooms.start(identity.roomCode, identity.playerId);
        ack({ ok: true });
        const room = rooms.get(identity.roomCode);
        if (room) {
          broadcastRoom(io, rooms, room);
          broadcastGame(io, room);
        }
      } catch (error) {
        fail(ack, error);
      }
    });

    socket.on('game:action', (payload: unknown, ack: Ack) => {
      try {
        const clientAction = parse(actionSchema, payload);
        const identity = requireIdentity(socket);
        const action = { ...clientAction, playerId: identity.playerId } as GameAction;
        rooms.act(identity.roomCode, identity.playerId, action);
        ack({ ok: true });
        const room = rooms.get(identity.roomCode);
        if (room) {
          broadcastRoom(io, rooms, room);
          broadcastGame(io, room);
        }
      } catch (error) {
        fail(ack, error);
      }
    });

    socket.on('room:leave', (payload: unknown, ack: Ack) => {
      try {
        parse(emptySchema, payload);
        const identity = requireIdentity(socket);
        const room = rooms.get(identity.roomCode);
        rooms.leave(identity.roomCode, identity.playerId);
        socket.leave(identity.roomCode);
        socket.data = {};
        ack({ ok: true });
        if (room && rooms.get(room.code)) broadcastRoom(io, rooms, room);
      } catch (error) {
        fail(ack, error);
      }
    });

    socket.on('disconnect', () => {
      const playerId = socket.data.playerId as string | undefined;
      const roomCode = socket.data.roomCode as string | undefined;
      if (!playerId || !roomCode) return;
      try {
        rooms.disconnect(playerId);
        const room = rooms.get(roomCode);
        if (room) broadcastRoom(io, rooms, room);
      } catch {
        // The room may already have been removed by an explicit leave.
      }
    });
  });
}
