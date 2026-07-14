import { aiDecisionResponseSchema } from '../../ai/contracts';
import type { AiStyle, PublicMemoryEntry } from '../../ai/contracts';
import { buildAiDecisionRequest } from '../../ai/context';
import { chooseAiAction } from '../../ai/strategy';
import { applyAction } from '../../shared/game';
import type { GameAction, GameState } from '../../shared/types';

export interface AiTurnDecision {
  action: GameAction;
  dialogue: string;
  source: 'deepseek' | 'rule';
  fallbackReason?: string;
}

export interface AiDecisionService {
  decide(
    state: GameState,
    playerId: string,
    style: AiStyle,
    memory: PublicMemoryEntry[],
    signal: AbortSignal,
  ): Promise<AiTurnDecision>;
}

interface Options {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  requestId?: () => string;
  random?: () => number;
}

const FALLBACK_DIALOGUE: Record<AiStyle, string[]> = {
  cautious: ['稳一点，再看局势。', '这手先按规矩来。'],
  bold: ['别眨眼，我可要上了。', '这一手，压力给满。'],
  chaotic: ['风往哪吹，我就往哪押。', '猜猜我是真敢还是假敢。'],
};

export function createAiDecisionService(options: Options = {}): AiDecisionService {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 3000;
  const requestId = options.requestId ?? (() => crypto.randomUUID());
  const random = options.random ?? Math.random;

  return {
    async decide(state, playerId, style, memory, externalSignal) {
      const request = buildAiDecisionRequest(state, playerId, style, memory, requestId());
      const timeoutController = new AbortController();
      const timeout = globalThis.setTimeout(() => {
        timeoutController.abort(new DOMException('timeout', 'TimeoutError'));
      }, timeoutMs);
      const signal = AbortSignal.any([externalSignal, timeoutController.signal]);

      try {
        const response = await fetchImpl('/api/ai/decision', {
          method: 'POST',
          signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(request),
        });
        if (!response.ok) throw new Error(`HTTP_${response.status}`);

        const parsed = aiDecisionResponseSchema.parse(await response.json());
        if (
          parsed.requestId !== request.requestId
          || parsed.turnId !== request.turnId
          || parsed.playerId !== request.playerId
          || parsed.action.turnId !== request.turnId
          || parsed.action.playerId !== request.playerId
        ) {
          throw new Error('STALE_OR_MISMATCHED_RESPONSE');
        }

        try {
          applyAction(state, parsed.action);
        } catch {
          throw new Error('ILLEGAL_RESPONSE_ACTION');
        }

        return {
          action: parsed.action,
          dialogue: parsed.dialogue,
          source: 'deepseek',
        };
      } catch (error) {
        if (externalSignal.aborted) throw externalSignal.reason;

        const fallbackReason = timeoutController.signal.aborted
          ? 'TIMEOUT'
          : error instanceof Error
            ? error.message
            : 'UNKNOWN';
        const lines = FALLBACK_DIALOGUE[style];

        return {
          action: chooseAiAction(state, playerId, style, random, memory),
          dialogue: lines[Math.min(lines.length - 1, Math.floor(random() * lines.length))],
          source: 'rule',
          fallbackReason,
        };
      } finally {
        globalThis.clearTimeout(timeout);
      }
    },
  };
}

export const browserAiDecisionService = createAiDecisionService();
