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
      source: 'deepseek',
      action: { type: 'fold', playerId: 'bot-cautious', turnId: 2 },
      dialogue: '不应出现。',
    }));

    expect(result.current.view.turnId).toBe(1);
    expect(result.current.view.currentPlayerId).toBe('you');
    expect(result.current.aiDialogueByPlayerId).toEqual({});
  });
});
