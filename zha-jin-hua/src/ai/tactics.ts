import { evaluateHand } from '../shared/evaluate';
import { RANKS, SUITS } from '../shared/types';
import type { Card, HandValue } from '../shared/types';
import { isLegalIntent } from './contracts';
import type {
  AiActionIntent,
  AiDecisionRequest,
  AiLegalActions,
  AiStyle,
} from './contracts';

export type Pressure = 'low' | 'medium' | 'high';

export interface TacticalPromptContext {
  pressure: Pressure;
  aggressorId: string | null;
  strength: 'unknown' | 'weak' | 'competitive' | 'strong';
}

export interface TacticalPolicy extends TacticalPromptContext {
  preferredAction: AiActionIntent;
  safeActions: AiActionIntent[];
  equity: number | null;
}

const STYLE_SHIFT: Record<AiStyle, number> = {
  cautious: 0.04,
  bold: -0.04,
  chaotic: 0,
};

const CURRENT_RAISE_SCORE = 2;
const MEDIUM_PRESSURE_SCORE = 3;
const HIGH_PRESSURE_SCORE = 6;
const COMPETITIVE_PERCENTILE = 0.5;
const STRONG_PERCENTILE = 0.72;
const VALUE_RAISE_PERCENTILE = 0.78;

function handScore(value: HandValue): number {
  const [first = 0, second = 0, third = 0] = value.tieBreakers;
  return value.categoryScore * 15 ** 3 + first * 15 ** 2 + second * 15 + third;
}

let handDistribution: number[] | undefined;

function distribution(): number[] {
  if (handDistribution) return handDistribution;
  const deck: Card[] = RANKS.flatMap((rank) => SUITS.map((suit) => ({ rank, suit })));
  const scores: number[] = [];
  for (let first = 0; first < deck.length - 2; first += 1) {
    for (let second = first + 1; second < deck.length - 1; second += 1) {
      for (let third = second + 1; third < deck.length; third += 1) {
        scores.push(handScore(evaluateHand([deck[first], deck[second], deck[third]])));
      }
    }
  }
  handDistribution = scores.sort((left, right) => left - right);
  return handDistribution;
}

function lowerBound(values: readonly number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle] < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function upperBound(values: readonly number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle] <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function estimateHandPercentile(cards: readonly Card[]): number {
  const values = distribution();
  const score = handScore(evaluateHand(cards));
  const lower = lowerBound(values, score);
  const upper = upperBound(values, score);
  return (lower + (upper - lower) / 2) / values.length;
}

interface PressureProfile {
  pressure: Pressure;
  aggressorId: string | null;
}

function profilePressure(request: AiDecisionRequest): PressureProfile {
  const opponents = request.table.players.filter((player) => (
    player.id !== request.playerId && player.status === 'active'
  ));
  const actions = request.memory.filter((entry) => entry.kind === 'action');
  let best = { id: null as string | null, score: 0, current: false };

  for (const opponent of opponents) {
    const current = opponent.roundContribution > request.table.ante;
    const contributionLead = Math.max(
      0,
      opponent.roundContribution - request.self.roundContribution,
    );
    let score = Math.min(
      2,
      contributionLead / Math.max(request.table.ante, request.table.baseBet / 2),
    );

    actions.forEach((entry, index) => {
      if (entry.actorId !== opponent.id) return;
      const weight = 1 + index / Math.max(1, actions.length);
      if (entry.action === 'raise') {
        score += current ? CURRENT_RAISE_SCORE * weight : 0.5 * weight;
      } else if (entry.action === 'call') {
        score += 0.5 * weight;
      }
    });

    if (score > best.score) best = { id: opponent.id, score, current };
  }

  if (!best.id || !best.current) return { pressure: 'low', aggressorId: best.id };
  return {
    aggressorId: best.id,
    pressure: best.score >= HIGH_PRESSURE_SCORE
      ? 'high'
      : best.score >= MEDIUM_PRESSURE_SCORE
        ? 'medium'
        : 'low',
  };
}

function compactActions(
  request: AiDecisionRequest,
  candidates: readonly (AiActionIntent | null)[],
): AiActionIntent[] {
  const seen = new Set<string>();
  const result: AiActionIntent[] = [];
  for (const candidate of candidates) {
    if (!candidate || !isLegalIntent(candidate, request.legalActions)) continue;
    const key = JSON.stringify(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

function finishPolicy(
  request: AiDecisionRequest,
  candidates: readonly (AiActionIntent | null)[],
  preferred: AiActionIntent | null,
  pressure: Pressure,
  aggressorId: string | null,
  equity: number | null,
  strength: TacticalPromptContext['strength'],
): TacticalPolicy {
  let safeActions = compactActions(request, candidates);
  if (safeActions.length === 0) {
    safeActions = compactActions(request, [
      request.legalActions.callCost !== null ? { type: 'call' } : null,
      request.legalActions.canFold ? { type: 'fold' } : null,
      request.legalActions.canLook ? { type: 'look' } : null,
      request.legalActions.raiseAmounts[0] !== undefined
        ? { type: 'raise', amount: request.legalActions.raiseAmounts[0] }
        : null,
      request.legalActions.compareTargets[0] !== undefined
        ? { type: 'compare', targetId: request.legalActions.compareTargets[0] }
        : null,
    ]);
  }
  if (safeActions.length === 0) throw new Error('AI_HAS_NO_LEGAL_ACTION');
  const preferredKey = preferred ? JSON.stringify(preferred) : '';
  const preferredAction = safeActions.find((action) => JSON.stringify(action) === preferredKey)
    ?? safeActions[0];
  return { preferredAction, safeActions, pressure, aggressorId, equity, strength };
}

export function narrowLegalActions(
  original: AiLegalActions,
  safeActions: readonly AiActionIntent[],
): AiLegalActions {
  const raises = safeActions.flatMap((action) => action.type === 'raise' ? [action.amount] : []);
  const targets = safeActions.flatMap((action) => (
    action.type === 'compare' ? [action.targetId] : []
  ));
  return {
    canLook: original.canLook && safeActions.some((action) => action.type === 'look'),
    callCost: safeActions.some((action) => action.type === 'call') ? original.callCost : null,
    raiseAmounts: original.raiseAmounts.filter((amount) => raises.includes(amount)),
    compareCost: targets.length > 0 ? original.compareCost : null,
    compareTargets: original.compareTargets.filter((target) => targets.includes(target)),
    canFold: original.canFold && safeActions.some((action) => action.type === 'fold'),
  };
}

export function buildTacticalPolicy(
  request: AiDecisionRequest,
  random: () => number = Math.random,
): TacticalPolicy {
  const { pressure, aggressorId } = profilePressure(request);
  const legal = request.legalActions;
  const look: AiActionIntent | null = legal.canLook ? { type: 'look' } : null;
  const call: AiActionIntent | null = legal.callCost !== null ? { type: 'call' } : null;
  const raise: AiActionIntent | null = legal.raiseAmounts[0] !== undefined
    ? { type: 'raise', amount: legal.raiseAmounts[0] }
    : null;
  const targetId = aggressorId && legal.compareTargets.includes(aggressorId)
    ? aggressorId
    : legal.compareTargets[0];
  const compare: AiActionIntent | null = legal.compareCost !== null && targetId
    ? { type: 'compare', targetId }
    : null;
  const fold: AiActionIntent | null = legal.canFold ? { type: 'fold' } : null;

  if (!request.self.hasLooked || request.self.cards === null) {
    if (pressure !== 'low' && look) {
      return finishPolicy(request, [look], look, pressure, aggressorId, null, 'unknown');
    }
    const options = request.style === 'cautious'
      ? [call, look]
      : [raise, call, look];
    const safe = compactActions(request, options);
    const randomValue = Math.min(0.999_999, Math.max(0, random()));
    const preferred = request.style === 'cautious'
      ? call ?? look
      : request.style === 'bold'
        ? raise ?? call ?? look
        : safe[Math.min(safe.length - 1, Math.floor(randomValue * safe.length))] ?? call ?? look;
    return finishPolicy(request, safe, preferred, pressure, aggressorId, null, 'unknown');
  }

  const headsUp = estimateHandPercentile(request.self.cards);
  const opponentCount = request.table.players.filter((player) => (
    player.id !== request.playerId && player.status === 'active'
  )).length;
  const equity = headsUp ** Math.max(1, opponentCount);
  const callOdds = legal.callCost === null
    ? Number.POSITIVE_INFINITY
    : legal.callCost / Math.max(1, request.table.pot + legal.callCost);
  const strength: TacticalPromptContext['strength'] = headsUp >= STRONG_PERCENTILE
    ? 'strong'
    : headsUp >= COMPETITIVE_PERCENTILE
      ? 'competitive'
      : 'weak';
  const activePlayers = opponentCount + 1;

  if (request.table.actionCount >= activePlayers * 4 && compare) {
    return finishPolicy(request, [compare], compare, pressure, aggressorId, equity, strength);
  }
  if (headsUp >= STRONG_PERCENTILE) {
    const preferred = request.style === 'bold'
      ? raise ?? compare ?? call
      : compare ?? raise ?? call;
    return finishPolicy(
      request,
      [compare, raise, call],
      preferred,
      pressure,
      aggressorId,
      equity,
      strength,
    );
  }
  if (pressure !== 'low' && headsUp >= COMPETITIVE_PERCENTILE) {
    return finishPolicy(
      request,
      [compare, call],
      compare ?? call,
      pressure,
      aggressorId,
      equity,
      strength,
    );
  }
  if (call && equity >= callOdds + STYLE_SHIFT[request.style]) {
    const safe = headsUp >= VALUE_RAISE_PERCENTILE ? [raise, call] : [call];
    const preferred = request.style === 'bold' && raise ? raise : call;
    return finishPolicy(request, safe, preferred, pressure, aggressorId, equity, strength);
  }
  return finishPolicy(
    request,
    [fold],
    fold,
    pressure,
    aggressorId,
    equity,
    strength,
  );
}
