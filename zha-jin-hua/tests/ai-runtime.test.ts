// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { CircuitBreaker, FixedWindowLimiter, loadAiRuntimeConfig } from '../src/server/ai/runtime';

describe('AI runtime protection', () => {
  it('parses defaults without exposing the key', () => {
    expect(loadAiRuntimeConfig({ DEEPSEEK_API_KEY: 'secret' })).toMatchObject({
      enabled: true,
      model: 'deepseek-v4-flash',
      timeoutMs: 3000,
      perIpPerMinute: 30,
      globalPerHour: 300,
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
    breaker.failure();
    breaker.failure();
    breaker.failure();
    expect(breaker.canRequest()).toBe(false);
    now += 30_001;
    expect(breaker.canRequest()).toBe(true);
    expect(breaker.canRequest()).toBe(false);
    breaker.success();
    expect(breaker.canRequest()).toBe(true);
  });
});
