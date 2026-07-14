import { evaluateHand } from '../shared/evaluate';
import { legalActions } from '../shared/game';
import type { GameAction, GameState, LegalActions } from '../shared/types';
import type { AiStyle, PublicMemoryEntry } from './contracts';

export type { AiStyle } from './contracts';

function lookAction(state: GameState, playerId: string): GameAction {
  return { type: 'look', playerId, turnId: state.turnId };
}

function foldAction(state: GameState, playerId: string): GameAction {
  return { type: 'fold', playerId, turnId: state.turnId };
}

function callAction(state: GameState, playerId: string): GameAction {
  return { type: 'call', playerId, turnId: state.turnId };
}

function raiseAction(state: GameState, playerId: string, amount: number): GameAction {
  return { type: 'raise', playerId, amount, turnId: state.turnId };
}

function compareAction(state: GameState, playerId: string, targetId: string): GameAction {
  return { type: 'compare', playerId, targetId, turnId: state.turnId };
}

function fallbackAction(state: GameState, playerId: string, actions: LegalActions): GameAction {
  if (actions.callCost !== null) {
    return callAction(state, playerId);
  }
  return foldAction(state, playerId);
}

function chooseBlindAction(
  state: GameState,
  playerId: string,
  style: AiStyle,
  actions: LegalActions,
  randomValue: number,
): GameAction {
  const lookChance = style === 'cautious' ? 0.65 : style === 'bold' ? 0.3 : 0.45;
  if (actions.canLook && randomValue < lookChance) {
    return lookAction(state, playerId);
  }
  if (style === 'cautious' && actions.callCost !== null) {
    return callAction(state, playerId);
  }

  const candidates: GameAction[] = [];
  if (actions.callCost !== null) {
    candidates.push(callAction(state, playerId));
  }
  if (style !== 'cautious') {
    for (const amount of actions.raiseAmounts) {
      candidates.push(raiseAction(state, playerId, amount));
    }
  }
  for (const targetId of actions.compareTargets) {
    candidates.push(compareAction(state, playerId, targetId));
  }
  if (actions.canLook) {
    candidates.push(lookAction(state, playerId));
  }

  if (candidates.length === 0) return foldAction(state, playerId);
  const index = Math.min(candidates.length - 1, Math.floor(randomValue * candidates.length));
  return candidates[index];
}

function normalizedTieBreakers(tieBreakers: readonly number[]): number {
  const weights = [0.7, 0.2, 0.1];
  return tieBreakers.reduce((score, rank, index) => (
    score + (rank / 14) * (weights[index] ?? 0)
  ), 0);
}

function handConfidence(cards: GameState['players'][number]['cards']): number {
  const hand = evaluateHand(cards);
  const tie = normalizedTieBreakers(hand.tieBreakers);
  switch (hand.category) {
    case 'high-card': return 0.2 + tie * 0.52;
    case 'pair': return 0.72 + tie * 0.12;
    case 'straight': return 0.84 + tie * 0.04;
    case 'flush': return 0.88 + tie * 0.07;
    case 'straight-flush': return 0.95 + tie * 0.03;
    case 'triple': return 0.98 + tie * 0.02;
  }
}

function facedRecentRaise(memory: readonly PublicMemoryEntry[], playerId: string): boolean {
  for (let index = memory.length - 1; index >= Math.max(0, memory.length - 4); index -= 1) {
    const entry = memory[index];
    if (entry.kind === 'action' && entry.actorId !== playerId) {
      return entry.action === 'raise';
    }
  }
  return false;
}

export function chooseAiAction(
  state: GameState,
  playerId: string,
  style: AiStyle,
  random: () => number = Math.random,
  memory: readonly PublicMemoryEntry[] = [],
): GameAction {
  if (state.status !== 'playing' || state.currentPlayerId !== playerId) {
    throw new Error('AI_NOT_ACTING');
  }

  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player || player.status !== 'active') {
    throw new Error('AI_NOT_ACTING');
  }

  const actions = legalActions(state, playerId);
  const randomValue = Math.min(0.999_999, Math.max(0, random()));

  if (
    state.actionCount >= state.players.length * 4
    && actions.compareTargets.length > 0
  ) {
    return compareAction(state, playerId, actions.compareTargets[0]);
  }

  if (!player.hasLooked) {
    return chooseBlindAction(state, playerId, style, actions, randomValue);
  }

  const confidence = handConfidence(player.cards);
  const potOdds = actions.callCost === null
    ? Number.POSITIVE_INFINITY
    : actions.callCost / Math.max(1, state.pot + actions.callCost);
  const activeOpponents = state.players.filter((candidate) => (
    candidate.id !== playerId && candidate.status === 'active'
  )).length;
  const requiredConfidence = potOdds
    + Math.max(0, activeOpponents - 1) * 0.03
    + (style === 'cautious' ? 0.05 : style === 'bold' ? -0.04 : 0);
  const adjustedConfidence = style === 'chaotic'
    ? confidence + (randomValue - 0.5) * 0.24
    : confidence;
  const isLateRound = state.actionCount >= state.players.length * 2;
  const facingRaise = state.lastAction?.type === 'raise' || facedRecentRaise(memory, playerId);

  if (
    actions.compareTargets.length > 0
    && (
      (confidence >= 0.84 && (facingRaise || actions.raiseAmounts.length === 0))
      || (facingRaise && isLateRound && confidence >= 0.62)
    )
  ) {
    return compareAction(state, playerId, actions.compareTargets[0]);
  }

  if (style === 'bold') {
    if (confidence >= 0.95 && actions.raiseAmounts.length > 0) {
      return raiseAction(state, playerId, actions.raiseAmounts.at(-1) as number);
    }
    if (confidence >= 0.82 && actions.raiseAmounts.length > 0) {
      return raiseAction(state, playerId, actions.raiseAmounts[Math.floor(actions.raiseAmounts.length / 2)]);
    }
    if (confidence >= 0.7 && actions.raiseAmounts.length > 0 && randomValue < 0.55) {
      return raiseAction(state, playerId, actions.raiseAmounts[0]);
    }
    if (adjustedConfidence >= requiredConfidence) {
      return fallbackAction(state, playerId, actions);
    }
    return foldAction(state, playerId);
  }

  if (confidence >= 0.84 && actions.raiseAmounts.length > 0 && randomValue < 0.4) {
    return raiseAction(state, playerId, actions.raiseAmounts[0]);
  }
  if (adjustedConfidence >= requiredConfidence) {
    return fallbackAction(state, playerId, actions);
  }
  return foldAction(state, playerId);
}
