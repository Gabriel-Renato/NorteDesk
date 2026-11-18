import { describe, expect, it } from 'vitest';
import { SlidingWindowLimiter } from './rate-limit.js';

describe('limitação de tentativas', () => {
  it('bloqueia após atingir o máximo na janela', () => {
    const limiter = new SlidingWindowLimiter(3, 1000);
    const t0 = 1_000_000;
    expect(limiter.tryConsume('ip', t0).allowed).toBe(true);
    expect(limiter.tryConsume('ip', t0 + 1).allowed).toBe(true);
    expect(limiter.tryConsume('ip', t0 + 2).allowed).toBe(true);
    const blocked = limiter.tryConsume('ip', t0 + 3);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it('libera novamente após a janela', () => {
    const limiter = new SlidingWindowLimiter(1, 100);
    expect(limiter.tryConsume('a', 0).allowed).toBe(true);
    expect(limiter.tryConsume('a', 50).allowed).toBe(false);
    expect(limiter.tryConsume('a', 101).allowed).toBe(true);
  });
});
