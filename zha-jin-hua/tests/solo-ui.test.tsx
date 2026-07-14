import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/client/App';
import type { AiDecisionService, AiTurnDecision } from '../src/client/game/aiDecisionService';

const AI_PACING_RANDOM = 0.999; // Valid [0, 1) input that rounds the AI delay to 800 ms.

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('solo game UI', () => {
  it('opens a playable solo table from the home screen', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByRole('heading', { name: '金局' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '单机对战' }));

    expect(screen.getByText('底池')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '操作区' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '看牌' })).toBeEnabled();
  });

  it('keeps the human cards face-down until the player looks', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: '单机对战' }));

    expect(screen.getAllByLabelText('自己的暗牌')).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: '看牌' }));

    expect(screen.getAllByLabelText(/自己的牌：/)).toHaveLength(3);
    expect(screen.queryByRole('button', { name: '看牌' })).not.toBeInTheDocument();
  });

  it('shows thinking and exposes validated dialogue to assistive technology', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(AI_PACING_RANDOM);
    let resolveDecision!: (value: Awaited<ReturnType<AiDecisionService['decide']>>) => void;
    const service: AiDecisionService = {
      decide: vi.fn(() => new Promise<AiTurnDecision>((resolve) => { resolveDecision = resolve; })),
    };
    render(<App soloDecisionService={service} />);
    fireEvent.click(screen.getByRole('button', { name: '单机对战' }));
    fireEvent.click(screen.getByRole('button', { name: /跟注 10/ }));
    await act(async () => vi.advanceTimersByTimeAsync(800));
    const cautiousSeat = screen.getByRole('article', { name: /青竹/ });
    const thinking = screen.getByText('正在思考…');
    expect(cautiousSeat).toContainElement(thinking);
    await act(async () => resolveDecision({
      source: 'deepseek',
      action: { type: 'fold', playerId: 'bot-cautious', turnId: 2 },
      dialogue: '这轮先观察。',
    }));
    const dialogue = screen.getByText('这轮先观察。');
    expect(cautiousSeat).toContainElement(dialogue);
    expect(dialogue).toHaveAttribute('aria-live', 'polite');
    await act(async () => vi.advanceTimersByTimeAsync(3500));
    expect(screen.queryByText('这轮先观察。')).not.toBeInTheDocument();
  });

  it('prefers thinking feedback over lingering dialogue in the matching seat', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(AI_PACING_RANDOM);
    let decisionCount = 0;
    const service: AiDecisionService = {
      decide: vi.fn((state, playerId) => {
        decisionCount += 1;
        if (decisionCount === 4) {
          return new Promise<AiTurnDecision>(() => undefined);
        }
        return Promise.resolve({
          source: 'deepseek' as const,
          action: { type: 'call' as const, playerId, turnId: state.turnId },
          dialogue: `${playerId}对白`,
        });
      }),
    };
    render(<App soloDecisionService={service} />);
    fireEvent.click(screen.getByRole('button', { name: '单机对战' }));
    fireEvent.click(screen.getByRole('button', { name: /跟注 10/ }));
    await act(async () => vi.advanceTimersByTimeAsync(800));
    await act(async () => vi.advanceTimersByTimeAsync(800));
    await act(async () => vi.advanceTimersByTimeAsync(800));
    fireEvent.click(screen.getByRole('button', { name: /跟注 10/ }));
    await act(async () => vi.advanceTimersByTimeAsync(800));

    const cautiousSeat = screen.getByRole('article', { name: /青竹/ });
    expect(within(cautiousSeat).getByText('正在思考…')).toBeInTheDocument();
    expect(screen.queryByText('bot-cautious对白')).not.toBeInTheDocument();
  });

  it('renders one degradation notice across consecutive fallback turns', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(AI_PACING_RANDOM);
    const service: AiDecisionService = {
      decide: vi.fn(async (state, playerId) => ({
        source: 'rule' as const,
        fallbackReason: 'TIMEOUT',
        action: { type: 'call' as const, playerId, turnId: state.turnId },
        dialogue: '本地策略接管。',
      })),
    };
    render(<App soloDecisionService={service} />);
    fireEvent.click(screen.getByRole('button', { name: '单机对战' }));
    fireEvent.click(screen.getByRole('button', { name: /跟注 10/ }));
    await act(async () => vi.advanceTimersByTimeAsync(800));
    await act(async () => vi.advanceTimersByTimeAsync(800));
    expect(service.decide).toHaveBeenCalledTimes(2);
    const notices = screen.getAllByText('AI 暂时走神，已由本地策略接管');
    expect(notices).toHaveLength(1);
    expect(notices[0].closest('.felt-table')).toBeNull();
  });

  it('opens rules from the home screen and can close them', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: '玩法规则' }));
    expect(screen.getByRole('dialog', { name: '玩法规则' })).toBeInTheDocument();
    expect(screen.getByText('豹子')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '关闭规则' }));
    expect(screen.queryByRole('dialog', { name: '玩法规则' })).not.toBeInTheDocument();
  });

  it('cancels a scheduled solo request when the player exits before it starts', async () => {
    vi.useFakeTimers();
    const decide = vi.fn<AiDecisionService['decide']>(() => new Promise<AiTurnDecision>(() => undefined));
    render(<App soloDecisionService={{ decide }} />);

    fireEvent.click(screen.getByRole('button', { name: '单机对战' }));
    fireEvent.click(screen.getByRole('button', { name: /^跟注/ }));
    fireEvent.click(screen.getByRole('button', { name: '退出牌桌' }));
    await act(async () => vi.advanceTimersByTimeAsync(800));

    expect(decide).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '单机对战' }));
    expect(screen.getByRole('button', { name: /^跟注 10$/ })).toBeEnabled();
    expect(screen.getByText('底池').parentElement?.querySelector('strong')).toHaveTextContent('40');
  });

  it('aborts a started solo request and starts fresh after leaving the table', async () => {
    vi.useFakeTimers();
    let resolveDecision!: (decision: AiTurnDecision) => void;
    let requestSignal: AbortSignal | undefined;
    const decide = vi.fn<AiDecisionService['decide']>((_state, _playerId, _style, _memory, signal) => {
      requestSignal = signal;
      return new Promise<AiTurnDecision>((resolve) => {
        resolveDecision = resolve;
      });
    });
    render(<App soloDecisionService={{ decide }} />);

    fireEvent.click(screen.getByRole('button', { name: '单机对战' }));
    fireEvent.click(screen.getByRole('button', { name: /^跟注/ }));
    await act(async () => vi.advanceTimersByTimeAsync(800));
    expect(decide).toHaveBeenCalledTimes(1);
    expect(requestSignal?.aborted).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: '退出牌桌' }));
    expect(requestSignal?.aborted).toBe(true);
    await act(async () => resolveDecision({
      source: 'rule',
      action: { type: 'fold', playerId: 'bot-cautious', turnId: 2 },
      dialogue: '不应留下。',
    }));
    await act(async () => vi.advanceTimersByTimeAsync(800));

    expect(decide).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '单机对战' }));
    expect(screen.getByRole('button', { name: /^跟注 10$/ })).toBeEnabled();
    expect(screen.getByText('底池').parentElement?.querySelector('strong')).toHaveTextContent('40');
  });
});
