# Quality Guidelines

> Code quality standards for backend development.

---

## Overview

<!--
Document your project's quality standards here.

Questions to answer:
- What patterns are forbidden?
- What linting rules do you enforce?
- What are your testing requirements?
- What code review standards apply?
-->

(To be filled by the team)

---

## Forbidden Patterns

<!-- Patterns that should never be used and why -->

(To be filled by the team)

---

## Required Patterns

<!-- Patterns that must always be used -->

(To be filled by the team)

---

## Testing Requirements

<!-- What level of testing is expected -->

(To be filled by the team)

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)

---

## Scenario: Fallback AI gameplay changes

### 1. Scope / Trigger

Apply this contract when changing `legalActions`, `chooseAiAction`, hand evaluation,
or the client fallback path. The fallback AI is player-facing gameplay, so returning
legal actions is necessary but not sufficient; fixed-action exploits must also be tested.

### 2. Signatures

```ts
chooseAiAction(
  state: GameState,
  playerId: string,
  style: AiStyle,
  random?: () => number,
  memory?: readonly PublicMemoryEntry[],
): GameAction
```

`createAiDecisionService().decide(...)` must pass its public `memory` to
`chooseAiAction` whenever the model request falls back to local rules.

### 3. Contracts

- `legalActions.raiseAmounts` exposes only the next affordable table level.
- Viewed-hand decisions use complete hand strength, including tie breakers.
- Call decisions compare hand confidence with pot odds, not only remaining chips.
- The last opponent action in public memory remains available after the AI's own
  `look` action replaces `GameState.lastAction`.
- Every returned action must still be accepted by `applyAction`.

### 4. Validation & Error Matrix

- Finished game or non-acting player -> `AI_NOT_ACTING`.
- No affordable call/raise/compare -> return `fold`.
- Stale or illegal model action -> client uses the rule strategy with the same memory.
- Strong viewed hand at the raise ceiling -> call or compare; never fold only because
  `raiseAmounts` is empty.

### 5. Good / Base / Bad Cases

- Good: a viewed competitive hand remembers the opponent's raise after looking and compares.
- Base: an unviewed cautious AI sometimes looks and sometimes calls.
- Bad: all high-card hands share one category score and therefore always make the same decision.

### 6. Tests Required

- Unit: every style returns an action accepted by `applyAction`.
- Unit: strong and weak high-card hands diverge under identical pressure.
- Unit: public memory preserves raise pressure after a `look` action.
- Simulation: seeded repeated blind raises stay at or below the documented win-rate ceiling.
- E2E: the solo game continues when `/api/ai/decision` is unavailable.

### 7. Wrong vs Correct

```ts
// Wrong: looking erases the pressure signal used by the fallback strategy.
chooseAiAction(state, playerId, style, random);

// Correct: public action history crosses the client-to-strategy boundary.
chooseAiAction(state, playerId, style, random, memory);
```
