# DeepSeek Solo AI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three solo-mode rule bots with DeepSeek-backed decisions and personality dialogue while preserving the current rule AI as a three-second fallback.

**Architecture:** The browser builds a redacted solo-game snapshot and calls a same-origin Express endpoint. The server owns the DeepSeek credential, JSON-mode prompt, validation, rate limiting, and circuit breaker; the browser owns stale-turn rejection, the rule fallback, short-term public memory, and the final `applyAction` call. Online rooms and their Socket.IO protocol remain unchanged.

**Tech Stack:** TypeScript 5.9, React 19, Express 5, Zod 4, Vitest 3, Playwright 1.59, native `fetch`, DeepSeek Chat Completions API.

## Global Constraints

- Provider is fixed to DeepSeek and the default model is exactly `deepseek-v4-flash`.
- Send `thinking: { "type": "disabled" }` and `response_format: { "type": "json_object" }` on every model request.
- Model output contains only one legal action intent plus Chinese dialogue of at most 40 characters.
- Never send another player's cards, the remaining deck, or an unviewed bot hand to the server or DeepSeek.
- `DEEPSEEK_API_KEY` is server-only and must never appear in source, fixtures, browser bundles, responses, or logs.
- Remote decision time is capped at 3000 ms with no retry; timeout or invalid output uses the existing `chooseAiAction` implementation.
- Retain only the latest 8 public action/dialogue entries in memory; preserve them across rounds and clear them on match reset or page reload.
- Keep online mode behavior and Socket.IO contracts unchanged.
- The existing game engine and `applyAction` remain the only authorities for chips, turns, legality, and results.
- Run tests before every task commit; do not stage `.codegraph/`, `.cursor/`, real `.env` files, or credentials.

---

## File Structure

### Create

- `src/ai/contracts.ts` — shared Zod schemas, request/response types, legal-intent checks, and trusted action reconstruction.
- `src/ai/context.ts` — redacted request construction and eight-entry public-memory helpers.
- `src/server/ai/deepseek.ts` — DeepSeek prompt and Chat Completions adapter.
- `src/server/ai/runtime.ts` — environment parsing, fixed-window limiting, and circuit breaker.
- `src/server/ai/route.ts` — `/api/ai/decision` Express router and sanitized operational logging.
- `src/client/game/aiDecisionService.ts` — same-origin remote provider, three-second timeout, and local rule fallback.
- `tests/ai-context.test.ts` — redaction, memory, schema, and legal-action tests.
- `tests/deepseek.test.ts` — model request and output-validation tests using a fake fetch implementation.
- `tests/ai-runtime.test.ts` — rate-limiter and circuit-breaker tests.
- `tests/ai-route.test.ts` — HTTP success, error, timeout, configuration, and limit tests.
- `tests/ai-decision-service.test.ts` — remote decision, timeout, invalid-response, and cancellation tests.
- `tests/solo-game-ai.test.ts` — hook-level single-flight, memory, fallback, and stale-reset tests.
- `e2e/solo-ai.spec.ts` — browser-level thinking, dialogue, fallback, stale-reset, and mobile-overflow coverage.
- `.env.example` — non-secret server configuration template.

### Modify

- `src/ai/strategy.ts` — import and re-export the shared `AiStyle` type.
- `src/server/index.ts` — mount JSON parsing and the AI router before static/SPA handlers; allow router injection in tests.
- `src/client/game/useSoloGame.ts` — async AI turns, public memory, stale-response protection, dialogue, and degradation notice.
- `src/client/App.tsx` — inject the optional decision service and pass AI presentation state to the table.
- `src/client/components/GameTable.tsx` — pass thinking/dialogue state to seats and render one degradation notice.
- `src/client/components/PlayerSeat.tsx` — render the thinking label and accessible dialogue bubble.
- `src/client/styles.css` — responsive dialogue and notice styling.
- `vite.config.ts` — proxy `/api` to the local Express server.
- `package.json` — load an optional server-side `.env` in the Node 22 development process.
- `.gitignore` — ignore `.env` variants while retaining `.env.example`.
- `README.md` — document local and Render AI configuration, fallback behavior, and key-rotation guidance.
- `tests/solo-ui.test.tsx` — focused UI behavior with an injected fake decision service.
- `tests/production-server.test.ts` — assert the production server exposes the AI endpoint before SPA fallback.
- `e2e/responsive.spec.ts` — include an active AI dialogue in the mobile overflow assertion.

---

### Task 1: Shared AI Contract, Redaction, and Public Memory

**Files:**
- Create: `src/ai/contracts.ts`
- Create: `src/ai/context.ts`
- Create: `tests/ai-context.test.ts`
- Modify: `src/ai/strategy.ts:1-5`

**Interfaces:**
- Consumes: `GameState`, `GameAction`, `LegalActions`, and `legalActions(state, playerId)` from the existing engine.
- Produces: `AiStyle`, `AiDecisionRequest`, `DeepSeekDecision`, `AiDecisionResponse`, `PublicMemoryEntry`, `buildAiDecisionRequest`, `appendPublicMemory`, `actionToMemory`, `isLegalIntent`, and `intentToGameAction`.

- [ ] **Step 1: Write failing redaction and contract tests**

Create `tests/ai-context.test.ts` with deterministic cards and these assertions:

```ts
import { describe, expect, it } from 'vitest';

import {
  aiDecisionResponseSchema,
  deepSeekDecisionSchema,
  intentToGameAction,
  isLegalIntent,
  type PublicMemoryEntry,
} from '../src/ai/contracts';
import { actionToMemory, appendPublicMemory, buildAiDecisionRequest } from '../src/ai/context';
import { createGame } from '../src/shared/game';
import type { Card, GameState, Rank, Suit } from '../src/shared/types';

function cards(text: string): Card[] {
  return text.split(' ').map((token) => ({
    rank: token.slice(0, -1) as Rank,
    suit: token.at(-1) as Suit,
  }));
}

function fixture(hasLooked = false): GameState {
  const state = createGame({
    players: [
      { id: 'bot', name: '青竹' },
      { id: 'human', name: '你' },
      { id: 'other', name: '赤焰' },
    ],
    startingChips: 1000,
    ante: 10,
    deck: [
      ...cards('AS AH AD'),
      ...cards('2S 7H 9D'),
      ...cards('KS KH 3D'),
      ...cards('4S 5H 6D'),
    ],
  });
  state.players[0].hasLooked = hasLooked;
  return state;
}

describe('AI request contract', () => {
  it('redacts the deck, every opponent hand, and an unviewed bot hand', () => {
    const request = buildAiDecisionRequest(fixture(false), 'bot', 'cautious', [], 'req-1');
    expect(request.self.cards).toBeNull();
    expect(request.table.players.every((player) => !('cards' in player))).toBe(true);
    expect('deck' in request.table).toBe(false);
    expect(JSON.stringify(request)).not.toContain('2S');
  });

  it('includes only the acting bot hand after look and preserves action costs', () => {
    const request = buildAiDecisionRequest(fixture(true), 'bot', 'cautious', [], 'req-2');
    expect(request.self.cards).toEqual(cards('AS AH AD'));
    expect(request.legalActions.callCost).toBe(20);
    expect(request.legalActions.compareCost).toBe(40);
  });

  it('keeps only the latest eight public entries', () => {
    const entries = Array.from({ length: 10 }, (_, index): PublicMemoryEntry => ({
      kind: 'dialogue', actorId: 'bot', text: `台词${index}`,
    }));
    expect(entries.reduce(appendPublicMemory, [])).toEqual(entries.slice(2));
  });

  it('converts an executed action into public memory without hidden data', () => {
    expect(actionToMemory({ type: 'raise', playerId: 'bot', amount: 20, turnId: 3 }))
      .toEqual({ kind: 'action', actorId: 'bot', action: 'raise', amount: 20 });
  });

  it('rejects extra model fields and dialogue longer than 40 characters', () => {
    expect(deepSeekDecisionSchema.safeParse({
      action: { type: 'fold', playerId: 'fake' }, dialogue: '收手。',
    }).success).toBe(false);
    expect(deepSeekDecisionSchema.safeParse({
      action: { type: 'fold' }, dialogue: '长'.repeat(41),
    }).success).toBe(false);
  });

  it('matches raise amounts and compare targets exactly', () => {
    const legal = buildAiDecisionRequest(fixture(true), 'bot', 'bold', [], 'req-3').legalActions;
    expect(isLegalIntent({ type: 'raise', amount: legal.raiseAmounts[0] }, legal)).toBe(true);
    expect(isLegalIntent({ type: 'raise', amount: 11 }, legal)).toBe(false);
    expect(isLegalIntent({ type: 'compare', targetId: 'human' }, legal)).toBe(true);
    expect(isLegalIntent({ type: 'compare', targetId: 'missing' }, legal)).toBe(false);
  });

  it('injects player and turn identity outside the model output', () => {
    const request = buildAiDecisionRequest(fixture(true), 'bot', 'bold', [], 'req-4');
    expect(intentToGameAction({ type: 'fold' }, request)).toEqual({
      type: 'fold', playerId: 'bot', turnId: 1,
    });
    expect(aiDecisionResponseSchema.parse({
      requestId: 'req-4', turnId: 1, playerId: 'bot',
      action: { type: 'fold', playerId: 'bot', turnId: 1 }, dialogue: '先让你一手。',
    }).playerId).toBe('bot');
  });
});
```

- [ ] **Step 2: Run the focused test and verify the new modules are missing**

Run:

```bash
npm test -- tests/ai-context.test.ts
```

Expected: FAIL with module resolution errors for `src/ai/contracts.ts` and `src/ai/context.ts`.

- [ ] **Step 3: Implement strict shared schemas and action reconstruction**

Create `src/ai/contracts.ts`. Use `.strict()` on every object, `z.discriminatedUnion` for actions, `z.string().max(40)` for dialogue, finite non-negative integer amounts, and these exact exports:

```ts
import { z } from 'zod';

import type { GameAction, LegalActions } from '../shared/types';

export const AI_STYLES = ['cautious', 'bold', 'chaotic'] as const;
export type AiStyle = (typeof AI_STYLES)[number];

const idSchema = z.string().min(1).max(64);
const amountSchema = z.number().int().nonnegative().finite();
const cardSchema = z.object({
  suit: z.enum(['S', 'H', 'D', 'C']),
  rank: z.enum(['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']),
}).strict();

export const publicMemoryEntrySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('action'), actorId: idSchema,
    action: z.enum(['look', 'call', 'raise', 'fold', 'compare']),
    amount: amountSchema.optional(), targetId: idSchema.optional(),
  }).strict(),
  z.object({
    kind: z.literal('dialogue'), actorId: idSchema, text: z.string().min(1).max(40),
  }).strict(),
]);
export type PublicMemoryEntry = z.infer<typeof publicMemoryEntrySchema>;

const legalActionsSchema = z.object({
  canLook: z.boolean(),
  callCost: amountSchema.nullable(),
  raiseAmounts: z.array(amountSchema).max(5),
  compareCost: amountSchema.nullable(),
  compareTargets: z.array(idSchema).max(5),
  canFold: z.boolean(),
}).strict();
export type AiLegalActions = z.infer<typeof legalActionsSchema>;

export const aiDecisionRequestSchema = z.object({
  requestId: idSchema,
  turnId: z.number().int().positive(),
  playerId: idSchema,
  style: z.enum(AI_STYLES),
  self: z.object({
    cards: z.array(cardSchema).length(3).nullable(),
    chips: amountSchema,
    hasLooked: z.boolean(),
    roundContribution: amountSchema,
  }).strict(),
  table: z.object({
    pot: amountSchema,
    ante: amountSchema,
    baseBet: amountSchema,
    actionCount: amountSchema,
    players: z.array(z.object({
      id: idSchema, name: z.string().min(1).max(32), chips: amountSchema,
      status: z.enum(['active', 'folded', 'out']), hasLooked: z.boolean(),
      roundContribution: amountSchema,
    }).strict()).min(2).max(6),
  }).strict(),
  legalActions: legalActionsSchema,
  memory: z.array(publicMemoryEntrySchema).max(8),
}).strict();
export type AiDecisionRequest = z.infer<typeof aiDecisionRequestSchema>;

export const aiActionIntentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('look') }).strict(),
  z.object({ type: z.literal('call') }).strict(),
  z.object({ type: z.literal('raise'), amount: amountSchema }).strict(),
  z.object({ type: z.literal('fold') }).strict(),
  z.object({ type: z.literal('compare'), targetId: idSchema }).strict(),
]);
export type AiActionIntent = z.infer<typeof aiActionIntentSchema>;

export const deepSeekDecisionSchema = z.object({
  action: aiActionIntentSchema,
  dialogue: z.string().min(1).max(40),
}).strict();
export type DeepSeekDecision = z.infer<typeof deepSeekDecisionSchema>;

const gameActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('look'), playerId: idSchema, turnId: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('call'), playerId: idSchema, turnId: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('raise'), playerId: idSchema, amount: amountSchema, turnId: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('fold'), playerId: idSchema, turnId: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('compare'), playerId: idSchema, targetId: idSchema, turnId: z.number().int().positive() }).strict(),
]);

export const aiDecisionResponseSchema = z.object({
  requestId: idSchema, turnId: z.number().int().positive(), playerId: idSchema,
  action: gameActionSchema, dialogue: z.string().min(1).max(40),
}).strict();
export type AiDecisionResponse = z.infer<typeof aiDecisionResponseSchema>;

export function isLegalIntent(intent: AiActionIntent, legal: AiLegalActions | LegalActions): boolean {
  switch (intent.type) {
    case 'look': return legal.canLook;
    case 'call': return legal.callCost !== null;
    case 'raise': return legal.raiseAmounts.includes(intent.amount);
    case 'fold': return legal.canFold;
    case 'compare': return legal.compareCost !== null && legal.compareTargets.includes(intent.targetId);
  }
}

export function intentToGameAction(intent: AiActionIntent, request: AiDecisionRequest): GameAction {
  return { ...intent, playerId: request.playerId, turnId: request.turnId } as GameAction;
}
```

- [ ] **Step 4: Implement redacted context and bounded memory**

Create `src/ai/context.ts`:

```ts
import { legalActions } from '../shared/game';
import type { GameAction, GameState } from '../shared/types';
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
  return {
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
  };
}
```

Change `src/ai/strategy.ts` to import and re-export the shared type:

```ts
import type { AiStyle } from './contracts';
export type { AiStyle } from './contracts';
```

Remove the old local `export type AiStyle = ...` declaration and leave `chooseAiAction` behavior unchanged.

- [ ] **Step 5: Run focused and existing AI tests**

Run:

```bash
npm test -- tests/ai-context.test.ts tests/ai.test.ts
npm run typecheck
```

Expected: both test files PASS and TypeScript exits with code 0.

- [ ] **Step 6: Commit the shared contract slice**

```bash
git add src/ai/contracts.ts src/ai/context.ts src/ai/strategy.ts tests/ai-context.test.ts
git commit -m "feat: define safe AI decision contract"
```

---

### Task 2: DeepSeek JSON Gateway

**Files:**
- Create: `src/server/ai/deepseek.ts`
- Create: `tests/deepseek.test.ts`

**Interfaces:**
- Consumes: `AiDecisionRequest`, `DeepSeekDecision`, `deepSeekDecisionSchema`, and `isLegalIntent` from Task 1.
- Produces: `DeepSeekGateway`, `DeepSeekResult`, `DeepSeekGatewayConfig`, and `createDeepSeekGateway(config, fetchImpl)`.

- [ ] **Step 1: Write failing gateway tests with captured fetch input**

Create `tests/deepseek.test.ts` with a valid request from Task 1 and assertions that the adapter sends the configured model, disabled thinking, JSON mode, no hidden fields, and rejects bad output:

```ts
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { buildAiDecisionRequest } from '../src/ai/context';
import { createDeepSeekGateway } from '../src/server/ai/deepseek';
import { createGame } from '../src/shared/game';

function request() {
  const state = createGame({
    players: [{ id: 'bot', name: '青竹' }, { id: 'you', name: '你' }],
    startingChips: 1000, ante: 10, random: () => 0,
  });
  return buildAiDecisionRequest(state, 'bot', 'cautious', [], 'req-deepseek');
}

describe('DeepSeek gateway', () => {
  it('uses V4 Flash with thinking disabled and JSON mode', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"action":{"type":"fold"},"dialogue":"先收一手。"}' } }],
      usage: { prompt_tokens: 90, completion_tokens: 18, total_tokens: 108 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const gateway = createDeepSeekGateway({
      apiKey: 'test-key', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash',
    }, fetchImpl);

    await expect(gateway.decide(request(), new AbortController().signal)).resolves.toEqual({
      decision: { action: { type: 'fold' }, dialogue: '先收一手。' },
      usage: { promptTokens: 90, completionTokens: 18, totalTokens: 108 },
    });
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: 'deepseek-v4-flash', max_tokens: 160,
      thinking: { type: 'disabled' }, response_format: { type: 'json_object' },
    });
    expect(init.headers).toMatchObject({ Authorization: 'Bearer test-key' });
    expect(String(init.body)).not.toContain('deck');
  });

  it.each([
    '',
    'not-json',
    '{"action":{"type":"raise","amount":11},"dialogue":"加一点。"}',
    '{"action":{"type":"fold"},"dialogue":"超长'.concat('长'.repeat(41), '"}'),
  ])('rejects empty, malformed, illegal, or oversized output', async (content) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content } }],
    }), { status: 200 }));
    const gateway = createDeepSeekGateway({
      apiKey: 'test-key', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash',
    }, fetchImpl);
    await expect(gateway.decide(request(), new AbortController().signal)).rejects.toThrow();
  });

  it('maps non-success provider responses to a sanitized error', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('account detail', { status: 401 }));
    const gateway = createDeepSeekGateway({
      apiKey: 'test-key', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash',
    }, fetchImpl);
    await expect(gateway.decide(request(), new AbortController().signal))
      .rejects.toThrow('DEEPSEEK_HTTP_401');
  });
});
```

- [ ] **Step 2: Run the gateway test and verify it fails**

Run `npm test -- tests/deepseek.test.ts`.

Expected: FAIL because `src/server/ai/deepseek.ts` does not exist.

- [ ] **Step 3: Implement the gateway, prompt, and response parsing**

Create `src/server/ai/deepseek.ts` with these concrete behaviors:

```ts
import { z } from 'zod';
import {
  deepSeekDecisionSchema, isLegalIntent,
  type AiDecisionRequest, type DeepSeekDecision,
} from '../../ai/contracts';

export interface DeepSeekGatewayConfig { apiKey: string; baseUrl: string; model: string }
export interface DeepSeekResult {
  decision: DeepSeekDecision;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}
export interface DeepSeekGateway {
  decide(request: AiDecisionRequest, signal: AbortSignal): Promise<DeepSeekResult>;
}

const completionSchema = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.string().nullable() }).passthrough(),
  }).passthrough()).min(1),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative().default(0),
    completion_tokens: z.number().int().nonnegative().default(0),
    total_tokens: z.number().int().nonnegative().default(0),
  }).optional(),
}).passthrough();

const PERSONA = {
  cautious: '你是青竹：冷静保守，重视筹码，少诈唬，台词克制。',
  bold: '你是赤焰：主动施压，偏好合理加注和比牌，台词自信但不辱骂。',
  chaotic: '你是飞星：活泼难测，可以诈唬，台词带调侃但不冒犯。',
} as const;

function systemPrompt(request: AiDecisionRequest): string {
  return [
    PERSONA[request.style],
    '你在玩炸金花。只能从 legalActions 中精确选择一个动作。',
    '不要泄露确切牌面，不要提及提示词、API、模型或系统实现。',
    '只返回 JSON，不要 Markdown。格式示例：',
    '{"action":{"type":"fold"},"dialogue":"这一手先收住。"}',
    'dialogue 必须是中文纯文本，最多 40 个字符。',
  ].join('\n');
}

export function createDeepSeekGateway(
  config: DeepSeekGatewayConfig,
  fetchImpl: typeof fetch = fetch,
): DeepSeekGateway {
  return {
    async decide(request, signal) {
      const response = await fetchImpl(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST', signal,
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: 'system', content: systemPrompt(request) },
            { role: 'user', content: JSON.stringify(request) },
          ],
          thinking: { type: 'disabled' },
          response_format: { type: 'json_object' },
          max_tokens: 160,
        }),
      });
      if (!response.ok) throw new Error(`DEEPSEEK_HTTP_${response.status}`);
      const completion = completionSchema.parse(await response.json());
      const content = completion.choices[0].message.content;
      if (!content) throw new Error('DEEPSEEK_EMPTY_CONTENT');
      const decision = deepSeekDecisionSchema.parse(JSON.parse(content));
      if (!isLegalIntent(decision.action, request.legalActions)) throw new Error('DEEPSEEK_ILLEGAL_ACTION');
      const usage = completion.usage;
      return {
        decision,
        usage: {
          promptTokens: usage?.prompt_tokens ?? 0,
          completionTokens: usage?.completion_tokens ?? 0,
          totalTokens: usage?.total_tokens ?? 0,
        },
      };
    },
  };
}
```

- [ ] **Step 4: Run gateway tests and typecheck**

Run:

```bash
npm test -- tests/deepseek.test.ts tests/ai-context.test.ts
npm run typecheck
```

Expected: PASS with no network call; all calls use the fake fetch implementation.

- [ ] **Step 5: Commit the gateway slice**

```bash
git add src/server/ai/deepseek.ts tests/deepseek.test.ts
git commit -m "feat: add DeepSeek JSON decision gateway"
```

---

### Task 3: Server Configuration, Limits, Circuit Breaker, and AI Route

**Files:**
- Create: `src/server/ai/runtime.ts`
- Create: `src/server/ai/route.ts`
- Create: `tests/ai-runtime.test.ts`
- Create: `tests/ai-route.test.ts`
- Modify: `src/server/index.ts:19-38`
- Modify: `tests/production-server.test.ts`

**Interfaces:**
- Consumes: `DeepSeekGateway`, `createDeepSeekGateway`, `aiDecisionRequestSchema`, `intentToGameAction`.
- Produces: `AiRuntimeConfig`, `loadAiRuntimeConfig`, `FixedWindowLimiter`, `CircuitBreaker`, `createAiDecisionRouter`, and an injectable `GameServerOptions.aiRouter`.

- [ ] **Step 1: Write failing runtime state-machine tests**

Create `tests/ai-runtime.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { CircuitBreaker, FixedWindowLimiter, loadAiRuntimeConfig } from '../src/server/ai/runtime';

describe('AI runtime protection', () => {
  it('parses defaults without exposing the key', () => {
    expect(loadAiRuntimeConfig({ DEEPSEEK_API_KEY: 'secret' })).toMatchObject({
      enabled: true, model: 'deepseek-v4-flash', timeoutMs: 3000,
      perIpPerMinute: 30, globalPerHour: 300,
    });
  });

  it('disables remote AI when the key is absent', () => {
    expect(loadAiRuntimeConfig({ AI_ENABLED: 'true' }).enabled).toBe(false);
  });

  it('resets a fixed window after its duration', () => {
    let now = 1000;
    const limiter = new FixedWindowLimiter(() => now);
    expect(limiter.take('ip:a', 2, 60_000)).toBe(true);
    expect(limiter.take('ip:a', 2, 60_000)).toBe(true);
    expect(limiter.take('ip:a', 2, 60_000)).toBe(false);
    now += 60_001;
    expect(limiter.take('ip:a', 2, 60_000)).toBe(true);
  });

  it('opens after three failures and permits only one probe after cooldown', () => {
    let now = 1000;
    const breaker = new CircuitBreaker(3, 30_000, () => now);
    breaker.failure(); breaker.failure(); breaker.failure();
    expect(breaker.canRequest()).toBe(false);
    now += 30_001;
    expect(breaker.canRequest()).toBe(true);
    expect(breaker.canRequest()).toBe(false);
    breaker.success();
    expect(breaker.canRequest()).toBe(true);
  });
});
```

- [ ] **Step 2: Implement deterministic configuration and protection primitives**

Create `src/server/ai/runtime.ts`:

```ts
export interface AiRuntimeConfig {
  enabled: boolean; apiKey: string; baseUrl: string; model: string;
  timeoutMs: number; perIpPerMinute: number; globalPerHour: number;
  breakerFailures: number; breakerCooldownMs: number;
}

function positive(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function loadAiRuntimeConfig(env: Record<string, string | undefined>): AiRuntimeConfig {
  const apiKey = env.DEEPSEEK_API_KEY?.trim() ?? '';
  const provider = env.AI_PROVIDER?.trim() || 'deepseek';
  return {
    enabled: env.AI_ENABLED !== 'false' && provider === 'deepseek' && apiKey.length > 0,
    apiKey,
    baseUrl: env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com',
    model: env.DEEPSEEK_MODEL?.trim() || 'deepseek-v4-flash',
    timeoutMs: positive(env.AI_TIMEOUT_MS, 3000),
    perIpPerMinute: positive(env.AI_MAX_REQUESTS_PER_MINUTE_PER_IP, 30),
    globalPerHour: positive(env.AI_MAX_REQUESTS_PER_HOUR, 300),
    breakerFailures: positive(env.AI_CIRCUIT_BREAKER_FAILURES, 3),
    breakerCooldownMs: positive(env.AI_CIRCUIT_BREAKER_COOLDOWN_MS, 30_000),
  };
}

export class FixedWindowLimiter {
  private readonly windows = new Map<string, { startedAt: number; count: number }>();
  constructor(private readonly now: () => number = Date.now) {}
  take(key: string, limit: number, windowMs: number): boolean {
    const current = this.now();
    const window = this.windows.get(key);
    if (!window || current - window.startedAt >= windowMs) {
      this.windows.set(key, { startedAt: current, count: 1 });
      return true;
    }
    if (window.count >= limit) return false;
    window.count += 1;
    return true;
  }
}

export class CircuitBreaker {
  private failures = 0;
  private openUntil = 0;
  private probeInFlight = false;
  constructor(
    private readonly threshold: number,
    private readonly cooldownMs: number,
    private readonly now: () => number = Date.now,
  ) {}
  canRequest(): boolean {
    if (this.openUntil === 0) return true;
    if (this.now() < this.openUntil || this.probeInFlight) return false;
    this.probeInFlight = true;
    return true;
  }
  success(): void { this.failures = 0; this.openUntil = 0; this.probeInFlight = false; }
  failure(): void {
    this.failures += 1;
    this.probeInFlight = false;
    if (this.failures >= this.threshold) this.openUntil = this.now() + this.cooldownMs;
  }
}
```

- [ ] **Step 3: Write failing route tests**

Create `tests/ai-route.test.ts`. Start `createGameServer` on port 0 with an injected router and fake `DeepSeekGateway`. Cover these cases with real HTTP fetch calls:

```ts
// @vitest-environment node
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAiDecisionRequest } from '../src/ai/context';
import { createAiDecisionRouter } from '../src/server/ai/route';
import type { DeepSeekGateway } from '../src/server/ai/deepseek';
import { createGameServer, type GameServer } from '../src/server/index';
import { createGame } from '../src/shared/game';

function body() {
  const state = createGame({
    players: [{ id: 'bot', name: '青竹' }, { id: 'you', name: '你' }],
    startingChips: 1000, ante: 10, random: () => 0,
  });
  return buildAiDecisionRequest(state, 'bot', 'cautious', [], 'req-http');
}

describe('AI decision route', () => {
  let server: GameServer | undefined;
  afterEach(async () => server?.stop());

  async function start(gateway: DeepSeekGateway, overrides: Record<string, string> = {}) {
    const router = createAiDecisionRouter({
      gateway,
      env: { DEEPSEEK_API_KEY: 'test-only', ...overrides },
      logger: { info: vi.fn(), warn: vi.fn() },
    });
    server = createGameServer({ aiRouter: router });
    await server.start(0);
    const port = (server.httpServer.address() as AddressInfo).port;
    return `http://127.0.0.1:${port}/api/ai/decision`;
  }

  it('returns a trusted full action from a legal model intent', async () => {
    const gateway: DeepSeekGateway = { decide: vi.fn().mockResolvedValue({
      decision: { action: { type: 'fold' }, dialogue: '先收一手。' },
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    }) };
    const url = await start(gateway);
    const response = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body()),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      requestId: 'req-http', playerId: 'bot', turnId: 1,
      action: { type: 'fold', playerId: 'bot', turnId: 1 }, dialogue: '先收一手。',
    });
  });

  it('returns 400 for an invalid body and never calls the gateway', async () => {
    const gateway: DeepSeekGateway = { decide: vi.fn() };
    const url = await start(gateway);
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(response.status).toBe(400);
    expect(gateway.decide).not.toHaveBeenCalled();
  });

  it('returns 429 after the per-IP limit', async () => {
    const gateway: DeepSeekGateway = { decide: vi.fn().mockResolvedValue({
      decision: { action: { type: 'fold' }, dialogue: '收。' },
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    }) };
    const url = await start(gateway, { AI_MAX_REQUESTS_PER_MINUTE_PER_IP: '1' });
    const init = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body()) };
    expect((await fetch(url, init)).status).toBe(200);
    expect((await fetch(url, init)).status).toBe(429);
  });

  it('aborts a slow gateway and returns 504', async () => {
    const gateway: DeepSeekGateway = { decide: vi.fn((_request, signal) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    })) };
    const url = await start(gateway, { AI_TIMEOUT_MS: '10' });
    const response = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body()),
    });
    expect(response.status).toBe(504);
  });
});
```

Also add a production-server assertion to `tests/production-server.test.ts` that `POST /api/ai/decision` returns JSON `503` rather than the SPA HTML when no key is configured.

- [ ] **Step 4: Implement the sanitized Express router**

Create `src/server/ai/route.ts` with a `Router`, a 16 KB request handled by the server, injected dependencies for tests, and no logging of bodies/cards/prompts:

```ts
import { Router } from 'express';
import { aiDecisionRequestSchema, intentToGameAction } from '../../ai/contracts';
import { createDeepSeekGateway, type DeepSeekGateway } from './deepseek';
import { CircuitBreaker, FixedWindowLimiter, loadAiRuntimeConfig } from './runtime';

interface Logger { info(event: string, fields: Record<string, unknown>): void; warn(event: string, fields: Record<string, unknown>): void }
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
    if (!limiter.take(`ip:${ip}`, config.perIpPerMinute, 60_000)
      || !limiter.take('global', config.globalPerHour, 3_600_000)) {
      return response.status(429).json({ code: 'AI_RATE_LIMITED' });
    }
    if (!breaker.canRequest()) return response.status(503).json({ code: 'AI_CIRCUIT_OPEN' });

    try {
      const result = await gateway.decide(decisionRequest, AbortSignal.timeout(config.timeoutMs));
      breaker.success();
      const action = intentToGameAction(result.decision.action, decisionRequest);
      logger.info('ai_decision', {
        requestId: decisionRequest.requestId, latencyMs: now() - startedAt,
        model: config.model, totalTokens: result.usage.totalTokens, status: 'ok',
      });
      return response.json({
        requestId: decisionRequest.requestId, turnId: decisionRequest.turnId,
        playerId: decisionRequest.playerId, action, dialogue: result.decision.dialogue,
      });
    } catch (error) {
      breaker.failure();
      const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
      logger.warn('ai_decision', {
        requestId: decisionRequest.requestId, latencyMs: now() - startedAt,
        model: config.model, status: timedOut ? 'timeout' : 'provider_error',
      });
      return response.status(timedOut ? 504 : 502).json({ code: timedOut ? 'AI_TIMEOUT' : 'AI_PROVIDER_ERROR' });
    }
  });
  return router;
}
```

- [ ] **Step 5: Mount the AI API before static and SPA routes**

Modify `src/server/index.ts`:

```ts
import express, { type Express, type Router } from 'express';
import { createAiDecisionRouter } from './ai/route';

export interface GameServerOptions {
  clientRoot?: string;
  aiRouter?: Router;
}

// Inside createGameServer, before express.static:
app.set('trust proxy', 1);
app.use(express.json({ limit: '16kb' }));
app.use('/api/ai', options.aiRouter ?? createAiDecisionRouter());
app.get('/healthz', (_request, response) => response.json({ ok: true }));
app.use(express.static(clientRoot));
```

Keep the Socket.IO registration, health route, static files, and SPA fallback otherwise unchanged.

- [ ] **Step 6: Run server tests and verify no request data is logged**

Run:

```bash
npm test -- tests/ai-runtime.test.ts tests/ai-route.test.ts tests/production-server.test.ts
npm run typecheck
```

Expected: all tests PASS. In the fake logger assertions, allowed fields are only request ID, latency, model, token count, and status; serialized log calls must not contain `cards`, `prompt`, `DEEPSEEK_API_KEY`, or the test key.

- [ ] **Step 7: Commit the protected server endpoint**

```bash
git add src/server/ai/runtime.ts src/server/ai/route.ts src/server/index.ts tests/ai-runtime.test.ts tests/ai-route.test.ts tests/production-server.test.ts
git commit -m "feat: expose protected AI decision endpoint"
```

---

### Task 4: Browser Decision Service and Rule Fallback

**Files:**
- Create: `src/client/game/aiDecisionService.ts`
- Create: `tests/ai-decision-service.test.ts`

**Interfaces:**
- Consumes: `buildAiDecisionRequest`, `aiDecisionResponseSchema`, `chooseAiAction`, `GameState`, `AiStyle`, and `PublicMemoryEntry`.
- Produces: `AiTurnDecision`, `AiDecisionService`, `createAiDecisionService`, and singleton `browserAiDecisionService`.

- [ ] **Step 1: Write failing client service tests**

Create `tests/ai-decision-service.test.ts` using a deterministic two-player `GameState`. Assert:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createAiDecisionService } from '../src/client/game/aiDecisionService';
import { createGame } from '../src/shared/game';

function state() {
  return createGame({
    players: [{ id: 'bot', name: '青竹' }, { id: 'you', name: '你' }],
    startingChips: 1000, ante: 10, random: () => 0,
  });
}

describe('AI decision service', () => {
  it('returns a valid remote response', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        requestId: request.requestId, turnId: request.turnId, playerId: request.playerId,
        action: { type: 'fold', playerId: request.playerId, turnId: request.turnId },
        dialogue: '这一手先收住。',
      }), { status: 200 });
    });
    const service = createAiDecisionService({ fetchImpl, requestId: () => 'req-client' });
    await expect(service.decide(state(), 'bot', 'cautious', [], new AbortController().signal))
      .resolves.toMatchObject({ source: 'deepseek', dialogue: '这一手先收住。', action: { type: 'fold' } });
  });

  it.each([503, 429, 500])('falls back on HTTP %s', async (status) => {
    const service = createAiDecisionService({
      fetchImpl: vi.fn().mockResolvedValue(new Response('{}', { status })),
      requestId: () => 'req-fallback', random: () => 0,
    });
    const result = await service.decide(state(), 'bot', 'cautious', [], new AbortController().signal);
    expect(result.source).toBe('rule');
    expect(result.fallbackReason).toBe(`HTTP_${status}`);
  });

  it('falls back when a response action is illegal for the current state', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        requestId: request.requestId, turnId: request.turnId, playerId: request.playerId,
        action: { type: 'raise', amount: 11, playerId: request.playerId, turnId: request.turnId },
        dialogue: '非法加注不会执行。',
      }), { status: 200 });
    });
    const service = createAiDecisionService({ fetchImpl, requestId: () => 'req-illegal', random: () => 0 });
    await expect(service.decide(state(), 'bot', 'cautious', [], new AbortController().signal))
      .resolves.toMatchObject({ source: 'rule', fallbackReason: 'ILLEGAL_RESPONSE_ACTION' });
  });

  it('falls back after its three-second budget', async () => {
    vi.useFakeTimers();
    const service = createAiDecisionService({
      fetchImpl: vi.fn((_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      })),
      requestId: () => 'req-timeout', timeoutMs: 3000, random: () => 0,
    });
    const pending = service.decide(state(), 'bot', 'cautious', [], new AbortController().signal);
    await vi.advanceTimersByTimeAsync(3000);
    await expect(pending).resolves.toMatchObject({ source: 'rule', fallbackReason: 'TIMEOUT' });
    vi.useRealTimers();
  });

  it('does not execute fallback after an external reset abort', async () => {
    const controller = new AbortController();
    const service = createAiDecisionService({
      fetchImpl: vi.fn((_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      })),
      requestId: () => 'req-abort',
    });
    const pending = service.decide(state(), 'bot', 'cautious', [], controller.signal);
    controller.abort(new DOMException('reset', 'AbortError'));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
```

- [ ] **Step 2: Run the test and verify the service is missing**

Run `npm test -- tests/ai-decision-service.test.ts`.

Expected: FAIL because `src/client/game/aiDecisionService.ts` does not exist.

- [ ] **Step 3: Implement remote validation, timeout, and local fallback**

Create `src/client/game/aiDecisionService.ts` with:

```ts
import { aiDecisionResponseSchema, type AiStyle, type PublicMemoryEntry } from '../../ai/contracts';
import { buildAiDecisionRequest } from '../../ai/context';
import { chooseAiAction } from '../../ai/strategy';
import { applyAction } from '../../shared/game';
import type { GameAction, GameState } from '../../shared/types';

export interface AiTurnDecision {
  action: GameAction; dialogue: string; source: 'deepseek' | 'rule'; fallbackReason?: string;
}
export interface AiDecisionService {
  decide(state: GameState, playerId: string, style: AiStyle, memory: PublicMemoryEntry[], signal: AbortSignal): Promise<AiTurnDecision>;
}
interface Options {
  fetchImpl?: typeof fetch; timeoutMs?: number; requestId?: () => string; random?: () => number;
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
      const timeout = globalThis.setTimeout(() => timeoutController.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs);
      const signal = AbortSignal.any([externalSignal, timeoutController.signal]);
      try {
        const response = await fetchImpl('/api/ai/decision', {
          method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
        });
        if (!response.ok) throw new Error(`HTTP_${response.status}`);
        const parsed = aiDecisionResponseSchema.parse(await response.json());
        if (parsed.requestId !== request.requestId || parsed.turnId !== request.turnId
          || parsed.playerId !== request.playerId || parsed.action.turnId !== request.turnId
          || parsed.action.playerId !== request.playerId) throw new Error('STALE_OR_MISMATCHED_RESPONSE');
        try {
          applyAction(state, parsed.action);
        } catch {
          throw new Error('ILLEGAL_RESPONSE_ACTION');
        }
        return { action: parsed.action, dialogue: parsed.dialogue, source: 'deepseek' };
      } catch (error) {
        if (externalSignal.aborted) throw externalSignal.reason;
        const fallbackReason = timeoutController.signal.aborted
          ? 'TIMEOUT'
          : error instanceof Error ? error.message : 'UNKNOWN';
        const lines = FALLBACK_DIALOGUE[style];
        return {
          action: chooseAiAction(state, playerId, style, random),
          dialogue: lines[Math.min(lines.length - 1, Math.floor(random() * lines.length))],
          source: 'rule', fallbackReason,
        };
      } finally {
        globalThis.clearTimeout(timeout);
      }
    },
  };
}

export const browserAiDecisionService = createAiDecisionService();
```

- [ ] **Step 4: Run service and regression tests**

Run:

```bash
npm test -- tests/ai-decision-service.test.ts tests/ai.test.ts tests/ai-context.test.ts
npm run typecheck
```

Expected: PASS. The timeout test reaches the rule result at exactly 3000 ms; the external abort rejects without a rule action.

- [ ] **Step 5: Commit the browser decision service**

```bash
git add src/client/game/aiDecisionService.ts tests/ai-decision-service.test.ts
git commit -m "feat: add resilient solo AI decision service"
```

---

### Task 5: Integrate Async AI Turns and Eight-Entry Match Memory

**Files:**
- Modify: `src/client/game/useSoloGame.ts`
- Modify: `src/client/App.tsx`
- Create: `tests/solo-game-ai.test.ts`

**Interfaces:**
- Consumes: `AiDecisionService.decide`, `appendPublicMemory`, `actionToMemory`, `applyAction`.
- Produces: `SoloController.aiThinkingPlayerId`, `SoloController.aiDialogueByPlayerId`, and `SoloController.aiNotice` for Task 6.

- [ ] **Step 1: Write failing hook-level single-flight and stale-reset tests**

Create `tests/solo-game-ai.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiTurnDecision, AiDecisionService } from '../src/client/game/aiDecisionService';
import { useSoloGame } from '../src/client/game/useSoloGame';

afterEach(() => { vi.useRealTimers(); });

describe('useSoloGame model turns', () => {
  it('starts exactly one request and records the returned dialogue', async () => {
    vi.useFakeTimers();
    const service: AiDecisionService = {
      decide: vi.fn().mockResolvedValue({
        source: 'deepseek',
        action: { type: 'fold', playerId: 'bot-cautious', turnId: 2 },
        dialogue: '这轮先观察。',
      }),
    };
    const { result } = renderHook(() => useSoloGame(service));
    act(() => result.current.dispatch({ type: 'call', playerId: 'you', turnId: 1 }));
    await act(async () => vi.advanceTimersByTimeAsync(800));
    expect(service.decide).toHaveBeenCalledTimes(1);
    expect(result.current.aiDialogueByPlayerId['bot-cautious']).toBe('这轮先观察。');
    expect(result.current.view.players.find((player) => player.id === 'bot-cautious')?.status).toBe('folded');
  });

  it('discards a pending result after match reset', async () => {
    vi.useFakeTimers();
    let resolveDecision!: (decision: AiTurnDecision) => void;
    const service: AiDecisionService = {
      decide: vi.fn(() => new Promise((resolve) => { resolveDecision = resolve; })),
    };
    const { result } = renderHook(() => useSoloGame(service));
    act(() => result.current.dispatch({ type: 'call', playerId: 'you', turnId: 1 }));
    await act(async () => vi.advanceTimersByTimeAsync(800));
    expect(service.decide).toHaveBeenCalledTimes(1);
    act(() => result.current.resetMatch());
    await act(async () => resolveDecision({
      source: 'deepseek',
      action: { type: 'fold', playerId: 'bot-cautious', turnId: 2 },
      dialogue: '不应出现。',
    }));
    expect(result.current.view.turnId).toBe(1);
    expect(result.current.view.currentPlayerId).toBe('you');
    expect(result.current.aiDialogueByPlayerId).toEqual({});
  });
});
```

- [ ] **Step 2: Run the solo UI test and verify the new prop/controller fields fail typechecking**

Run:

```bash
npm test -- tests/solo-game-ai.test.ts
npm run typecheck
```

Expected: FAIL because `useSoloGame` does not accept a decision service and `SoloController` has no AI presentation state.

- [ ] **Step 3: Replace the synchronous effect with match-state memory and stale guards**

Refactor `src/client/game/useSoloGame.ts` around this state shape and lifecycle:

```ts
interface SoloMatchState { game: GameState; memory: PublicMemoryEntry[] }

export interface SoloController {
  view: PlayerGameView;
  humanId: string;
  aiThinkingPlayerId: string | null;
  aiDialogueByPlayerId: Record<string, string>;
  aiNotice: string | null;
  dispatch(action: GameAction): void;
  nextRound(): void;
  resetMatch(): void;
}

export function useSoloGame(
  decisionService: AiDecisionService = browserAiDecisionService,
): SoloController {
  const [match, setMatch] = useState<SoloMatchState>(() => ({ game: freshMatch(), memory: [] }));
  const [aiThinkingPlayerId, setAiThinkingPlayerId] = useState<string | null>(null);
  const [aiDialogueByPlayerId, setAiDialogueByPlayerId] = useState<Record<string, string>>({});
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const generationRef = useRef(0);
  const noticeShownRef = useRef(false);
  const dialogueTimersRef = useRef(new Map<string, number>());
  const state = match.game;

  const showDialogue = useCallback((playerId: string, text: string) => {
    const oldTimer = dialogueTimersRef.current.get(playerId);
    if (oldTimer) window.clearTimeout(oldTimer);
    setAiDialogueByPlayerId((current) => ({ ...current, [playerId]: text }));
    const timer = window.setTimeout(() => {
      setAiDialogueByPlayerId((current) => {
        const next = { ...current }; delete next[playerId]; return next;
      });
      dialogueTimersRef.current.delete(playerId);
    }, 3500);
    dialogueTimersRef.current.set(playerId, timer);
  }, []);

  useEffect(() => {
    const currentId = state.currentPlayerId;
    if (state.status !== 'playing' || !currentId || currentId === HUMAN_ID) return undefined;
    const style = AI_STYLES[currentId];
    if (!style) return undefined;
    const controller = new AbortController();
    const generation = generationRef.current;
    const timer = window.setTimeout(async () => {
      setAiThinkingPlayerId(currentId);
      try {
        const result = await decisionService.decide(state, currentId, style, match.memory, controller.signal);
        if (controller.signal.aborted || generationRef.current !== generation) return;
        setMatch((latest) => {
          if (latest.game.status !== 'playing' || latest.game.currentPlayerId !== currentId
            || latest.game.turnId !== state.turnId) return latest;
          const nextGame = applyAction(latest.game, result.action);
          let memory = appendPublicMemory(latest.memory, actionToMemory(result.action));
          memory = appendPublicMemory(memory, { kind: 'dialogue', actorId: currentId, text: result.dialogue });
          return { game: nextGame, memory };
        });
        showDialogue(currentId, result.dialogue);
        if (result.source === 'rule' && !noticeShownRef.current) {
          noticeShownRef.current = true;
          setAiNotice('AI 暂时走神，已由本地策略接管');
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) throw error;
      } finally {
        if (generationRef.current === generation) setAiThinkingPlayerId(null);
      }
    }, 480 + Math.round(Math.random() * 320));
    return () => { window.clearTimeout(timer); controller.abort(new DOMException('stale turn', 'AbortError')); };
  }, [decisionService, match.memory, showDialogue, state]);

  const dispatch = useCallback((action: GameAction) => {
    if (action.playerId !== HUMAN_ID) return;
    setMatch((latest) => ({
      game: applyAction(latest.game, action),
      memory: appendPublicMemory(latest.memory, actionToMemory(action)),
    }));
  }, []);

  const startNextRound = useCallback(() => {
    generationRef.current += 1;
    setMatch((latest) => ({ game: nextRound(latest.game), memory: latest.memory }));
    setAiThinkingPlayerId(null); setAiDialogueByPlayerId({});
  }, []);

  const resetMatch = useCallback(() => {
    generationRef.current += 1;
    dialogueTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    dialogueTimersRef.current.clear();
    noticeShownRef.current = false;
    setMatch({ game: freshMatch(), memory: [] });
    setAiThinkingPlayerId(null); setAiDialogueByPlayerId({}); setAiNotice(null);
  }, []);

  const view = useMemo(() => toPlayerView(state, HUMAN_ID), [state]);
  return { view, humanId: HUMAN_ID, aiThinkingPlayerId, aiDialogueByPlayerId, aiNotice,
    dispatch, nextRound: startNextRound, resetMatch };
}
```

Keep `PLAYERS`, `AI_STYLES`, `freshMatch`, and `nextRound`; remove the direct `chooseAiAction` import and add imports for `useRef`, contract/context helpers, and the decision service.

- [ ] **Step 4: Add decision-service injection to App**

Modify `src/client/App.tsx`:

```ts
import type { AiDecisionService } from './game/aiDecisionService';

interface AppProps {
  socketFactory?: SocketFactory;
  soloDecisionService?: AiDecisionService;
}

export function App({ socketFactory = createBrowserSocket, soloDecisionService }: AppProps) {
  const solo = useSoloGame(soloDecisionService);
```

Do not pass the service into `OnlineMode`.

- [ ] **Step 5: Run solo, AI, lifecycle, and type tests**

Run:

```bash
npm test -- tests/solo-game-ai.test.ts tests/solo-ui.test.tsx tests/ai-decision-service.test.ts tests/ai.test.ts tests/lifecycle.test.ts
npm run typecheck
```

Expected: PASS, one model request per AI turn, and no stale action after reset.

- [ ] **Step 6: Commit async solo state integration**

```bash
git add src/client/game/useSoloGame.ts src/client/App.tsx tests/solo-game-ai.test.ts
git commit -m "feat: integrate model decisions into solo turns"
```

---

### Task 6: Thinking State, Dialogue Bubbles, and Responsive Presentation

**Files:**
- Modify: `src/client/App.tsx`
- Modify: `src/client/components/GameTable.tsx`
- Modify: `src/client/components/PlayerSeat.tsx`
- Modify: `src/client/styles.css`
- Modify: `tests/solo-ui.test.tsx`

**Interfaces:**
- Consumes: the three presentation fields produced by `SoloController` in Task 5.
- Produces: optional `GameTableProps.aiThinkingPlayerId`, `aiDialogueByPlayerId`, `aiNotice`, and optional `PlayerSeatProps.isThinking`, `dialogue` that preserve online callers.

- [ ] **Step 1: Add failing accessibility and fallback-notice tests**

Update the imports in `tests/solo-ui.test.tsx` to include `act`, `afterEach`, `vi`, and `AiDecisionService`, then add these tests:

```ts
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiDecisionService } from '../src/client/game/aiDecisionService';

afterEach(() => vi.useRealTimers());

it('shows thinking and exposes validated dialogue to assistive technology', async () => {
  vi.useFakeTimers();
  let resolveDecision!: (value: Awaited<ReturnType<AiDecisionService['decide']>>) => void;
  const service: AiDecisionService = {
    decide: vi.fn(() => new Promise((resolve) => { resolveDecision = resolve; })),
  };
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<App soloDecisionService={service} />);
  await user.click(screen.getByRole('button', { name: '单机对战' }));
  await user.click(screen.getByRole('button', { name: /跟注 10/ }));
  await act(async () => vi.advanceTimersByTimeAsync(800));
  expect(screen.getByText('正在思考…')).toBeInTheDocument();
  await act(async () => resolveDecision({
    source: 'deepseek',
    action: { type: 'fold', playerId: 'bot-cautious', turnId: 2 },
    dialogue: '这轮先观察。',
  }));
  expect(screen.getByText('这轮先观察。')).toHaveAttribute('aria-live', 'polite');
});

it('renders one degradation notice across consecutive fallback turns', async () => {
  vi.useFakeTimers();
  const service: AiDecisionService = {
    decide: vi.fn(async (state, playerId) => ({
      source: 'rule' as const,
      fallbackReason: 'TIMEOUT',
      action: { type: 'call' as const, playerId, turnId: state.turnId },
      dialogue: '本地策略接管。',
    })),
  };
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<App soloDecisionService={service} />);
  await user.click(screen.getByRole('button', { name: '单机对战' }));
  await user.click(screen.getByRole('button', { name: /跟注 10/ }));
  await act(async () => vi.advanceTimersByTimeAsync(800));
  await act(async () => vi.advanceTimersByTimeAsync(800));
  expect(service.decide).toHaveBeenCalledTimes(2);
  expect(screen.getAllByText('AI 暂时走神，已由本地策略接管')).toHaveLength(1);
});
```

- [ ] **Step 2: Pass solo presentation state through App and GameTable**

Add these optional props to `GameTableProps` with defaults:

```ts
aiThinkingPlayerId?: string | null;
aiDialogueByPlayerId?: Record<string, string>;
aiNotice?: string | null;
```

Destructure defaults `aiThinkingPlayerId = null`, `aiDialogueByPlayerId = {}`, and `aiNotice = null`. In `App`'s solo `GameTable`, pass:

```tsx
aiThinkingPlayerId={solo.aiThinkingPlayerId}
aiDialogueByPlayerId={solo.aiDialogueByPlayerId}
aiNotice={solo.aiNotice}
```

When mapping players in `GameTable`, pass:

```tsx
isThinking={aiThinkingPlayerId === player.id}
dialogue={aiDialogueByPlayerId[player.id]}
```

Render the nonblocking notice inside `.felt-table`:

```tsx
{aiNotice && <p className="ai-notice" role="status">{aiNotice}</p>}
```

- [ ] **Step 3: Render accessible text-only seat feedback**

Extend `PlayerSeatProps` and the component parameters:

```ts
isThinking?: boolean;
dialogue?: string;
```

Inside the `<article>`, before `.seat-cards`, render:

```tsx
{(isThinking || dialogue) && (
  <p className={`ai-speech ${isThinking ? 'is-thinking' : ''}`} aria-live="polite">
    {isThinking ? '正在思考…' : dialogue}
  </p>
)}
```

Keep this as a React text node; do not use HTML injection.

- [ ] **Step 4: Add bounded desktop/mobile styles**

Add to `src/client/styles.css` near the existing seat and last-action rules:

```css
.ai-speech {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 8px);
  z-index: 4;
  width: max-content;
  max-width: 180px;
  margin: 0;
  padding: 7px 10px;
  border: 1px solid rgba(216, 173, 85, .42);
  border-radius: 10px;
  color: var(--ivory);
  background: rgba(18, 27, 23, .94);
  box-shadow: 0 8px 20px rgba(0, 0, 0, .22);
  font-size: 12px;
  line-height: 1.35;
  overflow-wrap: anywhere;
  transform: translateX(-50%);
}
.ai-speech.is-thinking { color: var(--gold-soft); }
.ai-notice {
  position: absolute;
  left: 50%;
  top: 18px;
  z-index: 5;
  max-width: min(340px, calc(100% - 32px));
  margin: 0;
  padding: 6px 10px;
  border-radius: 999px;
  color: var(--ivory-muted);
  background: rgba(0, 0, 0, .38);
  font-size: 11px;
  text-align: center;
  transform: translateX(-50%);
}
```

Inside the existing `@media (max-width: 767px)` block add:

```css
.ai-speech { max-width: 124px; padding: 5px 7px; font-size: 10px; }
.player-seat.is-self .ai-speech { max-width: 180px; }
.ai-notice { top: 10px; font-size: 10px; }
```

- [ ] **Step 5: Run UI and online regressions**

Run:

```bash
npm test -- tests/solo-ui.test.tsx tests/online-ui.test.tsx tests/countdown-ui.test.tsx tests/sound-ui.test.tsx
npm run typecheck
```

Expected: PASS. Online UI compiles without providing AI props, the dialogue uses `aria-live="polite"`, and there is one degradation notice.

- [ ] **Step 6: Commit the presentation slice**

```bash
git add src/client/App.tsx src/client/components/GameTable.tsx src/client/components/PlayerSeat.tsx src/client/styles.css tests/solo-ui.test.tsx
git commit -m "feat: show solo AI thinking and dialogue"
```

---

### Task 7: Local Configuration, Browser Coverage, Documentation, and Release Verification

**Files:**
- Create: `.env.example`
- Create: `e2e/solo-ai.spec.ts`
- Modify: `.gitignore`
- Modify: `package.json`
- Modify: `vite.config.ts`
- Modify: `e2e/responsive.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: complete server and client feature from Tasks 1–6.
- Produces: a reproducible local setup, browser acceptance coverage, and deployment instructions without credentials.

- [ ] **Step 1: Add the same-origin development proxy and safe env template**

Add `/api` next to the existing Socket.IO proxy in `vite.config.ts`:

```ts
'/api': {
  target: 'http://127.0.0.1:3001',
},
```

Create `.env.example`:

```dotenv
AI_ENABLED=true
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
AI_TIMEOUT_MS=3000
AI_MAX_REQUESTS_PER_MINUTE_PER_IP=30
AI_MAX_REQUESTS_PER_HOUR=300
AI_CIRCUIT_BREAKER_FAILURES=3
AI_CIRCUIT_BREAKER_COOLDOWN_MS=30000
```

Append to `.gitignore`:

```gitignore
.env
.env.*
!.env.example
```

Change the `dev:server` script in `package.json` so only the server process loads the optional local file:

```json
"dev:server": "tsx --env-file-if-exists=.env watch src/server/index.ts"
```

Run `git check-ignore .env` and `git check-ignore .env.example`. Expected: `.env` is ignored; `.env.example` is not ignored.

- [ ] **Step 2: Write browser tests with route interception**

Create `e2e/solo-ai.spec.ts`. Intercept `**/api/ai/decision`, echo the request identity, and return legal actions selected from the request. Use one success test and one abort/fallback test:

```ts
import { expect, test } from '@playwright/test';

test('solo AI shows thinking, dialogue, and applies one legal action', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/ai/decision', async (route) => {
    calls += 1;
    const request = route.request().postDataJSON();
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      requestId: request.requestId, turnId: request.turnId, playerId: request.playerId,
      action: { type: 'fold', playerId: request.playerId, turnId: request.turnId },
      dialogue: '这轮先观察。',
    }) });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '单机对战' }).click();
  await page.getByRole('button', { name: '跟注' }).click();
  await expect(page.getByText('正在思考…')).toBeVisible();
  await expect(page.getByText('这轮先观察。')).toBeVisible();
  expect(calls).toBe(1);
});

test('solo game continues when the AI endpoint is unavailable', async ({ page }) => {
  await page.route('**/api/ai/decision', (route) => route.fulfill({ status: 503, body: '{}' }));
  await page.goto('/');
  await page.getByRole('button', { name: '单机对战' }).click();
  await page.getByRole('button', { name: '弃牌' }).click();
  await expect(page.getByRole('dialog', { name: '本局结算' })).toBeVisible({ timeout: 20_000 });
});
```

Extend `e2e/responsive.spec.ts` by intercepting the same route with a 40-character dialogue, advance to an AI turn, wait for `.ai-speech`, then retain the existing `scrollWidth - innerWidth <= 0` assertion.

- [ ] **Step 3: Document local and Render configuration**

Add a `## DeepSeek 单机 AI` section to `README.md` containing:

```markdown
## DeepSeek 单机 AI

单机模式会通过服务端调用 `deepseek-v4-flash` 生成动作和台词。密钥只允许配置在服务端；未配置、超时、达到限额或供应商异常时，游戏会在 3 秒决策预算后自动使用本地规则 AI，不影响在线真人模式。

本地开发可复制 `.env.example` 为 `.env`，填入轮换后的 `DEEPSEEK_API_KEY`，再运行 `npm run dev`。不要把 `.env`、密钥或带密钥的命令输出提交到 Git。

Render 部署时，在服务的 Environment 页面设置 `DEEPSEEK_API_KEY`，并按 `.env.example` 添加其他非敏感配置。不要把密钥写入 `render.yaml`。设置完成后重新部署，先检查 `/healthz`，再完成一场单机冒烟测试和一场在线双人回归测试。
```

Do not insert a real key or key-shaped example anywhere.

- [ ] **Step 4: Run the complete automated verification**

Run:

```bash
npm test
npm run typecheck
npm run build
npm run test:e2e
```

Expected:

- All Vitest suites PASS.
- TypeScript exits with code 0.
- Vite and tsup build client/server successfully.
- Playwright passes existing solo, online, responsive tests and the new `solo-ai.spec.ts` tests.

- [ ] **Step 5: Scan the tracked tree and built client for secrets and hidden-card field leaks**

Run:

```bash
git grep -nE 'sk-[A-Za-z0-9]{16,}|DEEPSEEK_API_KEY=.+' -- ':!docs/superpowers/specs/*' ':!docs/superpowers/plans/*'
rg -n 'DEEPSEEK_API_KEY|Authorization: Bearer|api\.deepseek\.com' dist/client
git status --short
```

Expected: both scans return no matches. `git status --short` lists only intended source, test, env-template, and documentation changes; `.codegraph/` and `.cursor/` remain untracked and unstaged.

- [ ] **Step 6: Commit the configuration and acceptance slice**

```bash
git add .env.example .gitignore package.json vite.config.ts e2e/solo-ai.spec.ts e2e/responsive.spec.ts README.md
git commit -m "test: verify DeepSeek solo AI end to end"
```

- [ ] **Step 7: Configure and verify Render without persisting the secret**

In the Render service Environment page, set `DEEPSEEK_API_KEY` to a newly rotated key and set the non-secret values from `.env.example`. Trigger a deploy from the completed branch, then verify:

```bash
curl -fsS https://zha-jin-hua.onrender.com/healthz
curl -fsSI https://zha-jin-hua.onrender.com/ | head -n 1
```

Expected: health returns `{"ok":true}` and the page returns HTTP 200. In a browser, complete one solo round with visible AI dialogue, one forced-fallback round with `AI_ENABLED=false`, and one online two-player round. Inspect Render logs and confirm they contain only request ID, latency, model, token counts, status, and fallback category—never cards, prompts, model response text, or credentials.

---

## Final Acceptance Gate

- [ ] Run `git log --oneline -8` and confirm each task is represented by a focused commit.
- [ ] Run `git diff HEAD~7 --check` and confirm there are no whitespace errors.
- [ ] Run `npm test && npm run typecheck && npm run build && npm run test:e2e` once more from a clean shell.
- [ ] Confirm a model request never contains `deck`, opponent `cards`, or self `cards` while `hasLooked=false`.
- [ ] Confirm invalid model JSON, illegal raises/targets, 401, 429, 5xx, network errors, and 3000 ms timeout all reach the local rule AI.
- [ ] Confirm reset aborts the old request and a stale `turnId` cannot mutate the new match.
- [ ] Confirm the browser bundle, network responses, Git history, and Render logs contain no DeepSeek key.
- [ ] Confirm online human rooms still create, join, play, reconnect, and finish without calling `/api/ai/decision`.
