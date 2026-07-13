// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RoomManager } from '../src/server/rooms';

function manager() {
  let id = 0;
  return new RoomManager({
    codeGenerator: () => 'A7K9Q2',
    idGenerator: () => `p${++id}`,
    tokenGenerator: () => `session-token-${id}-opaque`,
  });
}

describe('room lifecycle timers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-13T08:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('folds the current player after the 30 second deadline', () => {
    const rooms = manager();
    const host = rooms.create('阿林');
    rooms.join(host.roomCode, '小满');
    rooms.start(host.roomCode, host.playerId);

    expect(rooms.get(host.roomCode)?.game?.turnDeadline).toBe(Date.now() + 30_000);
    vi.advanceTimersByTime(30_001);

    const game = rooms.get(host.roomCode)?.game;
    expect(game?.players.find((player) => player.id === host.playerId)?.status).toBe('folded');
    expect(game?.status).toBe('finished');
    rooms.dispose();
  });

  it('restores a disconnected seat before 60 seconds', () => {
    const rooms = manager();
    const host = rooms.create('阿林');
    rooms.attach(host.playerId, 'socket-1');
    rooms.disconnect(host.playerId);
    vi.advanceTimersByTime(59_000);

    expect(() => rooms.resume(host.sessionToken, 'socket-2')).not.toThrow();
    expect(rooms.get(host.roomCode)?.players[0]).toMatchObject({ connected: true, disconnectDeadline: null });
    rooms.dispose();
  });

  it('expires a disconnected seat after 60 seconds', () => {
    const rooms = manager();
    const host = rooms.create('阿林');
    rooms.attach(host.playerId, 'socket-1');
    rooms.disconnect(host.playerId);
    vi.advanceTimersByTime(60_001);

    expect(() => rooms.resume(host.sessionToken, 'socket-2')).toThrowError('SESSION_EXPIRED');
    expect(rooms.get(host.roomCode)).toBeUndefined();
    rooms.dispose();
  });

  it('folds an expired active player and transfers host ownership', () => {
    const rooms = manager();
    const host = rooms.create('阿林');
    const second = rooms.join(host.roomCode, '小满');
    const third = rooms.join(host.roomCode, '老周');
    rooms.start(host.roomCode, host.playerId);
    rooms.disconnect(host.playerId);
    vi.advanceTimersByTime(60_001);

    const room = rooms.get(host.roomCode);
    expect(room?.hostId).toBe(second.playerId);
    expect(room?.players.map((player) => player.id)).toEqual([second.playerId, third.playerId]);
    expect(room?.game?.players.find((player) => player.id === host.playerId)?.status).toBe('folded');
    rooms.dispose();
  });

  it('notifies subscribers when a deadline mutates room state', () => {
    const rooms = manager();
    const onChange = vi.fn();
    rooms.subscribe(onChange);
    const host = rooms.create('阿林');
    rooms.join(host.roomCode, '小满');
    rooms.start(host.roomCode, host.playerId);
    onChange.mockClear();

    vi.advanceTimersByTime(30_001);

    expect(onChange).toHaveBeenCalledWith(host.roomCode);
    rooms.dispose();
  });
});
