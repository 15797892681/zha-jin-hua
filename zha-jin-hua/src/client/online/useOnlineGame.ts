import { useCallback, useEffect, useState } from 'react';
import { io } from 'socket.io-client';

import type { GameAction, PlayerGameView, RoomSnapshot } from '../../shared/types';

type Listener = (...args: unknown[]) => void;

export interface OnlineSocket {
  connected: boolean;
  connect(): OnlineSocket;
  on(event: string, listener: Listener): OnlineSocket;
  off(event: string, listener: Listener): OnlineSocket;
  emit(event: string, payload: unknown, ack?: (response: unknown) => void): OnlineSocket;
  disconnect(): unknown;
}

export type SocketFactory = () => OnlineSocket;

interface AckSuccess<T = undefined> { ok: true; data: T }
interface AckFailure { ok: false; code: string; message: string }
type Ack<T = undefined> = AckSuccess<T> | AckFailure;

interface Identity {
  roomCode: string;
  playerId: string;
  sessionToken: string;
}

const SESSION_KEY = 'zjh-session-token';

export function createBrowserSocket(): OnlineSocket {
  return io() as unknown as OnlineSocket;
}

function request<T>(socket: OnlineSocket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    socket.emit(event, payload, (unknownResponse) => {
      const response = unknownResponse as Ack<T>;
      if (response.ok) {
        resolve(response.data);
      } else {
        reject(new Error(response.message));
      }
    });
  });
}

export interface OnlineController {
  phase: 'lobby' | 'waiting' | 'playing' | 'result';
  room: RoomSnapshot | null;
  game: PlayerGameView | null;
  playerId: string | null;
  connection: 'online' | 'reconnecting' | 'offline';
  error: string | null;
  createRoom(nickname: string): Promise<void>;
  joinRoom(nickname: string, roomCode: string): Promise<void>;
  startGame(): Promise<void>;
  dispatch(action: GameAction): Promise<void>;
  clearError(): void;
  leaveRoom(): void;
}

export function useOnlineGame(socketFactory: SocketFactory): OnlineController {
  const [socket] = useState(socketFactory);
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [game, setGame] = useState<PlayerGameView | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [connection, setConnection] = useState<'online' | 'reconnecting' | 'offline'>(
    socket.connected ? 'online' : 'reconnecting',
  );
  const [error, setError] = useState<string | null>(null);

  const remember = useCallback((nextIdentity: Identity) => {
    setIdentity(nextIdentity);
    localStorage.setItem(SESSION_KEY, nextIdentity.sessionToken);
  }, []);

  useEffect(() => {
    const onConnect = () => {
      setConnection('online');
      const sessionToken = localStorage.getItem(SESSION_KEY);
      if (!sessionToken) return;
      request<Identity>(socket, 'session:resume', { sessionToken })
        .then(remember)
        .catch((reason: Error) => {
          localStorage.removeItem(SESSION_KEY);
          setError(reason.message);
        });
    };
    const onDisconnect = () => setConnection('reconnecting');
    const onConnectError = () => setConnection('offline');
    const onRoom = (snapshot: unknown) => setRoom(snapshot as RoomSnapshot);
    const onGame = (snapshot: unknown) => setGame(snapshot as PlayerGameView);
    const onRequestError = (payload: unknown) => {
      const message = (payload as { message?: string }).message;
      if (message) setError(message);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('room:snapshot', onRoom);
    socket.on('game:snapshot', onGame);
    socket.on('request:error', onRequestError);
    if (socket.connected) {
      onConnect();
    } else {
      socket.connect();
    }

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('room:snapshot', onRoom);
      socket.off('game:snapshot', onGame);
      socket.off('request:error', onRequestError);
      socket.disconnect();
    };
  }, [remember, socket]);

  const run = useCallback(async (operation: () => Promise<void>) => {
    setError(null);
    try {
      await operation();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败，请稍后重试');
    }
  }, []);

  const createRoom = useCallback((nickname: string) => run(async () => {
    const result = await request<Identity>(socket, 'room:create', { nickname });
    remember(result);
  }), [remember, run, socket]);

  const joinRoom = useCallback((nickname: string, roomCode: string) => run(async () => {
    const result = await request<Identity>(socket, 'room:join', { nickname, roomCode: roomCode.toUpperCase() });
    remember(result);
  }), [remember, run, socket]);

  const startGame = useCallback(() => run(async () => {
    await request(socket, 'room:start', {});
  }), [run, socket]);

  const dispatch = useCallback((action: GameAction) => run(async () => {
    const { playerId: _playerId, ...payload } = action;
    await request(socket, 'game:action', payload);
  }), [run, socket]);

  const leaveRoom = useCallback(() => {
    if (room?.status !== 'playing') {
      socket.emit('room:leave', {}, () => undefined);
    }
    localStorage.removeItem(SESSION_KEY);
    setRoom(null);
    setGame(null);
    setIdentity(null);
    setError(null);
  }, [room?.status, socket]);

  const phase = game
    ? (game.status === 'finished' ? 'result' : 'playing')
    : (room ? 'waiting' : 'lobby');

  return {
    phase,
    room,
    game,
    playerId: identity?.playerId ?? null,
    connection,
    error,
    createRoom,
    joinRoom,
    startGame,
    dispatch,
    clearError: () => setError(null),
    leaveRoom,
  };
}
