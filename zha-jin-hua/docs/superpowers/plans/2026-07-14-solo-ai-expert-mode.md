# Solo AI Expert Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the three solo opponents consistently punish mechanical blind raising by sharing one aggression-aware tactical policy across DeepSeek and local fallback decisions.

**Architecture:** Add a pure `src/ai/tactics.ts` layer that converts the existing redacted `AiDecisionRequest` into ranked and safe action intents using hand-strength percentile, pot odds, opponent count, current-round contribution, recent public actions, and bounded personality shifts. The browser fallback executes the preferred action; the server narrows the action set before DeepSeek sees it, so both paths have the same strategic floor while `applyAction` remains the final authority.

**Tech Stack:** TypeScript 5.9, Vitest 3, Express 5, Zod 4, React 19, Playwright 1.59, existing DeepSeek JSON gateway.

## Global Constraints

- Do not change card ranking, betting levels, compare settlement, chip accounting, or online-room behavior.
- An unviewed AI hand remains `null`; tactics must not inspect `GameState.cards` before the AI has looked.
- Never send opponent cards, deck order, tactical logs containing cards, or new secrets to the server or DeepSeek.
- `safeActions` must be a non-empty subset of the original legal actions.
- Personality may reorder safe actions or shift a threshold by at most `0.04`; it may not reintroduce a tactically rejected action.
- A recent raiser is current-round pressure only when that player has contributed more than the ante in the current round.
- The 10,000-seed blind-raise regression must use production-equivalent public memory and finish with a human win rate at or below `0.20`.
- Follow red-green-refactor for every production change and preserve unrelated untracked files.

---

## File Structure

### Create

- `src/ai/tactics.ts` — hand percentile table, opponent pressure profile, safe action construction, preferred action ranking, and legal-action narrowing.
- `tests/ai-tactics.test.ts` — focused tactical-policy unit tests.

### Modify

- `src/ai/strategy.ts` — replace duplicated thresholds with a compatibility wrapper over the shared tactical policy.
- `src/server/ai/deepseek.ts` — accept tactical prompt context and explain that legal actions are already strategically filtered.
- `src/server/ai/route.ts` — build policy, narrow legal actions, and pass tactical context to the gateway.
- `src/client/game/aiDecisionService.ts` — keep remote handling but use the shared preferred action on every fallback.
- `tests/ai.test.ts` — assert the public `chooseAiAction` wrapper preserves legality and expert counterplay.
- `tests/deepseek.test.ts` — assert tactical prompt context and narrowed actions reach DeepSeek.
- `tests/ai-route.test.ts` — assert the live server path removes strategically unsafe actions.
- `tests/ai-decision-service.test.ts` — assert provider failure uses the same expert policy.
- `tests/ai-balance.test.ts` — production-equivalent memory and 10,000-seed balance gate.

---

### Task 1: Shared Tactical Policy

**Files:**
- Create: `src/ai/tactics.ts`
- Create: `tests/ai-tactics.test.ts`

**Interfaces:**
- Consumes: `AiDecisionRequest`, `AiActionIntent`, `AiLegalActions`, `AiStyle`, `Card`, `RANKS`, `SUITS`, and `evaluateHand`.
- Produces: `TacticalPolicy`, `TacticalPromptContext`, `estimateHandPercentile(cards)`, `buildTacticalPolicy(request, random?)`, and `narrowLegalActions(original, safeActions)`.

- [ ] **Step 1: Write failing percentile and pressure tests**

Create `tests/ai-tactics.test.ts` with card helpers and a request fixture built through `buildAiDecisionRequest`. Add these assertions before creating the production module:

```ts
import { describe, expect, it } from 'vitest';

import type { PublicMemoryEntry } from '../src/ai/contracts';
import { buildAiDecisionRequest } from '../src/ai/context';
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

function request(hand: string | null, memory: PublicMemoryEntry[] = []) {
  const state = createGame({
    players: [
      { id: 'bot', name: '青竹' },
      { id: 'you', name: '你' },
      { id: 'other', name: '赤焰' },
    ],
    startingChips: 1000,
    ante: 10,
    deck: [
      ...cards(hand ?? '2S 7H 9D'),
      ...cards('AS KH 9D'),
      ...cards('3S 4H 6D'),
    ],
  });
  state.players[0].hasLooked = hand !== null;
  return buildAiDecisionRequest(state, 'bot', 'cautious', memory, 'req-tactics');
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

  it('looks before answering current-round repeated pressure', () => {
    const value = request(null, [
      { kind: 'action', actorId: 'you', action: 'raise', amount: 20 },
    ]);
    value.table.players.find((player) => player.id === 'you')!.roundContribution = 30;
    const policy = buildTacticalPolicy(value, () => 0);
    expect(policy.pressure).not.toBe('low');
    expect(policy.aggressorId).toBe('you');
    expect(policy.preferredAction).toEqual({ type: 'look' });
    expect(policy.safeActions).toEqual([{ type: 'look' }]);
  });

  it('does not treat an old-round raise as current high pressure', () => {
    const value = request(null, [
      { kind: 'action', actorId: 'you', action: 'raise', amount: 200 },
    ]);
    expect(buildTacticalPolicy(value, () => 0).pressure).toBe('low');
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- tests/ai-tactics.test.ts
```

Expected: FAIL because `src/ai/tactics.ts` does not exist.

- [ ] **Step 3: Implement deterministic hand percentile support**

Create `src/ai/tactics.ts` with these types and score helpers:

```ts
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
const COMPETITIVE_PERCENTILE = 0.50;
const STRONG_PERCENTILE = 0.72;
const VALUE_RAISE_PERCENTILE = 0.78;

function handScore(value: HandValue): number {
  const [first = 0, second = 0, third = 0] = value.tieBreakers;
  return value.categoryScore * 15 ** 3 + first * 15 ** 2 + second * 15 + third;
}

let handDistribution: number[] | undefined;

function distribution(): number[] {
  if (handDistribution) return handDistribution;
  const deck = RANKS.flatMap((rank) => SUITS.map((suit) => ({ rank, suit })));
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
```

- [ ] **Step 4: Implement pressure profiling and legal-action narrowing**

In the same module, add this pressure profiler. It scores raises as current pressure only when the actor has contributed more than the ante, while an old-round raise contributes only a small style signal:

```ts
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
```

Add the legality and result helpers used by every policy branch:

```ts
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
```

Add exact safe-set conversion:

```ts
export function narrowLegalActions(
  original: AiLegalActions,
  safeActions: readonly AiActionIntent[],
): AiLegalActions {
  const raises = safeActions.flatMap((action) => action.type === 'raise' ? [action.amount] : []);
  const targets = safeActions.flatMap((action) => action.type === 'compare' ? [action.targetId] : []);
  return {
    canLook: original.canLook && safeActions.some((action) => action.type === 'look'),
    callCost: safeActions.some((action) => action.type === 'call') ? original.callCost : null,
    raiseAmounts: original.raiseAmounts.filter((amount) => raises.includes(amount)),
    compareCost: targets.length > 0 ? original.compareCost : null,
    compareTargets: original.compareTargets.filter((target) => targets.includes(target)),
    canFold: original.canFold && safeActions.some((action) => action.type === 'fold'),
  };
}
```

- [ ] **Step 5: Implement the expert decision bands**

Use these exact bands in `buildTacticalPolicy`:

```ts
// Blind:
// - medium/high current pressure + canLook => only look
// - otherwise cautious prefers call, bold prefers first raise, chaotic chooses call/raise by random
// - never fold blind while call or look is legal
//
// Viewed:
// - heads-up percentile >= 0.72 => strong
// - heads-up percentile >= 0.50 => competitive
// - against medium/high pressure, competitive hands include compare(aggressor) and call,
//   prefer compare; fold is excluded
// - strong hands include compare(aggressor), the next legal raise, and call;
//   bold prefers raise, other styles prefer compare
// - outside pressure, call when multiwayEquity >= callOdds + STYLE_SHIFT[style]
// - allow a raise outside pressure only when heads-up percentile >= 0.78
// - otherwise fold
// - after actionCount >= activePlayers * 4, prefer compare against aggressor or first target
```

Implement the branch ordering with this core. `compactActions` removes `null`, checks `isLegalIntent`, and deduplicates intents by their JSON representation. `finishPolicy` uses the first legal call, then fold, as its empty-set fallback:

```ts
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
    const preferred = request.style === 'cautious'
      ? call ?? look
      : request.style === 'bold'
        ? raise ?? call ?? look
        : safe[Math.min(safe.length - 1, Math.floor(random() * safe.length))];
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
  const strength = headsUp >= STRONG_PERCENTILE
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
```

Every branch therefore passes its intents through original legality, deduplicates them, and uses the existing conservative fallback (`call`, then `fold`) if no intent survives.

- [ ] **Step 6: Add counterplay, weak-hand, and narrowing tests**

Extend `tests/ai-tactics.test.ts`:

```ts
it('removes fold and compares with the aggressor using a competitive viewed hand', () => {
  const value = request('8S 8H KD', [
    { kind: 'action', actorId: 'you', action: 'raise', amount: 50 },
  ]);
  value.table.players.find((player) => player.id === 'you')!.roundContribution = 80;
  const policy = buildTacticalPolicy(value, () => 0);
  expect(policy.safeActions).not.toContainEqual({ type: 'fold' });
  expect(policy.preferredAction).toEqual({ type: 'compare', targetId: 'you' });
  expect(narrowLegalActions(value.legalActions, policy.safeActions).canFold).toBe(false);
});

it('still folds a weak viewed hand when the price is bad', () => {
  const value = request('2S 7H 9D');
  value.table.baseBet = 200;
  value.legalActions.callCost = 400;
  value.legalActions.raiseAmounts = [];
  expect(buildTacticalPolicy(value, () => 0).preferredAction).toEqual({ type: 'fold' });
});

it.each(['cautious', 'bold', 'chaotic'] as const)(
  '%s personality never escapes the tactical safe set',
  (style) => {
    const value = { ...request('8S 8H KD'), style };
    const policy = buildTacticalPolicy(value, () => 0.99);
    expect(policy.safeActions).toContainEqual(policy.preferredAction);
  },
);
```

- [ ] **Step 7: Verify GREEN and commit the shared policy**

Run:

```bash
npm test -- tests/ai-tactics.test.ts
npm run typecheck
```

Expected: all focused tests PASS and TypeScript exits `0`.

Commit:

```bash
git add src/ai/tactics.ts tests/ai-tactics.test.ts
git commit -m "feat: add expert solo AI tactics"
```

---

### Task 2: Make Local Fallback Consume the Shared Policy

**Files:**
- Modify: `src/ai/strategy.ts`
- Modify: `tests/ai.test.ts`
- Modify: `tests/ai-decision-service.test.ts`

**Interfaces:**
- Consumes: `buildAiDecisionRequest`, `buildTacticalPolicy`, and `intentToGameAction`.
- Preserves: `chooseAiAction(state, playerId, style, random, memory): GameAction`.

- [ ] **Step 1: Write failing wrapper and client fallback tests**

Add an `ai.test.ts` fixture where the viewed bot has a pair, `you` recently raised, and `you.roundContribution > ante`. Assert all styles choose `compare` against `you`. In `ai-decision-service.test.ts`, return HTTP 503 for the same state and assert the fallback action is the same `compare`.

```ts
expect(chooseAiAction(pressuredPair, 'bot', 'cautious', () => 0, memory)).toMatchObject({
  type: 'compare', targetId: 'you',
});

await expect(service.decide(
  pressuredPair,
  'bot',
  'cautious',
  memory,
  new AbortController().signal,
)).resolves.toMatchObject({
  source: 'rule',
  action: { type: 'compare', targetId: 'you' },
});
```

- [ ] **Step 2: Run and verify RED**

Run:

```bash
npm test -- tests/ai.test.ts tests/ai-decision-service.test.ts
```

Expected: the new expectations FAIL because the current strategy uses its old thresholds.

- [ ] **Step 3: Replace duplicated strategy logic with the compatibility wrapper**

Reduce `src/ai/strategy.ts` to validation plus shared-policy conversion:

```ts
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
```

Do not add a second policy implementation to `aiDecisionService`; its existing fallback call to `chooseAiAction` must remain the only local fallback path.

- [ ] **Step 4: Verify GREEN and existing AI legality**

Run:

```bash
npm test -- tests/ai-tactics.test.ts tests/ai.test.ts tests/ai-decision-service.test.ts
npm run typecheck
```

Expected: all tests PASS.

- [ ] **Step 5: Commit the fallback integration**

```bash
git add src/ai/strategy.ts tests/ai.test.ts tests/ai-decision-service.test.ts
git commit -m "fix: make fallback AI counter repeated raises"
```

---

### Task 3: Enforce the Tactical Floor on the DeepSeek Path

**Files:**
- Modify: `src/server/ai/deepseek.ts`
- Modify: `src/server/ai/route.ts`
- Modify: `tests/deepseek.test.ts`
- Modify: `tests/ai-route.test.ts`

**Interfaces:**
- Extends: `DeepSeekGateway.decide(request, signal, tactics?)`.
- Consumes: `buildTacticalPolicy` and `narrowLegalActions`.
- Preserves: response schema and client/server endpoint.

- [ ] **Step 1: Write failing route test for action-set narrowing**

Create a viewed-pair request with a recent human raise and current human contribution. Capture the request and tactical context received by the fake gateway:

```ts
it('removes tactical folds before invoking DeepSeek', async () => {
  const decide = vi.fn<DeepSeekGateway['decide']>((request, _signal, tactics) => {
    expect(request.legalActions.canFold).toBe(false);
    expect(request.legalActions.compareTargets).toEqual(['you']);
    expect(tactics).toMatchObject({ aggressorId: 'you', pressure: 'medium' });
    return Promise.resolve({
      decision: { action: { type: 'compare', targetId: 'you' }, dialogue: '你加得勤，我来验牌。' },
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
  });
  const { url } = await start({ decide });
  const response = await post(url, pressuredPairBody());
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    action: { type: 'compare', targetId: 'you' },
  });
});
```

- [ ] **Step 2: Write failing prompt test**

In `tests/deepseek.test.ts`, call the gateway with `{ pressure: 'high', aggressorId: 'you', strength: 'competitive' }`, inspect the captured request body, and assert the system prompt contains all three facts plus the sentence `legalActions 已由战术引擎筛选`.

- [ ] **Step 3: Run and verify RED**

Run:

```bash
npm test -- tests/deepseek.test.ts tests/ai-route.test.ts
```

Expected: route and gateway expectations FAIL because tactics are not yet passed or enforced.

- [ ] **Step 4: Extend the gateway contract and prompt**

Change the interface and prompt construction:

```ts
import type { TacticalPromptContext } from '../../ai/tactics';

export interface DeepSeekGateway {
  decide(
    request: AiDecisionRequest,
    signal: AbortSignal,
    tactics?: TacticalPromptContext,
  ): Promise<DeepSeekResult>;
}
```

Append to `systemPrompt` when tactics are present:

```ts
`legalActions 已由战术引擎筛选，只能从中选择，不得自行恢复其他动作。`,
`当前压力：${tactics.pressure}。主要施压者：${tactics.aggressorId ?? '无'}。`,
`自己的策略牌力分层：${tactics.strength}。`,
```

Keep cards and the complete user request in the JSON user message exactly as before; do not add logging.

- [ ] **Step 5: Narrow the request in the route before calling DeepSeek**

After parsing and before `gateway.decide`, build policy and a new request object:

```ts
const policy = buildTacticalPolicy(decisionRequest);
const tacticalRequest: AiDecisionRequest = {
  ...decisionRequest,
  legalActions: narrowLegalActions(decisionRequest.legalActions, policy.safeActions),
};
const tactics = {
  pressure: policy.pressure,
  aggressorId: policy.aggressorId,
  strength: policy.strength,
};
result = await gateway.decide(tacticalRequest, signal, tactics);
```

Continue reconstructing the trusted `GameAction` with the original `decisionRequest` so request identity is unchanged. The gateway's existing `isLegalIntent` check now validates against the narrowed request.

- [ ] **Step 6: Verify GREEN and route regressions**

Run:

```bash
npm test -- tests/deepseek.test.ts tests/ai-route.test.ts tests/ai-decision-service.test.ts
npm run typecheck
```

Expected: all tests PASS; rate limiting, timeout, breaker, logging, and stale-response tests remain green.

- [ ] **Step 7: Commit the DeepSeek guardrail**

```bash
git add src/server/ai/deepseek.ts src/server/ai/route.ts tests/deepseek.test.ts tests/ai-route.test.ts
git commit -m "fix: enforce expert tactics on DeepSeek actions"
```

---

### Task 4: Production-Equivalent Balance Gate

**Files:**
- Modify: `tests/ai-balance.test.ts`
- Modify only if the RED test proves necessary: `src/ai/tactics.ts`

**Interfaces:**
- Consumes: `appendPublicMemory`, `actionToMemory`, `chooseAiAction`, `applyAction`, and `legalActions`.
- Produces: deterministic 10,000-game expert-mode regression.

- [ ] **Step 1: Rewrite the simulation to mirror public memory**

Track memory inside each simulated game. After a human action append only the action entry. After an AI action append both the action and a deterministic public dialogue, matching `useSoloGame` ordering:

```ts
let memory: PublicMemoryEntry[] = [];

function remember(action: GameAction, isAi: boolean): void {
  memory = appendPublicMemory(memory, actionToMemory(action));
  if (isAi) {
    memory = appendPublicMemory(memory, {
      kind: 'dialogue',
      actorId: action.playerId,
      text: '继续。',
    });
  }
}
```

Pass `memory` into every `chooseAiAction` call. Preserve the human policy: choose the sole next raise, then compare the first target at the ceiling, then call, then fold.

- [ ] **Step 2: Raise the deterministic sample and tighten the assertion**

Use exactly 10,000 seeds and expose the failure ratio:

```ts
it('keeps mechanical blind raising below the expert-mode win ceiling', () => {
  const games = 10_000;
  let wins = 0;
  for (let seed = 1; seed <= games; seed += 1) {
    if (playBlindRaiseGame(seed)) wins += 1;
  }
  const winRate = wins / games;
  expect(winRate, `blind-raise win rate: ${winRate}`).toBeLessThanOrEqual(0.20);
});
```

- [ ] **Step 3: Run the balance test and verify the new gate**

Run:

```bash
npm test -- tests/ai-balance.test.ts
```

Expected: the rewritten production-equivalent simulation completes within the normal Vitest timeout, all games terminate, and the win rate is `<= 0.20`. If it fails above `0.20`, stop this task, record the exact rate and action distribution, and return to root-cause analysis before changing a single named constant; do not weaken the gate or stack speculative threshold changes.

- [ ] **Step 4: Run all tactical and AI tests**

Run:

```bash
npm test -- tests/ai-tactics.test.ts tests/ai.test.ts tests/ai-decision-service.test.ts tests/deepseek.test.ts tests/ai-route.test.ts tests/ai-balance.test.ts
```

Expected: all focused tests PASS.

- [ ] **Step 5: Commit the balance regression**

```bash
git add tests/ai-balance.test.ts src/ai/tactics.ts
git commit -m "test: lock expert AI balance against blind raises"
```

---

### Task 5: Full Verification and Production Delivery

**Files:**
- No planned production-file changes.
- Update the current task journal only if the existing project workflow requires it; do not stage unrelated Trellis bootstrap files.

**Interfaces:**
- Verifies the complete repository and production deployment.

- [ ] **Step 1: Run the full local verification suite**

Run in order:

```bash
npm test
npm run typecheck
npm run build
npm run test:e2e
git diff --check
npm audit --audit-level=high
```

Expected: unit tests, typecheck, build, and all Playwright tests PASS; `git diff --check` is empty; audit reports no high-severity vulnerability.

- [ ] **Step 2: Review the final diff and repository scope**

Run:

```bash
git status --short
git diff --stat HEAD~4..HEAD
git diff HEAD~4..HEAD -- src/ai src/server/ai src/client/game tests
```

Confirm no `.env`, `.codegraph`, `.cursor`, `.agents`, unrelated `.trellis` bootstrap file, credential, or generated build artifact is staged.

- [ ] **Step 3: Push the completed branch to the deployment branch**

After the user confirms the final commit plan, push the current HEAD to GitHub `main`:

```bash
git push github HEAD:main
```

Expected: remote `main` advances to the expert-mode commit.

- [ ] **Step 4: Trigger and verify Render deployment**

Use the configured Render CLI service `srv-d9ab1s9o3t8c738jeaeg`:

```bash
render deploys create srv-d9ab1s9o3t8c738jeaeg --confirm
render deploys list srv-d9ab1s9o3t8c738jeaeg --output text
curl -fsSL -o /dev/null -w '%{http_code}\n' https://zha-jin-hua.onrender.com/healthz
```

Expected: the new deploy is `Live`, its commit equals local `HEAD`, and health returns `200`.

- [ ] **Step 5: Run production smoke checks**

Use Playwright against `https://zha-jin-hua.onrender.com/` with a 390×844 viewport. Start solo mode, perform sequential raises, and assert at least one pressured AI looks and later responds with call, raise, or compare instead of all three folding. Also recheck that revealed human cards remain non-overlapping and that the raise dialog exposes only the next level.

- [ ] **Step 6: Record delivery evidence**

Report the final commit, Render deploy ID, health result, production asset hashes, 10,000-game blind-raise win rate, and full test counts. Preserve the previous live commit as the rollback target.
