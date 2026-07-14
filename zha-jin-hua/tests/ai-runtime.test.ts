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

  it('falls back when a numeric setting is not a positive safe integer', () => {
    expect(loadAiRuntimeConfig({
      DEEPSEEK_API_KEY: 'secret',
      AI_TIMEOUT_MS: '0.5',
      AI_MAX_REQUESTS_PER_HOUR: `${Number.MAX_SAFE_INTEGER + 1}`,
    })).toMatchObject({ timeoutMs: 3000, globalPerHour: 300 });
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

  it('evicts expired unique-key windows while accepting new traffic', () => {
    let now = 1000;
    const limiter = new FixedWindowLimiter(() => now);
    limiter.take('ip:a', 1, 60_000);
    limiter.take('ip:b', 1, 60_000);
    limiter.take('ip:c', 1, 60_000);
    expect(limiter.sizeForTesting).toBe(3);

    now += 60_001;
    limiter.take('ip:fresh', 1, 60_000);

    expect(limiter.sizeForTesting).toBe(1);
  });

  it('checks and commits composite limits atomically', () => {
    const limiter = new FixedWindowLimiter();
    const take = (ip: string) => limiter.takeAll([
      { key: 'global', limit: 2, windowMs: 3_600_000 },
      { key: `ip:${ip}`, limit: 1, windowMs: 60_000 },
    ]);

    expect(take('a')).toBe(true);
    expect(take('a')).toBe(false);
    expect(take('b')).toBe(true);
    expect(take('c')).toBe(false);
    expect(limiter.sizeForTesting).toBe(3);
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

  it('releases a half-open probe after caller cancellation without recording a failure', () => {
    let now = 1000;
    const breaker = new CircuitBreaker(1, 30_000, () => now);
    breaker.failure();
    now += 30_001;

    expect(breaker.canRequest()).toBe(true);
    breaker.cancel();
    expect(breaker.canRequest()).toBe(true);
  });
});
