import { describe, expect, it } from 'vitest';
import { SlidingWindowRateLimiter } from '../src/rate-limit';

describe('SlidingWindowRateLimiter', () => {
  it('limits repeated attempts and reports retry timing', () => {
    const limiter = new SlidingWindowRateLimiter(2, 1_000);
    expect(limiter.attempt('client', 100).allowed).toBe(true);
    expect(limiter.attempt('client', 200).allowed).toBe(true);
    expect(limiter.attempt('client', 300)).toEqual({
      allowed: false,
      remaining: 0,
      retryAfterMs: 800,
    });
    expect(limiter.attempt('client', 1_101).allowed).toBe(true);
  });

  it('isolates clients and supports reset after successful authentication', () => {
    const limiter = new SlidingWindowRateLimiter(1, 1_000);
    expect(limiter.attempt('one', 0).allowed).toBe(true);
    expect(limiter.attempt('one', 1).allowed).toBe(false);
    expect(limiter.attempt('two', 1).allowed).toBe(true);
    limiter.reset('one');
    expect(limiter.attempt('one', 2).allowed).toBe(true);
  });
});
