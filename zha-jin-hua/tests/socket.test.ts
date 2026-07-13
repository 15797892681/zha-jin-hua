// @vitest-environment node

import type { AddressInfo } from 'node:net';
import { io as createClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createGameServer, type GameServer } from '../src/server/index';
import type { PlayerGameView, RoomSnapshot } from '../src/shared/types';

interface AckSuccess<T = undefined> { ok: true; data: T }
interface AckFailure { ok: false; code: string; message: string }
type Ack<T = undefined> = AckSuccess<T> | AckFailure;

function emitAck<T>(socket: ClientSocket, event: string, payload: unknown): Promise<Ack<T>> {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

function nextEvent<T>(socket: ClientSocket, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event, resolve));
}

function nextMatchingEvent<T>(socket: ClientSocket, event: string, matches: (value: T) => boolean): Promise<T> {
  return new Promise((resolve) => {
    const listener = (value: T) => {
      if (matches(value)) {
        socket.off(event, listener);
        resolve(value);
      }
    };
    socket.on(event, listener);
  });
}

describe('Socket room protocol', () => {
  let server: GameServer;
  let baseUrl: string;
  const clients: ClientSocket[] = [];

  beforeEach(async () => {
    server = createGameServer();
    await server.start(0);
    const address = server.httpServer.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    for (const client of clients) {
      client.disconnect();
    }
    await server.stop();
  });

  async function connect(): Promise<ClientSocket> {
    const socket = createClient(baseUrl, { transports: ['websocket'], forceNew: true });
    clients.push(socket);
    if (!socket.connected) {
      await nextEvent(socket, 'connect');
    }
    return socket;
  }

  it('creates, joins and starts a room while hiding opponent cards', async () => {
    const host = await connect();
    const guest = await connect();
    const created = await emitAck<{ roomCode: string; playerId: string; sessionToken: string }>(host, 'room:create', { nickname: '阿林' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const joined = await emitAck<{ playerId: string }>(guest, 'room:join', { nickname: '小满', roomCode: created.data.roomCode });
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;

    const hostGame = nextEvent<PlayerGameView>(host, 'game:snapshot');
    const guestGame = nextEvent<PlayerGameView>(guest, 'game:snapshot');
    const started = await emitAck(host, 'room:start', {});
    expect(started.ok).toBe(true);

    const [hostView, guestView] = await Promise.all([hostGame, guestGame]);
    expect(hostView.players.find((player) => player.id === created.data.playerId)?.cards.every(Boolean)).toBe(true);
    expect(hostView.players.find((player) => player.id === joined.data.playerId)?.cards).toEqual([null, null, null]);
    expect(guestView.players.find((player) => player.id === joined.data.playerId)?.cards.every(Boolean)).toBe(true);
  });

  it('rejects non-host starts, out-of-turn actions and malformed payloads', async () => {
    const host = await connect();
    const guest = await connect();
    const created = await emitAck<{ roomCode: string }>(host, 'room:create', { nickname: '阿林' });
    if (!created.ok) return;
    await emitAck(guest, 'room:join', { nickname: '小满', roomCode: created.data.roomCode });

    expect(await emitAck(guest, 'room:start', {})).toMatchObject({ ok: false, code: 'HOST_ONLY' });
    const gameEvent = nextEvent<PlayerGameView>(host, 'game:snapshot');
    await emitAck(host, 'room:start', {});
    const view = await gameEvent;

    expect(await emitAck(guest, 'game:action', { type: 'fold', turnId: view.turnId }))
      .toMatchObject({ ok: false, code: 'NOT_YOUR_TURN' });
    expect(await emitAck(host, 'game:action', { type: 'raise', amount: '很多', turnId: view.turnId }))
      .toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' });
  });

  it('broadcasts a room snapshot containing both seats', async () => {
    const host = await connect();
    const guest = await connect();
    const created = await emitAck<{ roomCode: string }>(host, 'room:create', { nickname: '阿林' });
    if (!created.ok) return;
    const snapshotEvent = nextMatchingEvent<RoomSnapshot>(
      host,
      'room:snapshot',
      (snapshot) => snapshot.players.length === 2,
    );

    await emitAck(guest, 'room:join', { nickname: '小满', roomCode: created.data.roomCode });
    const snapshot = await snapshotEvent;

    expect(snapshot.players.map((player) => player.nickname)).toEqual(['阿林', '小满']);
  });
});
