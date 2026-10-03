export type RateLimit = {
  /** Events allowed in a burst (bucket size). */
  burst: number;
  /** Sustained events per second (refill rate). */
  perSecond: number;
};

/** Token bucket: `take()` spends one token and reports whether the event is allowed. */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly limit: RateLimit,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = limit.burst;
    this.last = now();
  }

  take(): boolean {
    const t = this.now();
    const elapsedSec = Math.max(0, t - this.last) / 1000;
    this.last = t;
    this.tokens = Math.min(this.limit.burst, this.tokens + elapsedSec * this.limit.perSecond);
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
