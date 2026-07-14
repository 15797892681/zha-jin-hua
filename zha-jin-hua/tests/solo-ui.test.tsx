import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/client/App';
import type { AiDecisionService, AiTurnDecision } from '../src/client/game/aiDecisionService';

afterEach(() => {
  vi.useRealTimers();
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
    let resolveDecision!: (value: Awaited<ReturnType<AiDecisionService['decide']>>) => void;
    const service: AiDecisionService = {
      decide: vi.fn(() => new Promise<AiTurnDecision>((resolve) => { resolveDecision = resolve; })),
    };
    render(<App soloDecisionService={service} />);
    fireEvent.click(screen.getByRole('button', { name: '单机对战' }));
    fireEvent.click(screen.getByRole('button', { name: /跟注 10/ }));
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
    render(<App soloDecisionService={service} />);
    fireEvent.click(screen.getByRole('button', { name: '单机对战' }));
    fireEvent.click(screen.getByRole('button', { name: /跟注 10/ }));
    await act(async () => vi.advanceTimersByTimeAsync(800));
    await act(async () => vi.advanceTimersByTimeAsync(800));
    expect(service.decide).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText('AI 暂时走神，已由本地策略接管')).toHaveLength(1);
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
