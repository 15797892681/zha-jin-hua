import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/client/App';
import type { OnlineSocket } from '../src/client/online/useOnlineGame';
import type { RoomSnapshot } from '../src/shared/types';

type Listener = (...args: unknown[]) => void;

class FakeSocket implements OnlineSocket {
  connected = true;
  private listeners = new Map<string, Set<Listener>>();
  emitted: Array<{ event: string; payload: unknown }> = [];
  nextFailure: { code: string; message: string } | null = null;

  on(event: string, listener: Listener) {
    const listeners = this.listeners.get(event) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  off(event: string, listener: Listener) {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  emit(event: string, payload: unknown, ack?: (response: unknown) => void) {
    this.emitted.push({ event, payload });
    if (!ack) return this;
    if (this.nextFailure) {
      ack({ ok: false, ...this.nextFailure });
      this.nextFailure = null;
      return this;
    }
    if (event === 'room:create' || event === 'room:join') {
      ack({ ok: true, data: { roomCode: 'A7K9Q2', playerId: 'p1', sessionToken: 'session-token-123456' } });
    } else {
      ack({ ok: true });
    }
    return this;
  }

  disconnect() {
    this.connected = false;
  }

  serverEmit(event: string, payload?: unknown) {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(payload);
    }
  }
}

function roomSnapshot(overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    code: 'A7K9Q2',
    hostId: 'p1',
    status: 'waiting',
    players: [
      { id: 'p1', nickname: '阿林', chips: 1000, connected: true, isHost: true, disconnectDeadline: null },
    ],
    ...overrides,
  };
}

describe('online lobby UI', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('creates a room and shows a shareable room code', async () => {
    const socket = new FakeSocket();
    const user = userEvent.setup();
    render(<App socketFactory={() => socket} />);

    await user.click(screen.getByRole('button', { name: '联网房间' }));
    await user.type(screen.getByLabelText('昵称'), '阿林');
    await user.click(screen.getByRole('button', { name: '创建房间' }));
    socket.serverEmit('room:snapshot', roomSnapshot());

    expect(await screen.findByText('A7K9Q2')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '复制房间码' })).toBeEnabled();
    expect(localStorage.getItem('zjh-session-token')).toBe('session-token-123456');
  });

  it('shows a server error without leaving the lobby', async () => {
    const socket = new FakeSocket();
    socket.nextFailure = { code: 'ROOM_NOT_FOUND', message: '没有找到这个房间' };
    const user = userEvent.setup();
    render(<App socketFactory={() => socket} />);

    await user.click(screen.getByRole('button', { name: '联网房间' }));
    await user.type(screen.getByLabelText('昵称'), '小满');
    await user.type(screen.getByLabelText('房间码'), 'ABC234');
    await user.click(screen.getByRole('button', { name: '加入房间' }));

    expect(screen.getByRole('alert')).toHaveTextContent('没有找到这个房间');
    expect(screen.getByRole('button', { name: '创建房间' })).toBeEnabled();
  });

  it('enables start for the host when two players are present', async () => {
    const socket = new FakeSocket();
    const user = userEvent.setup();
    render(<App socketFactory={() => socket} />);
    await user.click(screen.getByRole('button', { name: '联网房间' }));
    await user.type(screen.getByLabelText('昵称'), '阿林');
    await user.click(screen.getByRole('button', { name: '创建房间' }));
    socket.serverEmit('room:snapshot', roomSnapshot({
      players: [
        { id: 'p1', nickname: '阿林', chips: 1000, connected: true, isHost: true, disconnectDeadline: null },
        { id: 'p2', nickname: '小满', chips: 1000, connected: true, isHost: false, disconnectDeadline: null },
      ],
    }));

    const start = await screen.findByRole('button', { name: '开始游戏' });
    expect(start).toBeEnabled();
    await user.click(start);
    expect(socket.emitted).toContainEqual({ event: 'room:start', payload: {} });
  });

  it('copies the room code when clipboard access is available', async () => {
    const socket = new FakeSocket();
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    render(<App socketFactory={() => socket} />);
    await user.click(screen.getByRole('button', { name: '联网房间' }));
    await user.type(screen.getByLabelText('昵称'), '阿林');
    await user.click(screen.getByRole('button', { name: '创建房间' }));
    socket.serverEmit('room:snapshot', roomSnapshot());

    await user.click(await screen.findByRole('button', { name: '复制房间码' }));
    expect(writeText).toHaveBeenCalledWith('A7K9Q2');
  });
});
