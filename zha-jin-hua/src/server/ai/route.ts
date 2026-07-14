import { Router } from 'express';

import {
  aiDecisionRequestSchema,
  intentToGameAction,
  isLegalIntent,
  type AiDecisionRequest,
} from '../../ai/contracts';
import { buildTacticalPolicy, narrowLegalActions } from '../../ai/tactics';
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
    if (!limiter.takeAll([
      { key: 'global', limit: config.globalPerHour, windowMs: 3_600_000 },
      { key: `ip:${ip}`, limit: config.perIpPerMinute, windowMs: 60_000 },
    ])) {
      return response.status(429).json({ code: 'AI_RATE_LIMITED' });
    }
    if (!breaker.canRequest()) return response.status(503).json({ code: 'AI_CIRCUIT_OPEN' });

    const clientAbort = new AbortController();
    const abortForDisconnect = () => {
      if (!clientAbort.signal.aborted) {
        clientAbort.abort(new DOMException('Client disconnected', 'AbortError'));
      }
    };
    request.once('aborted', abortForDisconnect);
    response.once('close', abortForDisconnect);
    const timeoutSignal = AbortSignal.timeout(config.timeoutMs);
    const signal = AbortSignal.any([timeoutSignal, clientAbort.signal]);
    let result: DeepSeekResult;
    let tacticalRequest: AiDecisionRequest;
    try {
      const policy = buildTacticalPolicy(decisionRequest);
      tacticalRequest = {
        ...decisionRequest,
        legalActions: narrowLegalActions(decisionRequest.legalActions, policy.safeActions),
      };
      result = await gateway.decide(tacticalRequest, signal, {
        pressure: policy.pressure,
        aggressorId: policy.aggressorId,
        strength: policy.strength,
      });
      if (!isLegalIntent(result.decision.action, tacticalRequest.legalActions)) {
        throw new Error('AI_TACTICAL_ACTION_REJECTED');
      }
    } catch (error) {
      if (clientAbort.signal.aborted) {
        breaker.cancel();
        return;
      }
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
    } finally {
      request.off('aborted', abortForDisconnect);
      response.off('close', abortForDisconnect);
    }

    if (clientAbort.signal.aborted || response.destroyed) {
      breaker.cancel();
      return;
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
