// @vitest-environment node

import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildAiDecisionRequest } from '../src/ai/context';
import type { AiDecisionRequest } from '../src/ai/contracts';
import type { DeepSeekGateway } from '../src/server/ai/deepseek';
import { createAiDecisionRouter } from '../src/server/ai/route';
import { createGameServer, type GameServer } from '../src/server/index';
import { createGame } from '../src/shared/game';

function body() {
  const state = createGame({
    players: [{ id: 'bot', name: '青竹' }, { id: 'you', name: '你' }],
    startingChips: 1000,
    ante: 10,
    random: () => 0,
  });
  return buildAiDecisionRequest(state, 'bot', 'cautious', [], 'req-http');
}

function foldResult(dialogue = '收。') {
  return {
    decision: { action: { type: 'fold' } as const, dialogue },
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
  };
}

describe('AI decision route', () => {
  let server: GameServer | undefined;

  afterEach(async () => {
    await server?.stop();
    server = undefined;
  });

  async function start(
    gateway: DeepSeekGateway,
    overrides: Record<string, string> = {},
    logger = { info: vi.fn(), warn: vi.fn() },
  ) {
    const router = createAiDecisionRouter({
      gateway,
      env: { DEEPSEEK_API_KEY: 'test-only', ...overrides },
      logger,
    });
    server = createGameServer({ aiRouter: router });
    await server.start(0);
    const port = (server.httpServer.address() as AddressInfo).port;
    return { url: `http://127.0.0.1:${port}/api/ai/decision`, logger };
  }

  function post(url: string, value: unknown = body()) {
    return fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(value),
    });
  }

  it('returns a trusted full action from a legal model intent', async () => {
    const gateway: DeepSeekGateway = { decide: vi.fn().mockResolvedValue(foldResult('先收一手。')) };
    const { url } = await start(gateway);

    const response = await post(url);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      requestId: 'req-http',
      playerId: 'bot',
      turnId: 1,
      action: { type: 'fold', playerId: 'bot', turnId: 1 },
      dialogue: '先收一手。',
    });
  });

  it('returns 400 for an invalid body and never calls the gateway', async () => {
    const gateway: DeepSeekGateway = { decide: vi.fn() };
    const { url } = await start(gateway);

    const response = await post(url, {});

    expect(response.status).toBe(400);
    expect(gateway.decide).not.toHaveBeenCalled();
  });

  it('returns 429 after the per-IP limit', async () => {
    const gateway: DeepSeekGateway = { decide: vi.fn().mockResolvedValue(foldResult()) };
    const { url } = await start(gateway, { AI_MAX_REQUESTS_PER_MINUTE_PER_IP: '1' });

    expect((await post(url)).status).toBe(200);
    expect((await post(url)).status).toBe(429);
  });

  it('returns 429 after the global limit', async () => {
    const gateway: DeepSeekGateway = { decide: vi.fn().mockResolvedValue(foldResult()) };
    const { url } = await start(gateway, { AI_MAX_REQUESTS_PER_HOUR: '1' });

    expect((await post(url)).status).toBe(200);
    expect((await post(url)).status).toBe(429);
  });

  it('rejects JSON bodies larger than 16 KB before calling the gateway', async () => {
    const gateway: DeepSeekGateway = { decide: vi.fn() };
    const { url } = await start(gateway);

    const response = await post(url, { ...body(), padding: 'x'.repeat(17 * 1024) });

    expect(response.status).toBe(413);
    expect(gateway.decide).not.toHaveBeenCalled();
  });

  it('aborts a slow gateway and returns 504', async () => {
    const gateway: DeepSeekGateway = {
      decide: vi.fn((_request: AiDecisionRequest, signal: AbortSignal) => new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      })),
    };
    const { url } = await start(gateway, { AI_TIMEOUT_MS: '10' });

    const response = await post(url);

    expect(response.status).toBe(504);
  });

  it('logs only sanitized operational fields', async () => {
    const gateway: DeepSeekGateway = { decide: vi.fn().mockResolvedValue(foldResult()) };
    const logger = { info: vi.fn(), warn: vi.fn() };
    const { url } = await start(gateway, {}, logger);

    expect((await post(url)).status).toBe(200);

    expect(logger.info).toHaveBeenCalledOnce();
    const [event, fields] = logger.info.mock.calls[0];
    expect(event).toBe('ai_decision');
    expect(Object.keys(fields)).toEqual(['requestId', 'latencyMs', 'model', 'totalTokens', 'status']);
    const serialized = JSON.stringify(logger.info.mock.calls);
    expect(serialized).not.toMatch(/cards|prompt|DEEPSEEK_API_KEY|test-only|先收一手/);
  });
});
