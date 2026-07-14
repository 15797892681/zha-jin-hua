import { Router } from 'express';

import { aiDecisionRequestSchema, intentToGameAction } from '../../ai/contracts';
import { createDeepSeekGateway, type DeepSeekGateway, type DeepSeekResult } from './deepseek';
import { CircuitBreaker, FixedWindowLimiter, loadAiRuntimeConfig } from './runtime';

interface Logger {
  info(event: string, fields: Record<string, unknown>): void;
  warn(event: string, fields: Record<string, unknown>): void;
}

interface RouteOptions {
  env?: Record<string, string | undefined>;
  gateway?: DeepSeekGateway;
  logger?: Logger;
  now?: () => number;
  limiter?: FixedWindowLimiter;
}

function bestEffort(log: () => void): void {
  try {
    log();
  } catch {
    // Logging must never affect provider health or the HTTP response.
  }
}

export function createAiDecisionRouter(options: RouteOptions = {}): Router {
  const env = options.env ?? process.env;
  const config = loadAiRuntimeConfig(env);
  const logger = options.logger ?? console;
  const now = options.now ?? Date.now;
  const limiter = options.limiter ?? new FixedWindowLimiter(now);
  const breaker = new CircuitBreaker(config.breakerFailures, config.breakerCooldownMs, now);
  const gateway = options.gateway ?? (config.enabled ? createDeepSeekGateway(config) : undefined);
  const router = Router();

  router.post('/decision', async (request, response) => {
    const startedAt = now();
    const parsed = aiDecisionRequestSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ code: 'AI_INVALID_REQUEST' });

    const decisionRequest = parsed.data;
    const ip = request.ip || request.socket.remoteAddress || 'unknown';
    if (!config.enabled || !gateway) return response.status(503).json({ code: 'AI_DISABLED' });
    if (
      !limiter.take('global', config.globalPerHour, 3_600_000)
      || !limiter.take(`ip:${ip}`, config.perIpPerMinute, 60_000)
    ) {
      return response.status(429).json({ code: 'AI_RATE_LIMITED' });
    }
    if (!breaker.canRequest()) return response.status(503).json({ code: 'AI_CIRCUIT_OPEN' });

    const signal = AbortSignal.timeout(config.timeoutMs);
    let result: DeepSeekResult;
    try {
      result = await gateway.decide(decisionRequest, signal);
    } catch (error) {
      breaker.failure();
      const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
      bestEffort(() => {
        logger.warn('ai_decision', {
          requestId: decisionRequest.requestId,
          latencyMs: now() - startedAt,
          model: config.model,
          status: timedOut ? 'timeout' : 'provider_error',
        });
      });
      return response.status(timedOut ? 504 : 502).json({
        code: timedOut ? 'AI_TIMEOUT' : 'AI_PROVIDER_ERROR',
      });
    }

    breaker.success();
    const action = intentToGameAction(result.decision.action, decisionRequest);
    bestEffort(() => {
      logger.info('ai_decision', {
        requestId: decisionRequest.requestId,
        latencyMs: now() - startedAt,
        model: config.model,
        totalTokens: result.usage.totalTokens,
        status: 'ok',
      });
    });
    return response.json({
      requestId: decisionRequest.requestId,
      turnId: decisionRequest.turnId,
      playerId: decisionRequest.playerId,
      action,
      dialogue: result.decision.dialogue,
    });
  });

  return router;
}
