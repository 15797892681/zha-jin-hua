// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { RoomManager } from '../src/server/rooms';

function manager() {
  let id = 0;
  return new RoomManager({
    codeGenerator: () => 'A7K9Q2',
    idGenerator: () => `p${++id}`,
    tokenGenerator: () => `token-${id}`,
    now: () => 1000,
  });
}

describe('RoomManager', () => {
  it('creates a six-character room and rejects duplicate names', () => {
    const rooms = manager();
    const host = rooms.create('阿林');

    expect(host.roomCode).toBe('A7K9Q2');
    expect(host.playerId).toBe('p1');
    expect(host.sessionToken).toBe('token-1');
    expect(() => rooms.join('A7K9Q2', '阿林')).toThrowError('NAME_TAKEN');
  });

  it('normalizes room codes and caps a room at six players', () => {
    const rooms = manager();
    rooms.create('一号');
    for (const name of ['二号', '三号', '四号', '五号', '六号']) {
      rooms.join('a7k9q2', name);
    }

    expect(rooms.get('A7K9Q2')?.players).toHaveLength(6);
    expect(() => rooms.join('A7K9Q2', '七号')).toThrowError('ROOM_FULL');
  });

  it('allows only the host to start with at least two connected players', () => {
    const rooms = manager();
    const host = rooms.create('阿林');
    const guest = rooms.join(host.roomCode, '小满');

    expect(() => rooms.start(host.roomCode, guest.playerId)).toThrowError('HOST_ONLY');
    rooms.start(host.roomCode, host.playerId);
    expect(rooms.get(host.roomCode)?.status).toBe('playing');
    expect(rooms.get(host.roomCode)?.game?.players).toHaveLength(2);
  });

  it('moves host ownership to the earliest remaining player', () => {
    const rooms = manager();
    const host = rooms.create('阿林');
    const second = rooms.join(host.roomCode, '小满');
    rooms.join(host.roomCode, '老周');

    rooms.leave(host.roomCode, host.playerId);

    expect(rooms.get(host.roomCode)?.hostId).toBe(second.playerId);
  });

  it('resumes a seat from its opaque session token', () => {
    const rooms = manager();
    const host = rooms.create('阿林');
    rooms.attach(host.playerId, 'socket-1');
    rooms.disconnect(host.playerId);

    const resumed = rooms.resume(host.sessionToken, 'socket-2');

    expect(resumed).toEqual(host);
    expect(rooms.get(host.roomCode)?.players[0]).toMatchObject({ connected: true, socketId: 'socket-2' });
  });
});
