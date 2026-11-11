import type { RequestHandler } from "express";

type Bucket = { count: number; resetAt: number };
type RateLimitOptions = { windowMs: number; max: number; message: string };

/** Lightweight per-process limiter for the demo. Use a shared store for multi-instance production deployments. */
export function createRateLimiter(options: RateLimitOptions): RequestHandler {
  const buckets = new Map<string, Bucket>();
  let lastSweep = 0;

  return (req, res, next) => {
    const now = Date.now();
    // Periodically discard expired keys so the map cannot grow indefinitely.
    if (now - lastSweep > options.windowMs) {
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(key);
      }
      lastSweep = now;
    }

    // Trust the framework's req.ip by default; do not trust arbitrary forwarded headers.
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const existing = buckets.get(key);
    const bucket = !existing || existing.resetAt <= now
      ? { count: 0, resetAt: now + options.windowMs }
      : existing;
    bucket.count += 1;
    buckets.set(key, bucket);

    res.setHeader("RateLimit-Limit", String(options.max));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, options.max - bucket.count)));
    res.setHeader("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > options.max) {
      res.status(429).json({ error: options.message });
      return;
    }
    next();
  };
}
