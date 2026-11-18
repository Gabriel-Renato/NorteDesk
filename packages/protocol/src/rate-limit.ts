export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly maxHits: number,
    private readonly windowMs: number,
  ) {}

  tryConsume(key: string, now = Date.now()): { allowed: boolean; retryAfterMs: number } {
    const cutoff = now - this.windowMs;
    const prev = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (prev.length >= this.maxHits) {
      const oldest = prev[0] ?? now;
      return { allowed: false, retryAfterMs: Math.max(0, oldest + this.windowMs - now) };
    }
    prev.push(now);
    this.hits.set(key, prev);
    return { allowed: true, retryAfterMs: 0 };
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  prune(now = Date.now()): void {
    const cutoff = now - this.windowMs;
    for (const [key, times] of this.hits) {
      const next = times.filter((t) => t > cutoff);
      if (next.length === 0) this.hits.delete(key);
      else this.hits.set(key, next);
    }
  }
}

/** Agrupa movimentos de mouse: mantém apenas o mais recente por janela. */
export class MouseMoveCoalescer {
  private last: { x: number; y: number; ts: number } | null = null;
  private lastEmit = 0;

  constructor(private readonly minIntervalMs: number) {}

  push(x: number, y: number, ts: number): { x: number; y: number; ts: number } | null {
    this.last = { x, y, ts };
    if (ts - this.lastEmit < this.minIntervalMs) {
      return null;
    }
    this.lastEmit = ts;
    const out = this.last;
    this.last = null;
    return out;
  }

  flush(): { x: number; y: number; ts: number } | null {
    const out = this.last;
    this.last = null;
    if (out) this.lastEmit = out.ts;
    return out;
  }
}
