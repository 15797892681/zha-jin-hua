import { legalActions } from '../shared/game';
import type { GameAction, GameState } from '../shared/types';
import { aiDecisionRequestSchema } from './contracts';
import type { AiDecisionRequest, AiStyle, PublicMemoryEntry } from './contracts';

export function appendPublicMemory(
  memory: PublicMemoryEntry[],
  entry: PublicMemoryEntry,
): PublicMemoryEntry[] {
  return [...memory, entry].slice(-8);
}

export function actionToMemory(action: GameAction): PublicMemoryEntry {
  const base = { kind: 'action' as const, actorId: action.playerId, action: action.type };
  if (action.type === 'raise') return { ...base, amount: action.amount };
  if (action.type === 'compare') return { ...base, targetId: action.targetId };
  return base;
}

export function buildAiDecisionRequest(
  state: GameState,
  playerId: string,
  style: AiStyle,
  memory: PublicMemoryEntry[],
  requestId: string,
): AiDecisionRequest {
  if (state.status !== 'playing' || state.currentPlayerId !== playerId) throw new Error('AI_NOT_ACTING');
  const self = state.players.find((player) => player.id === playerId);
  if (!self || self.status !== 'active') throw new Error('AI_NOT_ACTING');
  const actions = legalActions(state, playerId);
  return aiDecisionRequestSchema.parse({
    requestId, turnId: state.turnId, playerId, style,
    self: {
      cards: self.hasLooked ? self.cards.map((card) => ({ ...card })) : null,
      chips: self.chips, hasLooked: self.hasLooked,
      roundContribution: self.roundContribution,
    },
    table: {
      pot: state.pot, ante: state.ante, baseBet: state.baseBet,
      actionCount: state.actionCount,
      players: state.players.map(({ id, name, chips, status, hasLooked, roundContribution }) => ({
        id, name, chips, status, hasLooked, roundContribution,
      })),
    },
    legalActions: {
      canLook: actions.canLook, callCost: actions.callCost,
      raiseAmounts: [...actions.raiseAmounts], compareCost: actions.compareCost,
      compareTargets: [...actions.compareTargets], canFold: actions.canFold,
    },
    memory: memory.slice(-8),
  });
}
