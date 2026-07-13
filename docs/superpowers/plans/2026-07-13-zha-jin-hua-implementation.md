# 炸金花双模式游戏 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建并公开部署一款同时支持单机 AI 对战和 2～6 人实时联网房间的响应式炸金花网页游戏。

**Architecture:** 在 `zha-jin-hua/` 中创建单包 TypeScript 应用，共享纯函数规则引擎供单机控制器、AI 和权威 Socket.IO 服务端使用。React 客户端只渲染可见状态和提交动作；生产环境由同一个 Node.js 进程提供静态网页与 WebSocket 服务。

**Tech Stack:** TypeScript 5、React 19、Vite 7、Node.js 22、Express 5、Socket.IO 4、Zod 4、Vitest 3、Testing Library、Playwright、CSS Modules/原生 CSS、npm。

## Global Constraints

- 使用 52 张无大小王的扑克牌，牌型顺序为豹子、同花顺、同花、顺子、对子、单张。
- A23 是最小顺子，QKA 是最大顺子；不启用特殊 235；花色不参与大小比较。
- 单机固定 1 名真人与 3 名 AI；联网房间支持 2～6 人。
- 每名玩家初始 1000 虚拟筹码，每局底注 10；不提供真实货币、充值或提现功能。
- 联网模式使用昵称、六位房间码和不可预测会话令牌，不要求账号或数据库。
- 当前行动限时 30 秒，断线座位保留 60 秒。
- 手机主要触控目标不小于 44×44 CSS 像素，并尊重 `prefers-reduced-motion`。
- 生产部署必须支持 HTTPS 与 WebSocket 长连接，并由一个 Node.js 服务同时托管客户端与服务器。

---

## File Map

- `zha-jin-hua/package.json`: 依赖、开发、测试、构建和生产启动命令。
- `zha-jin-hua/tsconfig.json`: 浏览器与 Node 共享的严格 TypeScript 配置。
- `zha-jin-hua/vite.config.ts`: React、Vitest 与开发期 Socket 代理。
- `zha-jin-hua/src/test/setup.ts`: Testing Library 的 DOM 断言初始化。
- `zha-jin-hua/playwright.config.ts`: 双浏览器上下文与移动视口测试配置。
- `zha-jin-hua/src/shared/types.ts`: 牌、玩家、对局、动作与客户端快照类型。
- `zha-jin-hua/src/shared/cards.ts`: 牌组生成、可注入随机源的洗牌。
- `zha-jin-hua/src/shared/evaluate.ts`: 牌型识别与比较。
- `zha-jin-hua/src/shared/game.ts`: 状态创建、合法动作、动作归约与结算。
- `zha-jin-hua/src/shared/visibility.ts`: 按玩家裁剪联网快照。
- `zha-jin-hua/src/ai/strategy.ts`: 三种 AI 风格及动作选择。
- `zha-jin-hua/src/server/rooms.ts`: 房间、座位、会话、房主移交和清理。
- `zha-jin-hua/src/server/socket.ts`: Zod 校验后的 Socket 事件与权威广播。
- `zha-jin-hua/src/server/index.ts`: Express/Socket.IO 启动、静态托管与健康检查。
- `zha-jin-hua/src/client/main.tsx`: React 入口。
- `zha-jin-hua/src/client/App.tsx`: 首页、单机和联网路由状态。
- `zha-jin-hua/src/client/game/useSoloGame.ts`: 单机对局与 AI 调度。
- `zha-jin-hua/src/client/online/useOnlineGame.ts`: Socket 连接、房间事件与重连。
- `zha-jin-hua/src/client/components/`: 首页、大厅、等待房间、牌桌、操作区、卡牌、玩家座位、结算层和规则层。
- `zha-jin-hua/src/client/styles.css`: 设计令牌、响应式桌面/手机布局、动效和无障碍状态。
- `zha-jin-hua/tests/`: 规则、AI、房间与 Socket 集成测试。
- `zha-jin-hua/e2e/`: 单机完整一局、联网双客户端和移动布局测试。
- `zha-jin-hua/render.yaml`: 支持 WebSocket 的 Render Web Service 配置。
- `zha-jin-hua/README.md`: 本地、局域网、测试、构建和部署说明。

### Task 1: 工程骨架与牌型引擎

**Files:**
- Create: `zha-jin-hua/package.json`
- Create: `zha-jin-hua/tsconfig.json`
- Create: `zha-jin-hua/vite.config.ts`
- Create: `zha-jin-hua/index.html`
- Create: `zha-jin-hua/src/test/setup.ts`
- Create: `zha-jin-hua/src/shared/types.ts`
- Create: `zha-jin-hua/src/shared/cards.ts`
- Create: `zha-jin-hua/src/shared/evaluate.ts`
- Test: `zha-jin-hua/tests/evaluate.test.ts`

**Interfaces:**
- Produces: `Card`, `Suit`, `Rank`, `HandCategory`, `HandValue`, `createDeck()`, `shuffleDeck(random)`, `evaluateHand(cards)`, `compareHands(left, right)`.

- [ ] **Step 1: 创建 npm/Vite/Vitest 骨架并安装锁定依赖**

```json
{
  "name": "zha-jin-hua",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "concurrently -k \"npm:dev:client\" \"npm:dev:server\"",
    "dev:client": "vite --host 0.0.0.0",
    "dev:server": "tsx watch src/server/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "typecheck": "tsc --noEmit",
    "build": "vite build && tsup src/server/index.ts --format esm --out-dir dist/server --clean false",
    "start": "node dist/server/index.js"
  }
}
```

Run: `cd zha-jin-hua && npm install react@19 react-dom@19 express@5 socket.io@4 socket.io-client@4 zod@4 && npm install -D typescript@5 vite@7 @vitejs/plugin-react@latest vitest@3 jsdom@latest @testing-library/react@latest @testing-library/user-event@latest @testing-library/jest-dom@latest @types/react@19 @types/react-dom@19 @types/express@5 tsx@latest tsup@latest concurrently@latest @playwright/test@latest`

Expected: `package-lock.json` is created and npm exits with code 0.

Configure Vite so production assets and server expectations match exactly:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist/client', emptyOutDir: true },
  server: { proxy: { '/socket.io': { target: 'http://127.0.0.1:3001', ws: true } } },
  test: { environment: 'jsdom', setupFiles: ['./src/test/setup.ts'] },
});
```

`src/test/setup.ts` contains `import '@testing-library/jest-dom/vitest';`.

- [ ] **Step 2: 先写六种牌型、A23、QKA、逐级比较和平局测试**

```ts
import { describe, expect, it } from 'vitest';
import { compareHands, evaluateHand } from '../src/shared/evaluate';
import type { Card, Rank, Suit } from '../src/shared/types';

const hand = (text: string): Card[] => text.split(' ').map((token) => ({
  rank: token.slice(0, -1) as Rank,
  suit: token.at(-1) as Suit,
}));

describe('evaluateHand', () => {
  it.each([
    ['AS AH AD', 'triple'],
    ['QH KH AH', 'straight-flush'],
    ['2S 7S JS', 'flush'],
    ['9S 10H JD', 'straight'],
    ['8S 8H KD', 'pair'],
    ['2S 7H KD', 'high-card'],
  ])('%s is %s', (cards, category) => {
    expect(evaluateHand(hand(cards)).category).toBe(category);
  });

  it('treats A23 as the lowest straight and QKA as the highest', () => {
    expect(compareHands(hand('AS 2H 3D'), hand('2S 3H 4D'))).toBeLessThan(0);
    expect(compareHands(hand('QS KH AD'), hand('JS QH KD'))).toBeGreaterThan(0);
  });

  it('ignores suit and returns zero for equal rank values', () => {
    expect(compareHands(hand('AS KH 9D'), hand('AH KD 9C'))).toBe(0);
  });
});
```

Run: `npm test -- tests/evaluate.test.ts`

Expected: FAIL because `evaluateHand` and `compareHands` do not exist.

- [ ] **Step 3: 实现牌、牌组、牌型值与字典序比较**

```ts
export type Suit = 'S' | 'H' | 'D' | 'C';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';
export interface Card { suit: Suit; rank: Rank }
export type HandCategory = 'high-card' | 'pair' | 'straight' | 'flush' | 'straight-flush' | 'triple';
export interface HandValue { category: HandCategory; categoryScore: number; tieBreakers: number[] }
```

`evaluateHand(cards)` must reject any length other than three, normalize A23 to straight high card 3, use QKA high card 14, sort pair kickers correctly, and return descending tie breakers. `compareHands` compares category score first and then each tie breaker; suit is never inspected.

Run: `npm test -- tests/evaluate.test.ts`

Expected: all evaluator tests PASS.

- [ ] **Step 4: 增加 52 张唯一牌与固定随机洗牌测试并实现 `cards.ts`**

```ts
it('creates 52 unique cards and accepts an injectable random source', () => {
  const deck = createDeck();
  expect(deck).toHaveLength(52);
  expect(new Set(deck.map((card) => `${card.rank}${card.suit}`))).toHaveLength(52);
  expect(shuffleDeck(() => 0).map((card) => `${card.rank}${card.suit}`))
    .toEqual(shuffleDeck(() => 0).map((card) => `${card.rank}${card.suit}`));
});
```

Run: `npm test -- tests/evaluate.test.ts && npm run typecheck`

Expected: PASS with zero TypeScript errors.

- [ ] **Step 5: 提交牌型引擎**

```bash
git add zha-jin-hua/package.json zha-jin-hua/package-lock.json zha-jin-hua/tsconfig.json zha-jin-hua/vite.config.ts zha-jin-hua/index.html zha-jin-hua/src/shared zha-jin-hua/tests/evaluate.test.ts
git commit -m "feat: add zha jin hua hand evaluator"
```

### Task 2: 对局状态机与玩家可见快照

**Files:**
- Modify: `zha-jin-hua/src/shared/types.ts`
- Create: `zha-jin-hua/src/shared/game.ts`
- Create: `zha-jin-hua/src/shared/visibility.ts`
- Test: `zha-jin-hua/tests/game.test.ts`
- Test: `zha-jin-hua/tests/visibility.test.ts`

**Interfaces:**
- Consumes: `Card`, `shuffleDeck`, `compareHands`.
- Produces: `GameState`, `GameAction`, `LegalActions`, `createGame(config)`, `legalActions(state, playerId)`, `applyAction(state, action)`, `toPlayerView(state, viewerId)`.

- [ ] **Step 1: 写底注、发牌、回合与合法操作失败测试**

```ts
it('collects ante, deals three cards and starts with the first player', () => {
  const state = createGame({ playerIds: ['p1', 'p2', 'p3', 'p4'], startingChips: 1000, ante: 10, random: () => 0 });
  expect(state.pot).toBe(40);
  expect(state.players.every((player) => player.cards.length === 3 && player.chips === 990)).toBe(true);
  expect(state.currentPlayerId).toBe('p1');
});

it('rejects an action from a player whose turn it is not', () => {
  const state = createGame({ playerIds: ['p1', 'p2'], startingChips: 1000, ante: 10, random: () => 0 });
  expect(() => applyAction(state, { type: 'fold', playerId: 'p2', turnId: state.turnId })).toThrowError('NOT_YOUR_TURN');
});
```

Run: `npm test -- tests/game.test.ts`

Expected: FAIL because the game state functions do not exist.

- [ ] **Step 2: 定义状态与判别联合动作类型**

```ts
export type GameAction =
  | { type: 'look'; playerId: string; turnId: number }
  | { type: 'call'; playerId: string; turnId: number }
  | { type: 'raise'; playerId: string; amount: number; turnId: number }
  | { type: 'fold'; playerId: string; turnId: number }
  | { type: 'compare'; playerId: string; targetId: string; turnId: number };

export interface LegalActions {
  canLook: boolean;
  callCost: number | null;
  raiseAmounts: number[];
  compareTargets: string[];
  canFold: boolean;
}
```

Implement immutable state transitions, blind/viewed cost multiplier, fixed raise levels `[10, 20, 50, 100, 200]`, compare cost at twice the current call cost, stale `turnId` rejection, next-active-player selection, insufficient-chip disabling, winner detection and pot award.

- [ ] **Step 3: 补齐对局规则测试并使其通过**

```ts
it('charges a viewed player twice the blind call cost', () => {
  let state = fixtureGame();
  state = applyAction(state, { type: 'look', playerId: 'p1', turnId: state.turnId });
  expect(legalActions(state, 'p1').callCost).toBe(state.baseBet * 2);
});

it('eliminates the compare loser and awards the pot to the last active player', () => {
  const state = fixtureTwoPlayerGame({ p1: 'AS AH AD', p2: '2S 7H KD' });
  const result = applyAction(state, { type: 'compare', playerId: 'p1', targetId: 'p2', turnId: state.turnId });
  expect(result.status).toBe('finished');
  expect(result.winnerIds).toEqual(['p1']);
});
```

Run: `npm test -- tests/game.test.ts`

Expected: bottom ante, look, call, raise, fold, compare, insufficient chips, stale action and settlement tests PASS.

- [ ] **Step 4: 写隐藏对手手牌测试并实现玩家快照裁剪**

```ts
it('reveals only the viewer hand while a round is active', () => {
  const view = toPlayerView(fixtureGame(), 'p1');
  expect(view.players.find((player) => player.id === 'p1')?.cards).toHaveLength(3);
  expect(view.players.find((player) => player.id === 'p2')?.cards).toEqual([null, null, null]);
});
```

At settlement, reveal cards only for players who did not fold; never include the undealt deck in `PlayerGameView`.

Run: `npm test -- tests/visibility.test.ts && npm run typecheck`

Expected: PASS and `PlayerGameView` has no `deck` property.

- [ ] **Step 5: 提交状态机**

```bash
git add zha-jin-hua/src/shared zha-jin-hua/tests/game.test.ts zha-jin-hua/tests/visibility.test.ts
git commit -m "feat: add authoritative game state machine"
```

### Task 3: 三种单机 AI 策略

**Files:**
- Create: `zha-jin-hua/src/ai/strategy.ts`
- Test: `zha-jin-hua/tests/ai.test.ts`

**Interfaces:**
- Consumes: `GameState`, `GameAction`, `LegalActions`, `evaluateHand`.
- Produces: `AiStyle = 'cautious' | 'bold' | 'chaotic'`, `chooseAiAction(state, playerId, style, random): GameAction`.

- [ ] **Step 1: 写合法性、风格差异和固定随机源测试**

```ts
it.each(['cautious', 'bold', 'chaotic'] as const)('%s AI always returns a legal action', (style) => {
  const state = aiTurnFixture();
  const action = chooseAiAction(state, state.currentPlayerId, style, () => 0.42);
  expect(action.playerId).toBe(state.currentPlayerId);
  expect(() => applyAction(state, action)).not.toThrow();
});

it('bold AI raises a triple while cautious AI avoids an expensive weak call', () => {
  expect(chooseAiAction(strongHandFixture(), 'bot', 'bold', () => 0).type).toBe('raise');
  expect(chooseAiAction(weakExpensiveFixture(), 'bot', 'cautious', () => 0).type).toBe('fold');
});
```

Run: `npm test -- tests/ai.test.ts`

Expected: FAIL because `chooseAiAction` does not exist.

- [ ] **Step 2: 实现基于牌力、成本、筹码比例与随机权重的策略**

```ts
export type AiStyle = 'cautious' | 'bold' | 'chaotic';

export function chooseAiAction(
  state: GameState,
  playerId: string,
  style: AiStyle,
  random: () => number,
): GameAction;
```

AI first obtains `legalActions`; it may look before betting, folds weak viewed hands when cost exceeds its style threshold, raises strong hands, compares in late rounds, and falls back to call or fold. Every branch selects only values supplied by `LegalActions`.

Run: `npm test -- tests/ai.test.ts && npm run typecheck`

Expected: PASS with deterministic results for fixed random values.

- [ ] **Step 3: 提交 AI**

```bash
git add zha-jin-hua/src/ai/strategy.ts zha-jin-hua/tests/ai.test.ts
git commit -m "feat: add distinct solo AI strategies"
```

### Task 4: 视觉系统、牌桌组件与单机完整对局

**Files:**
- Create: `zha-jin-hua/src/client/main.tsx`
- Create: `zha-jin-hua/src/client/App.tsx`
- Create: `zha-jin-hua/src/client/game/useSoloGame.ts`
- Create: `zha-jin-hua/src/client/components/HomeScreen.tsx`
- Create: `zha-jin-hua/src/client/components/GameTable.tsx`
- Create: `zha-jin-hua/src/client/components/PlayerSeat.tsx`
- Create: `zha-jin-hua/src/client/components/PlayingCard.tsx`
- Create: `zha-jin-hua/src/client/components/ActionBar.tsx`
- Create: `zha-jin-hua/src/client/components/RaiseSheet.tsx`
- Create: `zha-jin-hua/src/client/components/RoundResult.tsx`
- Create: `zha-jin-hua/src/client/components/RulesDialog.tsx`
- Create: `zha-jin-hua/src/client/styles.css`
- Test: `zha-jin-hua/tests/solo-ui.test.tsx`

**Interfaces:**
- Consumes: `createGame`, `applyAction`, `legalActions`, `chooseAiAction`.
- Produces: `useSoloGame()`, reusable `GameTable` controlled by a visible snapshot and action callback.

- [ ] **Step 1: 写首页进入单机、看牌与合法操作 UI 测试**

```tsx
it('starts a solo game and lets the human reveal their cards', async () => {
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: '单机对战' }));
  expect(screen.getByText('底池')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '看牌' }));
  expect(screen.getAllByLabelText(/自己的牌/)).toHaveLength(3);
});
```

Run: `npm test -- tests/solo-ui.test.tsx`

Expected: FAIL because the React application does not exist.

- [ ] **Step 2: 建立视觉设计令牌与响应式牌桌骨架**

```css
:root {
  --felt-950: #071d18;
  --felt-800: #0d3a2e;
  --felt-650: #13533f;
  --ivory: #f6f0df;
  --ink: #171713;
  --cinnabar: #b53427;
  --gold: #d8ad55;
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  color: var(--ivory);
  background: var(--felt-950);
}

button { min-block-size: 44px; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 1ms !important; transition-duration: 1ms !important; }
}
```

Desktop uses an oval table at `min-width: 768px`; mobile uses a full-height vertical table with `.action-bar` fixed above `var(--safe-bottom)`. Add visible `:focus-visible` rings and non-color status icons/text.

- [ ] **Step 3: 实现受控牌桌组件和单机 Hook**

```ts
export interface GameTableProps {
  view: PlayerGameView;
  viewerId: string;
  onAction(action: GameAction): void;
  onNextRound(): void;
  connectionState?: 'online' | 'reconnecting' | 'offline';
}

export interface SoloController {
  view: PlayerGameView;
  humanId: string;
  dispatch(action: GameAction): void;
  nextRound(): void;
  resetMatch(): void;
}
```

`useSoloGame` owns the authoritative local state, maps three bots to cautious/bold/chaotic, schedules AI actions after 450～900 ms, cancels stale timers on unmount or round change, and exposes only the human view. `ActionBar` renders buttons from `LegalActions`, `RaiseSheet` renders exact allowed amounts, and `RoundResult` exposes next round/reset.

Run: `npm test -- tests/solo-ui.test.tsx && npm run typecheck`

Expected: PASS; no action button is enabled when it is an AI turn.

- [ ] **Step 4: 提交可玩单机版**

```bash
git add zha-jin-hua/src/client zha-jin-hua/tests/solo-ui.test.tsx
git commit -m "feat: build responsive solo card table"
```

### Task 5: 权威联网房间与 Socket 协议

**Files:**
- Create: `zha-jin-hua/src/server/protocol.ts`
- Create: `zha-jin-hua/src/server/rooms.ts`
- Create: `zha-jin-hua/src/server/socket.ts`
- Create: `zha-jin-hua/src/server/index.ts`
- Test: `zha-jin-hua/tests/rooms.test.ts`
- Test: `zha-jin-hua/tests/socket.test.ts`

**Interfaces:**
- Consumes: `createGame`, `applyAction`, `toPlayerView`.
- Produces: `RoomManager`, client events `room:create`, `room:join`, `room:start`, `game:action`, `session:resume`; server events `room:snapshot`, `game:snapshot`, `request:error`.

- [ ] **Step 1: 写房间创建、加入限制、房主移交与清理测试**

```ts
it('creates a six-character room and rejects duplicate names', () => {
  const rooms = new RoomManager({ randomCode: () => 'A7K9Q2', now: () => 1000 });
  const host = rooms.create('阿林');
  expect(host.roomCode).toBe('A7K9Q2');
  expect(() => rooms.join('A7K9Q2', '阿林')).toThrowError('NAME_TAKEN');
});

it('moves host ownership to the earliest connected player', () => {
  const room = roomWithPlayers(['p1', 'p2', 'p3']);
  roomManager.leave(room.code, 'p1');
  expect(roomManager.get(room.code)?.hostId).toBe('p2');
});
```

Run: `npm test -- tests/rooms.test.ts`

Expected: FAIL because `RoomManager` does not exist.

- [ ] **Step 2: 实现内存房间与不可预测令牌**

```ts
export interface JoinResult {
  roomCode: string;
  playerId: string;
  sessionToken: string;
}

export class RoomManager {
  create(nickname: string): JoinResult;
  join(roomCode: string, nickname: string): JoinResult;
  resume(sessionToken: string): JoinResult;
  start(roomCode: string, playerId: string): void;
  act(roomCode: string, action: GameAction): void;
  disconnect(playerId: string): void;
  removeExpired(): void;
}
```

Use `crypto.randomBytes` for session tokens and unbiased room codes, normalize room codes to uppercase, trim nicknames, enforce 1～12 visible characters, cap rooms at six players, reject joins while a round is active, and keep disconnected seats for 60,000 ms.

- [ ] **Step 3: 写 Socket 权限、裁剪与非法事件测试**

```ts
it('sends each socket a snapshot containing only its own cards', async () => {
  const [host, guest] = await connectedPair();
  await startRoom(host, guest);
  expect(latestGameView(host).players.find((p) => p.id === host.playerId)?.cards.every(Boolean)).toBe(true);
  expect(latestGameView(host).players.find((p) => p.id === guest.playerId)?.cards).toEqual([null, null, null]);
});

it('rejects a game action from the wrong socket identity', async () => {
  const response = await emitAck(guest.socket, 'game:action', hostOwnedAction());
  expect(response).toEqual({ ok: false, code: 'PLAYER_MISMATCH', message: '无法替其他玩家操作' });
});
```

Run: `npm test -- tests/socket.test.ts`

Expected: FAIL before the protocol and Socket handler exist.

- [ ] **Step 4: 实现 Zod 事件校验、身份绑定与逐连接广播**

```ts
const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('look'), turnId: z.number().int().nonnegative() }),
  z.object({ type: z.literal('call'), turnId: z.number().int().nonnegative() }),
  z.object({ type: z.literal('raise'), amount: z.number().int().positive(), turnId: z.number().int().nonnegative() }),
  z.object({ type: z.literal('fold'), turnId: z.number().int().nonnegative() }),
  z.object({ type: z.literal('compare'), targetId: z.string().min(1), turnId: z.number().int().nonnegative() }),
]);
```

Bind player identity from the server-side socket session, ignore client-supplied player IDs, rate limit mutating events per socket, convert domain errors to stable codes, and call `toPlayerView` separately for every recipient.

Run: `npm test -- tests/rooms.test.ts tests/socket.test.ts && npm run typecheck`

Expected: PASS including duplicate, full room, non-host start, hidden cards and malformed payload cases.

- [ ] **Step 5: 提交联网服务**

```bash
git add zha-jin-hua/src/server zha-jin-hua/tests/rooms.test.ts zha-jin-hua/tests/socket.test.ts
git commit -m "feat: add authoritative multiplayer rooms"
```

### Task 6: 联网大厅、等待房间与实时牌桌

**Files:**
- Modify: `zha-jin-hua/src/client/App.tsx`
- Create: `zha-jin-hua/src/client/online/useOnlineGame.ts`
- Create: `zha-jin-hua/src/client/components/OnlineLobby.tsx`
- Create: `zha-jin-hua/src/client/components/WaitingRoom.tsx`
- Create: `zha-jin-hua/src/client/components/ConnectionBanner.tsx`
- Modify: `zha-jin-hua/src/client/components/GameTable.tsx`
- Modify: `zha-jin-hua/src/client/styles.css`
- Test: `zha-jin-hua/tests/online-ui.test.tsx`

**Interfaces:**
- Consumes: Socket protocol and controlled `GameTable`.
- Produces: `useOnlineGame()` with lobby, room and game snapshots plus create/join/start/act/leave commands.

- [ ] **Step 1: 写创建、加入错误、房主开始与房间码复制测试**

```tsx
it('creates a room and shows a shareable room code', async () => {
  render(<App socketFactory={() => fakeSocket} />);
  await userEvent.click(screen.getByRole('button', { name: '联网房间' }));
  await userEvent.type(screen.getByLabelText('昵称'), '阿林');
  await userEvent.click(screen.getByRole('button', { name: '创建房间' }));
  fakeSocket.serverEmit('room:snapshot', roomSnapshot({ code: 'A7K9Q2', hostId: 'p1' }));
  expect(screen.getByText('A7K9Q2')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '复制房间码' })).toBeEnabled();
});
```

Run: `npm test -- tests/online-ui.test.tsx`

Expected: FAIL because online screens do not exist.

- [ ] **Step 2: 实现联网状态 Hook 和会话持久化**

```ts
export interface OnlineController {
  phase: 'lobby' | 'waiting' | 'playing' | 'result';
  room: RoomSnapshot | null;
  game: PlayerGameView | null;
  connection: 'online' | 'reconnecting' | 'offline';
  error: string | null;
  createRoom(nickname: string): Promise<void>;
  joinRoom(nickname: string, roomCode: string): Promise<void>;
  startGame(): Promise<void>;
  dispatch(action: GameAction): Promise<void>;
  leaveRoom(): void;
}
```

Store only the session token in `localStorage`; on connection emit `session:resume`, replace stale local state with server snapshots, lock action buttons while disconnected, and render stable Chinese messages from `request:error`.

- [ ] **Step 3: 实现大厅、等待房间和共享联网牌桌**

`OnlineLobby` validates nickname and six-character room code before submission. `WaitingRoom` shows 2～6 seats, online/offline badges, host badge, copy button and a host-only start button enabled at two players. During play, render the same `GameTable` used by solo mode with the server-provided view.

Run: `npm test -- tests/online-ui.test.tsx && npm run typecheck`

Expected: PASS for create, join, duplicate-name error, host-only start, reconnect banner and action lock.

- [ ] **Step 4: 提交联网客户端**

```bash
git add zha-jin-hua/src/client zha-jin-hua/tests/online-ui.test.tsx
git commit -m "feat: add multiplayer lobby and live table"
```

### Task 7: 倒计时、断线淘汰与房间生命周期

**Files:**
- Modify: `zha-jin-hua/src/server/rooms.ts`
- Modify: `zha-jin-hua/src/server/socket.ts`
- Modify: `zha-jin-hua/src/client/components/GameTable.tsx`
- Modify: `zha-jin-hua/src/client/styles.css`
- Test: `zha-jin-hua/tests/lifecycle.test.ts`

**Interfaces:**
- Consumes: room and game snapshots.
- Produces: `turnDeadline` in game views, `disconnectDeadline` in room seats, timer scheduling and safe cleanup.

- [ ] **Step 1: 使用假时钟写 30 秒自动弃牌与 60 秒座位保留测试**

```ts
it('folds the current player after the 30 second deadline', () => {
  vi.useFakeTimers();
  const room = startedRoom();
  vi.advanceTimersByTime(30_001);
  expect(room.game?.players.find((p) => p.id === firstPlayerId)?.status).toBe('folded');
});

it('restores a disconnected seat before 60 seconds and expires it afterwards', () => {
  vi.useFakeTimers();
  const token = connectedPlayerToken();
  disconnectPlayer();
  vi.advanceTimersByTime(59_000);
  expect(() => roomManager.resume(token)).not.toThrow();
  disconnectPlayer();
  vi.advanceTimersByTime(60_001);
  expect(() => roomManager.resume(token)).toThrowError('SESSION_EXPIRED');
});
```

Run: `npm test -- tests/lifecycle.test.ts`

Expected: FAIL before lifecycle timers are implemented.

- [ ] **Step 2: 实现可取消计时器与截止时间快照**

Keep one turn timer per active room; cancel it on every accepted action, settlement and room deletion. Publish absolute epoch deadlines so clients render countdowns without mutating authority. On disconnected-seat expiry, fold an active player, remove an idle player, transfer host if needed, broadcast a fresh snapshot and delete empty rooms.

Run: `npm test -- tests/lifecycle.test.ts tests/socket.test.ts && npm run typecheck`

Expected: PASS with fake timers and no open-handle warnings.

- [ ] **Step 3: 在座位和中央状态区渲染倒计时与离线剩余时间**

```tsx
<output aria-live="polite" aria-label="行动剩余时间">
  {Math.max(0, Math.ceil((view.turnDeadline - now) / 1000))} 秒
</output>
```

Use a local 250 ms display interval only; never auto-submit from the client. Add text labels “行动中”“重连中”“已离线” alongside icons.

Run: `npm test && npm run typecheck`

Expected: all unit and component tests PASS.

- [ ] **Step 4: 提交生命周期支持**

```bash
git add zha-jin-hua/src/server zha-jin-hua/src/client zha-jin-hua/tests/lifecycle.test.ts
git commit -m "feat: add turn deadlines and reconnect lifecycle"
```

### Task 8: 动效、声音、无障碍与浏览器验收

**Files:**
- Modify: `zha-jin-hua/src/client/components/PlayingCard.tsx`
- Modify: `zha-jin-hua/src/client/components/PlayerSeat.tsx`
- Modify: `zha-jin-hua/src/client/components/GameTable.tsx`
- Create: `zha-jin-hua/src/client/game/useSound.ts`
- Create: `zha-jin-hua/src/client/components/SoundToggle.tsx`
- Modify: `zha-jin-hua/src/client/styles.css`
- Create: `zha-jin-hua/playwright.config.ts`
- Create: `zha-jin-hua/e2e/solo.spec.ts`
- Create: `zha-jin-hua/e2e/online.spec.ts`
- Create: `zha-jin-hua/e2e/mobile.spec.ts`

**Interfaces:**
- Consumes: finished solo and online flows.
- Produces: user-toggleable Web Audio cues, reduced-motion-safe transitions and browser acceptance evidence.

- [ ] **Step 1: 添加发牌、看牌、筹码与获胜过渡以及声音开关**

```ts
export interface SoundController {
  enabled: boolean;
  toggle(): void;
  play(cue: 'deal' | 'chip' | 'flip' | 'win'): void;
}
```

Use a lazily-created Web Audio oscillator/gain graph so no binary audio assets are required. Persist the setting, default to off until user interaction, and silently catch unavailable audio contexts. Animate only `transform` and `opacity`, with durations between 150 and 450 ms.

- [ ] **Step 2: 写单机完整一局和双客户端联网一局测试**

```ts
test('a player can finish a solo round and start the next one', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '单机对战' }).click();
  while (await page.getByRole('button', { name: '弃牌' }).isVisible()) {
    await page.getByRole('button', { name: '弃牌' }).click();
  }
  await expect(page.getByRole('dialog', { name: '本局结算' })).toBeVisible();
  await page.getByRole('button', { name: '下一局' }).click();
  await expect(page.getByText('底池')).toBeVisible();
});
```

The online test uses two isolated browser contexts: host creates, guest joins by code, host starts, both take legal actions until the result dialog appears, then one page reloads and restores its seat within 60 seconds.

Run: `npx playwright install chromium && npm run test:e2e`

Expected: solo and online flows PASS in Chromium.

- [ ] **Step 3: 写 390×844 移动视口和桌面截图测试**

```ts
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
test('mobile table has no horizontal overflow and keeps actions visible', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '单机对战' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await expect(page.getByRole('region', { name: '操作区' })).toBeInViewport();
  await page.screenshot({ path: 'artifacts/zha-jin-hua-mobile.png', fullPage: true });
});
```

Add a 1440×900 desktop screenshot at `artifacts/zha-jin-hua-desktop.png`. Inspect both for overlaps, unreadable labels, missing cards and clipped controls; fix any glaring issue in `styles.css` and rerun once.

Run: `npm run test:e2e -- e2e/mobile.spec.ts`

Expected: PASS and both PNG files exist.

- [ ] **Step 4: 运行键盘与减少动态效果检查**

Tab through all actions, verify visible focus, open/close dialogs with keyboard, and run the mobile test with reduced motion emulation. Ensure status text remains understandable without color.

Run: `npm test && npm run typecheck && npm run build`

Expected: all tests PASS and `dist/client`, `dist/server/index.js` exist.

- [ ] **Step 5: 提交体验与端到端测试**

```bash
git add zha-jin-hua/src/client zha-jin-hua/playwright.config.ts zha-jin-hua/e2e zha-jin-hua/artifacts
git commit -m "feat: polish and verify responsive gameplay"
```

### Task 9: 生产部署、跨网络验证与交付文档

**Files:**
- Create: `zha-jin-hua/render.yaml`
- Create: `zha-jin-hua/README.md`
- Modify: `zha-jin-hua/src/server/index.ts`
- Modify: `zha-jin-hua/package.json`

**Interfaces:**
- Consumes: successful production build and browser tests.
- Produces: `/healthz`, Render deployment configuration, public HTTPS URL and reproducible operating instructions.

- [ ] **Step 1: 添加健康检查、动态端口与 SPA 静态回退**

```ts
const port = Number(process.env.PORT ?? 3001);
app.get('/healthz', (_request, response) => response.json({ ok: true }));
app.use(express.static(path.resolve('dist/client')));
app.get('/{*splat}', (_request, response) => response.sendFile(path.resolve('dist/client/index.html')));
httpServer.listen(port, '0.0.0.0');
```

Run: `npm run build && PORT=4173 npm start`

Expected: `curl http://127.0.0.1:4173/healthz` returns `{"ok":true}` and the root returns the game HTML.

- [ ] **Step 2: 创建 Render Web Service 配置**

```yaml
services:
  - type: web
    name: zha-jin-hua
    runtime: node
    plan: free
    rootDir: zha-jin-hua
    buildCommand: npm ci && npm run build
    startCommand: npm start
    healthCheckPath: /healthz
    envVars:
      - key: NODE_VERSION
        value: 22.17.0
```

Run: `git diff --check -- zha-jin-hua/render.yaml`

Expected: no whitespace errors.

- [ ] **Step 3: 编写完整运行与部署文档**

README must list exact commands `npm ci`, `npm run dev`, `npm test`, `npm run test:e2e`, `npm run build`, `npm start`; explain LAN access through the computer IP and port; state that all chips are virtual; document 30-second turns, 60-second reconnects and server-restart room loss; include Render Blueprint deployment steps.

Run: `rg -n "npm ci|npm run dev|npm test|npm run test:e2e|npm run build|npm start|虚拟筹码|30 秒|60 秒" README.md`

Expected: every required command and limitation is present.

- [ ] **Step 4: 执行最终本地完成审计**

```bash
npm ci
npm test
npm run typecheck
npm run build
npm run test:e2e
```

Expected: every command exits 0; evaluator, state machine, AI, room, lifecycle, UI and end-to-end suites all pass; desktop and mobile screenshots exist.

- [ ] **Step 5: 经用户授权连接部署平台并发布**

Create a Render Blueprint from `render.yaml`, wait for deployment health to become live, then open the HTTPS URL in two separate networks or browser contexts. Create a room, join it, start a round, perform actions to settlement, reload one client and verify session restoration.

Expected: public `/healthz` returns `{"ok":true}` and the cross-client round plus reconnect succeeds.

- [ ] **Step 6: 提交部署配置与文档**

```bash
git add zha-jin-hua/render.yaml zha-jin-hua/README.md zha-jin-hua/src/server/index.ts zha-jin-hua/package.json
git commit -m "docs: add production deployment and operations guide"
```

## Completion Evidence

- `npm test`: proves hand evaluation, state transitions, visibility, AI legality, room policy, Socket authorization and lifecycle timers.
- `npm run typecheck`: proves shared client/server contracts compile under strict TypeScript.
- `npm run build`: proves production client and Node server artifacts are generated.
- `npm run test:e2e`: proves a user can finish solo and network rounds and use the game at mobile dimensions.
- `artifacts/zha-jin-hua-desktop.png` and `artifacts/zha-jin-hua-mobile.png`: prove the final rendered desktop and phone layouts were inspected.
- Public HTTPS URL and `/healthz`: prove the game is deployed on a WebSocket-capable service.
- Two-client public smoke test plus reload: proves room join, authoritative play, settlement and reconnect operate outside the local development environment.
