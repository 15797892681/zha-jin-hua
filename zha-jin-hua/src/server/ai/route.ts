import { Router } from 'express';

import { aiDecisionRequestSchema, intentToGameAction } from '../../ai/contracts';
import { createDeepSeekGateway, type DeepSeekGateway } from './deepseek';
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
}

export function createAiDecisionRouter(options: RouteOptions = {}): Router {
  const env = options.env ?? process.env;
  const config = loadAiRuntimeConfig(env);
  const logger = options.logger ?? console;
  const now = options.now ?? Date.now;
  const limiter = new FixedWindowLimiter(now);
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
      !limiter.take(`ip:${ip}`, config.perIpPerMinute, 60_000)
      || !limiter.take('global', config.globalPerHour, 3_600_000)
    ) {
      return response.status(429).json({ code: 'AI_RATE_LIMITED' });
    }
    if (!breaker.canRequest()) return response.status(503).json({ code: 'AI_CIRCUIT_OPEN' });

    try {
      const result = await gateway.decide(decisionRequest, AbortSignal.timeout(config.timeoutMs));
      breaker.success();
      const action = intentToGameAction(result.decision.action, decisionRequest);
      logger.info('ai_decision', {
        requestId: decisionRequest.requestId,
        latencyMs: now() - startedAt,
        model: config.model,
        totalTokens: result.usage.totalTokens,
        status: 'ok',
      });
      return response.json({
        requestId: decisionRequest.requestId,
        turnId: decisionRequest.turnId,
        playerId: decisionRequest.playerId,
        action,
        dialogue: result.decision.dialogue,
      });
    } catch (error) {
      breaker.failure();
      const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
      logger.warn('ai_decision', {
        requestId: decisionRequest.requestId,
        latencyMs: now() - startedAt,
        model: config.model,
        status: timedOut ? 'timeout' : 'provider_error',
      });
      return response.status(timedOut ? 504 : 502).json({
        code: timedOut ? 'AI_TIMEOUT' : 'AI_PROVIDER_ERROR',
      });
    }
  });

  return router;
}
