export interface AiRuntimeConfig {
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  perIpPerMinute: number;
  globalPerHour: number;
  breakerFailures: number;
  breakerCooldownMs: number;
}

function positive(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
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
  private readonly windows = new Map<string, { expiresAt: number; count: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  get sizeForTesting(): number {
    return this.windows.size;
  }

  take(key: string, limit: number, windowMs: number): boolean {
    const current = this.now();
    this.prune(current);
    const window = this.windows.get(key);
    if (!window) {
      this.windows.set(key, { expiresAt: current + windowMs, count: 1 });
      return true;
    }
    if (window.count >= limit) return false;
    window.count += 1;
    return true;
  }

  private prune(current: number): void {
    for (const [key, window] of this.windows) {
      if (window.expiresAt <= current) this.windows.delete(key);
    }
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

  success(): void {
    this.failures = 0;
    this.openUntil = 0;
    this.probeInFlight = false;
  }

  failure(): void {
    this.failures += 1;
    this.probeInFlight = false;
    if (this.failures >= this.threshold) this.openUntil = this.now() + this.cooldownMs;
  }
}
