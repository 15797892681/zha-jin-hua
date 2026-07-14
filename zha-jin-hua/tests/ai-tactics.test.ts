import { describe, expect, it } from 'vitest';

import { buildAiDecisionRequest } from '../src/ai/context';
import type { AiDecisionRequest, AiStyle, PublicMemoryEntry } from '../src/ai/contracts';
import {
  buildTacticalPolicy,
  estimateHandPercentile,
  narrowLegalActions,
} from '../src/ai/tactics';
import { createGame } from '../src/shared/game';
import type { Card, Rank, Suit } from '../src/shared/types';

function cards(text: string): Card[] {
  return text.split(' ').map((token) => ({
    rank: token.slice(0, -1) as Rank,
    suit: token.at(-1) as Suit,
  }));
}

interface RequestOptions {
  hand: string | null;
  style?: AiStyle;
  memory?: PublicMemoryEntry[];
  baseBet?: number;
  humanContribution?: number;
  actionCount?: number;
}

function request(options: RequestOptions): AiDecisionRequest {
  const state = createGame({
    players: [
      { id: 'bot', name: '青竹' },
      { id: 'you', name: '你' },
      { id: 'other', name: '赤焰' },
    ],
    startingChips: 1000,
    ante: 10,
    deck: [
      ...cards(options.hand ?? '2S 7H 9D'),
      ...cards('AS KH 9D'),
      ...cards('3S 4H 6D'),
    ],
  });
  state.players[0].hasLooked = options.hand !== null;
  state.players[1].roundContribution = options.humanContribution ?? 10;
  state.baseBet = options.baseBet ?? 10;
  state.actionCount = options.actionCount ?? 0;
  return buildAiDecisionRequest(
    state,
    'bot',
    options.style ?? 'cautious',
    options.memory ?? [],
    'req-tactics',
  );
}

describe('expert AI tactics', () => {
  it('orders representative hands by rules percentile', () => {
    const values = [
      estimateHandPercentile(cards('2S 7H 9D')),
      estimateHandPercentile(cards('AS KH 9D')),
      estimateHandPercentile(cards('8S 8H KD')),
      estimateHandPercentile(cards('9S 10S JS')),
      estimateHandPercentile(cards('AS AH AD')),
    ];

    expect(values.every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(values).toEqual([...values].sort((left, right) => left - right));
  });

  it('looks before answering current-round pressure', () => {
    const value = request({
      hand: null,
      baseBet: 20,
      humanContribution: 30,
      memory: [{ kind: 'action', actorId: 'you', action: 'raise', amount: 20 }],
    });

    const policy = buildTacticalPolicy(value, () => 0);

    expect(policy.pressure).not.toBe('low');
    expect(policy.aggressorId).toBe('you');
    expect(policy.preferredAction).toEqual({ type: 'look' });
    expect(policy.safeActions).toEqual([{ type: 'look' }]);
  });

  it('lets a bold player defend blind pressure with a counter-raise', () => {
    const value = request({
      hand: null,
      style: 'bold',
      baseBet: 20,
      humanContribution: 30,
      memory: [{ kind: 'action', actorId: 'you', action: 'raise', amount: 20 }],
    });

    const policy = buildTacticalPolicy(value, () => 0);
    const narrowed = narrowLegalActions(value.legalActions, policy.safeActions);

    expect(policy.preferredAction).toEqual({ type: 'raise', amount: 50 });
    expect(policy.safeActions).not.toContainEqual({ type: 'look' });
    expect(policy.safeActions).not.toContainEqual({ type: 'fold' });
    expect(narrowed.canLook).toBe(false);
    expect(narrowed.raiseAmounts).toEqual([50]);
  });

  it('lets a chaotic player vary blind defense between raising and calling', () => {
    const value = request({
      hand: null,
      style: 'chaotic',
      baseBet: 20,
      humanContribution: 30,
      memory: [{ kind: 'action', actorId: 'you', action: 'raise', amount: 20 }],
    });

    const raisePolicy = buildTacticalPolicy(value, () => 0);
    const callPolicy = buildTacticalPolicy(value, () => 0.999);

    expect(raisePolicy.preferredAction).toEqual({ type: 'raise', amount: 50 });
    expect(callPolicy.preferredAction).toEqual({ type: 'call' });
    expect(raisePolicy.safeActions).toEqual([
      { type: 'raise', amount: 50 },
      { type: 'call' },
    ]);
  });

  it('calls instead of looking when a bold blind defender reaches the raise ceiling', () => {
    const value = request({
      hand: null,
      style: 'bold',
      baseBet: 200,
      humanContribution: 380,
      memory: [{ kind: 'action', actorId: 'you', action: 'raise', amount: 200 }],
    });

    const policy = buildTacticalPolicy(value, () => 0);

    expect(policy.preferredAction).toEqual({ type: 'call' });
    expect(policy.safeActions).toEqual([{ type: 'call' }]);
  });

  it('does not treat an old-round raise as current pressure', () => {
    const value = request({
      hand: null,
      memory: [{ kind: 'action', actorId: 'you', action: 'raise', amount: 200 }],
    });

    expect(buildTacticalPolicy(value, () => 0).pressure).toBe('low');
  });

  it('removes fold and compares with the aggressor using a competitive viewed hand', () => {
    const value = request({
      hand: '8S 8H KD',
      baseBet: 50,
      humanContribution: 80,
      memory: [{ kind: 'action', actorId: 'you', action: 'raise', amount: 50 }],
    });

    const policy = buildTacticalPolicy(value, () => 0);
    const narrowed = narrowLegalActions(value.legalActions, policy.safeActions);

    expect(policy.safeActions).not.toContainEqual({ type: 'fold' });
    expect(policy.preferredAction).toEqual({ type: 'compare', targetId: 'you' });
    expect(narrowed.canFold).toBe(false);
    expect(narrowed.compareTargets).toEqual(['you']);
  });

  it('compares with the aggressor when pressure reaches the raise ceiling', () => {
    const value = request({
      hand: '8S 8H KD',
      baseBet: 200,
      humanContribution: 380,
      memory: [{ kind: 'action', actorId: 'you', action: 'raise', amount: 200 }],
    });

    expect(buildTacticalPolicy(value, () => 0).preferredAction).toEqual({
      type: 'compare',
      targetId: 'you',
    });
  });

  it('still folds a weak viewed hand when the price is bad', () => {
    const value = request({ hand: '2S 7H 9D', baseBet: 200 });

    expect(buildTacticalPolicy(value, () => 0).preferredAction).toEqual({ type: 'fold' });
  });

  it.each(['cautious', 'bold', 'chaotic'] satisfies AiStyle[])(
    '%s personality never escapes the tactical safe set',
    (style) => {
      const value = request({ hand: '8S 8H KD', style });
      const policy = buildTacticalPolicy(value, () => 0.99);

      expect(policy.safeActions).toContainEqual(policy.preferredAction);
      const narrowed = narrowLegalActions(value.legalActions, policy.safeActions);
      expect(narrowed.canLook).toBe(false);
    },
  );
});
