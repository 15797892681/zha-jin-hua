// @vitest-environment node

import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildAiDecisionRequest } from '../src/ai/context';
import type { AiDecisionRequest } from '../src/ai/contracts';
import type { DeepSeekGateway, DeepSeekResult } from '../src/server/ai/deepseek';
import { createAiDecisionRouter } from '../src/server/ai/route';
import { FixedWindowLimiter } from '../src/server/ai/runtime';
import { createGameServer, type GameServer } from '../src/server/index';
import { createGame } from '../src/shared/game';

function body() {
  const state = createGame({
    players: [{ id: 'bot', name: '青竹' }, { id: 'you', name: '你' }],
    startingChips: 1000,
    ante: 10,
    random: () => 0,
  });
  state.players[0].cards = [
    { rank: '2', suit: 'S' },
    { rank: '7', suit: 'H' },
    { rank: '9', suit: 'D' },
  ];
  state.players[0].hasLooked = true;
  state.baseBet = 200;
  return buildAiDecisionRequest(state, 'bot', 'cautious', [], 'req-http');
}

function pressuredPairBody() {
  const state = createGame({
    players: [{ id: 'bot', name: '青竹' }, { id: 'you', name: '你' }],
    startingChips: 1000,
    ante: 10,
    random: () => 0,
  });
  state.players[0].cards = [
    { rank: '8', suit: 'S' },
    { rank: '8', suit: 'H' },
    { rank: 'K', suit: 'D' },
  ];
  state.players[0].hasLooked = true;
  state.players[1].roundContribution = 80;
  state.baseBet = 50;
  return buildAiDecisionRequest(state, 'bot', 'cautious', [
    { kind: 'action', actorId: 'you', action: 'raise', amount: 50 },
  ], 'req-pressure');
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
    runtime: { now?: () => number; limiter?: FixedWindowLimiter } = {},
  ) {
    const router = createAiDecisionRouter({
      gateway,
      env: { DEEPSEEK_API_KEY: 'test-only', ...overrides },
      logger,
      ...runtime,
    });
    server = createGameServer({ aiRouter: router });
    await server.start(0);
    const port = (server.httpServer.address() as AddressInfo).port;
    return { url: `http://127.0.0.1:${port}/api/ai/decision`, logger };
  }

  function post(url: string, value: unknown = body(), forwardedFor?: string) {
    return fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(forwardedFor ? { 'x-forwarded-for': forwardedFor } : {}),
      },
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
    expect(gateway.decide).toHaveBeenCalledOnce();
  });

  it('removes tactical folds before invoking DeepSeek', async () => {
    const decide = vi.fn<DeepSeekGateway['decide']>((request, _signal, tactics) => {
      expect(request.legalActions.canFold).toBe(false);
      expect(request.legalActions.compareTargets).toEqual(['you']);
      expect(tactics).toMatchObject({
        aggressorId: 'you',
        pressure: 'medium',
        strength: 'strong',
      });
      return Promise.resolve({
        decision: {
          action: { type: 'compare', targetId: 'you' },
          dialogue: '你加得勤，我来验牌。',
        },
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      });
    });
    const { url } = await start({ decide });

    const response = await post(url, pressuredPairBody());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      requestId: 'req-pressure',
      action: { type: 'compare', targetId: 'you' },
    });
  });

  it('returns 400 for an invalid body and never calls the gateway', async () => {
    const gateway: DeepSeekGateway = { decide: vi.fn() };
    const { url } = await start(gateway);

    const response = await post(url, {});

    expect(response.status).toBe(400);
    expect(gateway.decide).not.toHaveBeenCalled();
  });

  it('rejects a control character in the request ID before gateway invocation', async () => {
    const gateway: DeepSeekGateway = { decide: vi.fn() };
    const { url } = await start(gateway);

    const response = await post(url, { ...body(), requestId: 'req-http\nforged' });

    expect(response.status).toBe(400);
    expect(gateway.decide).not.toHaveBeenCalled();
  });

  it('returns 429 after the per-IP limit', async () => {
    const gateway: DeepSeekGateway = { decide: vi.fn().mockResolvedValue(foldResult()) };
    const { url } = await start(gateway, { AI_MAX_REQUESTS_PER_MINUTE_PER_IP: '1' });

    expect((await post(url)).status).toBe(200);
    expect((await post(url)).status).toBe(429);
  });

  it('uses forwarded client IPs from the trusted loopback test peer', async () => {
    const gateway: DeepSeekGateway = { decide: vi.fn().mockResolvedValue(foldResult()) };
    const { url } = await start(gateway, { AI_MAX_REQUESTS_PER_MINUTE_PER_IP: '1' });

    expect((await post(url, body(), '198.51.100.1')).status).toBe(200);
    expect((await post(url, body(), '198.51.100.2')).status).toBe(200);
    expect((await post(url, body(), '198.51.100.1')).status).toBe(429);
  });

  it('returns 429 after the global limit', async () => {
    const gateway: DeepSeekGateway = { decide: vi.fn().mockResolvedValue(foldResult()) };
    const { url } = await start(gateway, { AI_MAX_REQUESTS_PER_HOUR: '1' });

    expect((await post(url)).status).toBe(200);
    expect((await post(url)).status).toBe(429);
  });

  it('does not allocate per-IP state for globally rejected unique IPs', async () => {
    const gateway: DeepSeekGateway = { decide: vi.fn().mockResolvedValue(foldResult()) };
    const limiter = new FixedWindowLimiter();
    const { url } = await start(
      gateway,
      { AI_MAX_REQUESTS_PER_HOUR: '1' },
      undefined,
      { limiter },
    );

    expect((await post(url, body(), '198.51.100.1')).status).toBe(200);
    expect(limiter.sizeForTesting).toBe(2);
    for (let index = 2; index <= 10; index += 1) {
      expect((await post(url, body(), `198.51.100.${index}`)).status).toBe(429);
    }
    expect(limiter.sizeForTesting).toBe(2);
  });

  it('commits per-IP and global rate limits atomically', async () => {
    const gateway: DeepSeekGateway = { decide: vi.fn().mockResolvedValue(foldResult()) };
    const limiter = new FixedWindowLimiter();
    const { url } = await start(
      gateway,
      {
        AI_MAX_REQUESTS_PER_MINUTE_PER_IP: '1',
        AI_MAX_REQUESTS_PER_HOUR: '2',
      },
      undefined,
      { limiter },
    );

    expect((await post(url, body(), '198.51.100.1')).status).toBe(200);
    expect((await post(url, body(), '198.51.100.1')).status).toBe(429);
    expect((await post(url, body(), '198.51.100.2')).status).toBe(200);
    expect((await post(url, body(), '198.51.100.3')).status).toBe(429);
    expect(limiter.sizeForTesting).toBe(3);
    expect(gateway.decide).toHaveBeenCalledTimes(2);
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

  it('aborts the gateway when the HTTP caller disconnects without opening the circuit', async () => {
    let aborted!: (reason: unknown) => void;
    let gatewayCalls = 0;
    const gatewayAborted = new Promise<unknown>((resolve) => { aborted = resolve; });
    const gateway: DeepSeekGateway = {
      decide: vi.fn((_request: AiDecisionRequest, signal: AbortSignal) => {
        gatewayCalls += 1;
        if (gatewayCalls > 1) return Promise.resolve(foldResult());
        return new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            aborted(signal.reason);
            reject(signal.reason);
          }, { once: true });
        });
      }),
    };
    const { url } = await start(gateway, {
      AI_CIRCUIT_BREAKER_FAILURES: '1',
      AI_TIMEOUT_MS: '10000',
    });
    const caller = httpRequest(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    caller.on('error', () => undefined);
    caller.end(JSON.stringify(body()));
    await vi.waitFor(() => expect(gateway.decide).toHaveBeenCalledOnce());

    caller.destroy();

    await expect(gatewayAborted).resolves.toMatchObject({ name: 'AbortError' });
    expect((await post(url)).status).toBe(200);
    expect(gateway.decide).toHaveBeenCalledTimes(2);
  });

  it('returns 502 for three provider failures then opens without a fourth call', async () => {
    const gateway: DeepSeekGateway = { decide: vi.fn().mockRejectedValue(new Error('provider down')) };
    const { url } = await start(gateway);

    expect((await post(url)).status).toBe(502);
    expect((await post(url)).status).toBe(502);
    expect((await post(url)).status).toBe(502);
    expect((await post(url)).status).toBe(503);
    expect(gateway.decide).toHaveBeenCalledTimes(3);
  });

  it('permits only one provider probe after circuit cooldown', async () => {
    let now = 1000;
    let rejectProbe!: (reason: Error) => void;
    const gateway: DeepSeekGateway = {
      decide: vi.fn()
        .mockRejectedValueOnce(new Error('provider down'))
        .mockImplementationOnce(() => new Promise<DeepSeekResult>((_resolve, reject) => {
          rejectProbe = reject;
        })),
    };
    const { url } = await start(
      gateway,
      { AI_CIRCUIT_BREAKER_FAILURES: '1', AI_CIRCUIT_BREAKER_COOLDOWN_MS: '30000' },
      undefined,
      { now: () => now },
    );

    expect((await post(url)).status).toBe(502);
    expect((await post(url)).status).toBe(503);
    now += 30_001;
    const probe = post(url);
    await vi.waitFor(() => expect(gateway.decide).toHaveBeenCalledTimes(2));
    expect((await post(url)).status).toBe(503);
    rejectProbe(new Error('probe failed'));
    expect((await probe).status).toBe(502);
    expect(gateway.decide).toHaveBeenCalledTimes(2);
  });

  it('resets accumulated provider failures after a success', async () => {
    const gateway: DeepSeekGateway = {
      decide: vi.fn()
        .mockRejectedValueOnce(new Error('first failure'))
        .mockResolvedValueOnce(foldResult())
        .mockRejectedValue(new Error('later failure')),
    };
    const { url } = await start(gateway, { AI_CIRCUIT_BREAKER_FAILURES: '2' });

    expect((await post(url)).status).toBe(502);
    expect((await post(url)).status).toBe(200);
    expect((await post(url)).status).toBe(502);
    expect((await post(url)).status).toBe(502);
    expect((await post(url)).status).toBe(503);
    expect(gateway.decide).toHaveBeenCalledTimes(4);
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
    expect(serialized).not.toMatch(/cards|prompt|DEEPSEEK_API_KEY|test-only|收。/);
  });

  it('logs provider failures with only sanitized operational fields', async () => {
    const gateway: DeepSeekGateway = { decide: vi.fn().mockRejectedValue(new Error('provider down')) };
    const logger = { info: vi.fn(), warn: vi.fn() };
    const { url } = await start(gateway, {}, logger);

    expect((await post(url)).status).toBe(502);

    expect(logger.warn).toHaveBeenCalledOnce();
    const [event, fields] = logger.warn.mock.calls[0];
    expect(event).toBe('ai_decision');
    expect(Object.keys(fields)).toEqual(['requestId', 'latencyMs', 'model', 'status']);
    expect(JSON.stringify(logger.warn.mock.calls))
      .not.toMatch(/cards|prompt|DEEPSEEK_API_KEY|test-only|provider down/);
  });

  it('keeps successful responses and the circuit healthy when info logging throws', async () => {
    const gateway: DeepSeekGateway = { decide: vi.fn().mockResolvedValue(foldResult()) };
    const logger = {
      info: vi.fn(() => { throw new Error('logger unavailable'); }),
      warn: vi.fn(),
    };
    const { url } = await start(gateway, { AI_CIRCUIT_BREAKER_FAILURES: '1' }, logger);

    expect((await post(url)).status).toBe(200);
    expect((await post(url)).status).toBe(200);
    expect(gateway.decide).toHaveBeenCalledTimes(2);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('preserves provider error responses when warning logging throws', async () => {
    const gateway: DeepSeekGateway = { decide: vi.fn().mockRejectedValue(new Error('provider down')) };
    const logger = {
      info: vi.fn(),
      warn: vi.fn(() => { throw new Error('logger unavailable'); }),
    };
    const { url } = await start(gateway, {}, logger);

    expect((await post(url)).status).toBe(502);
    expect(gateway.decide).toHaveBeenCalledOnce();
  });
});
