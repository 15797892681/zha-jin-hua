import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AiDecisionService, AiTurnDecision } from '../src/client/game/aiDecisionService';
import { useSoloGame } from '../src/client/game/useSoloGame';

afterEach(() => {
  vi.useRealTimers();
});

describe('useSoloGame model turns', () => {
  it('starts exactly one request and records the returned dialogue', async () => {
    vi.useFakeTimers();
    const service: AiDecisionService = {
      decide: vi.fn().mockResolvedValue({
        source: 'deepseek',
        action: { type: 'fold', playerId: 'bot-cautious', turnId: 2 },
        dialogue: '这轮先观察。',
      }),
    };
    const { result } = renderHook(() => useSoloGame(service));

    act(() => result.current.dispatch({ type: 'call', playerId: 'you', turnId: 1 }));
    await act(async () => vi.advanceTimersByTimeAsync(800));

    expect(service.decide).toHaveBeenCalledTimes(1);
    expect(result.current.aiDialogueByPlayerId['bot-cautious']).toBe('这轮先观察。');
    expect(result.current.view.players.find((player) => player.id === 'bot-cautious')?.status).toBe('folded');
  });

  it('discards a pending result after match reset', async () => {
    vi.useFakeTimers();
    let resolveDecision!: (decision: AiTurnDecision) => void;
    const service: AiDecisionService = {
      decide: vi.fn(() => new Promise<AiTurnDecision>((resolve) => {
        resolveDecision = resolve;
      })),
    };
    const { result } = renderHook(() => useSoloGame(service));

    act(() => result.current.dispatch({ type: 'call', playerId: 'you', turnId: 1 }));
    await act(async () => vi.advanceTimersByTimeAsync(800));
    expect(service.decide).toHaveBeenCalledTimes(1);

    act(() => result.current.resetMatch());
    await act(async () => resolveDecision({
      source: 'rule',
      action: { type: 'fold', playerId: 'bot-cautious', turnId: 2 },
      dialogue: '不应出现。',
    }));

    expect(result.current.view.turnId).toBe(1);
    expect(result.current.view.currentPlayerId).toBe('you');
    expect(result.current.view.players.find((player) => player.id === 'bot-cautious')?.status).toBe('active');
    expect(result.current.aiDialogueByPlayerId).toEqual({});
    expect(result.current.aiNotice).toBeNull();
  });

  it('keeps one model request per AI turn in StrictMode', async () => {
    vi.useFakeTimers();
    const decide = vi.fn<AiDecisionService['decide']>(async (state, playerId) => ({
      source: 'deepseek',
      action: { type: 'fold', playerId, turnId: state.turnId },
      dialogue: '这轮先观察。',
    }));
    const { result } = renderHook(() => useSoloGame({ decide }), { reactStrictMode: true });

    act(() => result.current.dispatch({ type: 'call', playerId: 'you', turnId: 1 }));
    await act(async () => vi.advanceTimersByTimeAsync(800));

    expect(decide).toHaveBeenCalledTimes(1);
  });

  it('caps ordered action-dialogue memory across rounds and clears it on reset and remount', async () => {
    vi.useFakeTimers();
    const decide = vi.fn<AiDecisionService['decide']>(async (state, playerId) => ({
      source: 'deepseek',
      action: { type: 'fold', playerId, turnId: state.turnId },
      dialogue: '这轮先观察。',
    }));
    const first = renderHook(() => useSoloGame({ decide }));

    act(() => first.result.current.dispatch({ type: 'call', playerId: 'you', turnId: 1 }));
    for (let bot = 0; bot < 3; bot += 1) {
      await act(async () => vi.advanceTimersByTimeAsync(800));
    }
    expect(first.result.current.view.status).toBe('finished');

    act(() => first.result.current.nextRound());
    act(() => first.result.current.dispatch({ type: 'call', playerId: 'you', turnId: 1 }));
    await act(async () => vi.advanceTimersByTimeAsync(800));

    const nextRoundMemory = decide.mock.calls[3][3];
    expect(nextRoundMemory).toHaveLength(8);
    expect(nextRoundMemory.map((entry) => entry.kind)).toEqual([
      'action',
      'action', 'dialogue',
      'action', 'dialogue',
      'action', 'dialogue',
      'action',
    ]);

    act(() => first.result.current.resetMatch());
    act(() => first.result.current.dispatch({ type: 'call', playerId: 'you', turnId: 1 }));
    await act(async () => vi.advanceTimersByTimeAsync(800));
    expect(decide.mock.calls.at(-1)?.[3]).toEqual([
      { kind: 'action', actorId: 'you', action: 'call' },
    ]);

    first.unmount();
    const second = renderHook(() => useSoloGame({ decide }));
    act(() => second.result.current.dispatch({ type: 'call', playerId: 'you', turnId: 1 }));
    await act(async () => vi.advanceTimersByTimeAsync(800));
    expect(decide.mock.calls.at(-1)?.[3]).toEqual([
      { kind: 'action', actorId: 'you', action: 'call' },
    ]);
  });
});
