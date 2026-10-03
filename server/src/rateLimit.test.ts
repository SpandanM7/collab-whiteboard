import { describe, expect, it } from 'vitest';
import { TokenBucket } from './rateLimit.ts';

describe('TokenBucket', () => {
  const setup = (burst: number, perSecond: number) => {
    let t = 0;
    const bucket = new TokenBucket({ burst, perSecond }, () => t);
    return { bucket, advance: (ms: number) => (t += ms) };
  };

  it('allows a burst, then rejects', () => {
    const { bucket } = setup(3, 10);
    expect([bucket.take(), bucket.take(), bucket.take(), bucket.take()]).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it('refills at the sustained rate', () => {
    const { bucket, advance } = setup(2, 10);
    bucket.take();
    bucket.take();
    expect(bucket.take()).toBe(false);
    advance(100); // 10/s -> one token per 100 ms
    expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(false);
  });

  it('never refills past the burst size', () => {
    const { bucket, advance } = setup(2, 10);
    advance(60_000);
    expect([bucket.take(), bucket.take(), bucket.take()]).toEqual([true, true, false]);
  });

  it('tolerates a clock that moves backwards', () => {
    let t = 1000;
    const bucket = new TokenBucket({ burst: 1, perSecond: 10 }, () => t);
    expect(bucket.take()).toBe(true);
    t = 0;
    expect(bucket.take()).toBe(false);
  });
});
