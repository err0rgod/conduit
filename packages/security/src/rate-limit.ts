export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
  remaining: number;
}

export class SlidingWindowRateLimiter {
  private readonly attempts = new Map<string, number[]>();

  public constructor(
    private readonly maximumAttempts: number,
    private readonly windowMs: number,
  ) {
    if (maximumAttempts < 1 || windowMs < 1) throw new Error('Rate-limit values must be positive.');
  }

  public attempt(key: string, now = Date.now()): RateLimitResult {
    const cutoff = now - this.windowMs;
    const recent = (this.attempts.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
    if (recent.length >= this.maximumAttempts) {
      this.attempts.set(key, recent);
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(1, recent[0] + this.windowMs - now),
      };
    }
    recent.push(now);
    this.attempts.set(key, recent);
    return {
      allowed: true,
      remaining: this.maximumAttempts - recent.length,
      retryAfterMs: 0,
    };
  }

  public reset(key: string): void {
    this.attempts.delete(key);
  }
}
