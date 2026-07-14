import { buildAiDecisionRequest } from './context';
import { intentToGameAction } from './contracts';
import type { AiStyle, PublicMemoryEntry } from './contracts';
import { buildTacticalPolicy } from './tactics';
import type { GameAction, GameState } from '../shared/types';

export type { AiStyle } from './contracts';

export function chooseAiAction(
  state: GameState,
  playerId: string,
  style: AiStyle,
  random: () => number = Math.random,
  memory: readonly PublicMemoryEntry[] = [],
): GameAction {
  const request = buildAiDecisionRequest(state, playerId, style, [...memory], 'local');
  const policy = buildTacticalPolicy(request, random);
  return intentToGameAction(policy.preferredAction, request);
}
