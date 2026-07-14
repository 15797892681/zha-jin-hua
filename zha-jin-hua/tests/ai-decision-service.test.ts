import { describe, expect, it, vi } from 'vitest';

import { createAiDecisionService } from '../src/client/game/aiDecisionService';
import type { PublicMemoryEntry } from '../src/ai/contracts';
import { createGame } from '../src/shared/game';

function state() {
  return createGame({
    players: [{ id: 'bot', name: '青竹' }, { id: 'you', name: '你' }],
    startingChips: 1000,
    ante: 10,
    random: () => 0,
  });
}

describe('AI decision service', () => {
  it('returns a valid remote response', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        requestId: request.requestId,
        turnId: request.turnId,
        playerId: request.playerId,
        action: { type: 'fold', playerId: request.playerId, turnId: request.turnId },
        dialogue: '这一手先收住。',
      }), { status: 200 });
    });
    const service = createAiDecisionService({ fetchImpl, requestId: () => 'req-client' });

    await expect(service.decide(state(), 'bot', 'cautious', [], new AbortController().signal))
      .resolves.toMatchObject({
        source: 'deepseek',
        dialogue: '这一手先收住。',
        action: { type: 'fold' },
      });
  });

  it.each([503, 429, 500])('falls back on HTTP %s', async (status) => {
    const service = createAiDecisionService({
      fetchImpl: vi.fn().mockResolvedValue(new Response('{}', { status })),
      requestId: () => 'req-fallback',
      random: () => 0,
    });

    const result = await service.decide(
      state(),
      'bot',
      'cautious',
      [],
      new AbortController().signal,
    );

    expect(result.source).toBe('rule');
    expect(result.fallbackReason).toBe(`HTTP_${status}`);
  });

  it('uses expert counterplay when a provider failure exposes a viewed pair to pressure', async () => {
    const game = state();
    game.players[0].cards = [
      { rank: '8', suit: 'S' },
      { rank: '8', suit: 'H' },
      { rank: 'K', suit: 'D' },
    ];
    game.players[0].hasLooked = true;
    game.players[1].roundContribution = 80;
    game.baseBet = 50;
    game.lastAction = { type: 'raise', playerId: 'you', amount: 50 };
    const memory: PublicMemoryEntry[] = [
      { kind: 'action', actorId: 'you', action: 'raise', amount: 50 },
    ];
    const service = createAiDecisionService({
      fetchImpl: vi.fn().mockResolvedValue(new Response('{}', { status: 503 })),
      requestId: () => 'req-expert-fallback',
      random: () => 0,
    });

    await expect(service.decide(
      game,
      'bot',
      'cautious',
      memory,
      new AbortController().signal,
    )).resolves.toMatchObject({
      source: 'rule',
      action: { type: 'compare', targetId: 'you' },
    });
  });

  it('falls back when a response action is illegal for the current state', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        requestId: request.requestId,
        turnId: request.turnId,
        playerId: request.playerId,
        action: {
          type: 'raise',
          amount: 11,
          playerId: request.playerId,
          turnId: request.turnId,
        },
        dialogue: '非法加注不会执行。',
      }), { status: 200 });
    });
    const service = createAiDecisionService({
      fetchImpl,
      requestId: () => 'req-illegal',
      random: () => 0,
    });

    await expect(service.decide(state(), 'bot', 'cautious', [], new AbortController().signal))
      .resolves.toMatchObject({ source: 'rule', fallbackReason: 'ILLEGAL_RESPONSE_ACTION' });
  });

  it('falls back after its three-second budget', async () => {
    vi.useFakeTimers();
    const service = createAiDecisionService({
      fetchImpl: vi.fn<typeof fetch>((_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(init.signal?.reason),
          { once: true },
        );
      })),
      requestId: () => 'req-timeout',
      timeoutMs: 3000,
      random: () => 0,
    });
    const pending = service.decide(
      state(),
      'bot',
      'cautious',
      [],
      new AbortController().signal,
    );

    await vi.advanceTimersByTimeAsync(3000);
    await expect(pending).resolves.toMatchObject({ source: 'rule', fallbackReason: 'TIMEOUT' });
    vi.useRealTimers();
  });

  it('does not execute fallback after an external reset abort', async () => {
    const controller = new AbortController();
    const service = createAiDecisionService({
      fetchImpl: vi.fn<typeof fetch>((_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(init.signal?.reason),
          { once: true },
        );
      })),
      requestId: () => 'req-abort',
    });
    const pending = service.decide(state(), 'bot', 'cautious', [], controller.signal);

    controller.abort(new DOMException('reset', 'AbortError'));

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
