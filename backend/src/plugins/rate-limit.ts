import type { FastifyReply, FastifyRequest } from 'fastify';
import { Redis } from 'ioredis';
import { fail } from '../utils/response.js';

type RateLimitBucket = { count: number; resetAt: number };

export class RateLimiter {
  private buckets = new Map<string, RateLimitBucket>();
  private redis: Redis | null = null;
  
  constructor(redis: Redis | null) {
    this.redis = redis;
    setInterval(() => {
      const now = Date.now();
      for (const [key, bucket] of this.buckets) {
        if (bucket.resetAt <= now) this.buckets.delete(key);
      }
    }, 60_000).unref();
  }
  
  async consume(reply: FastifyReply, key: string, max: number, windowMs: number): Promise<boolean> {
    if (this.redis) {
      try {
        const redisKey = `rl:${key}`;
        const current = await this.redis!.incr(redisKey);
        if (current === 1) await this.redis!.pexpire(redisKey, windowMs);
        const ttl = await this.redis!.pttl(redisKey);
        reply.header('X-RateLimit-Limit', String(max));
        reply.header('X-RateLimit-Remaining', String(Math.max(0, max - current)));
        reply.header('X-RateLimit-Reset', String(Math.ceil((Date.now() + (ttl > 0 ? ttl : windowMs)) / 1000)));
        if (current > max) {
          reply.header('Retry-After', Math.max(1, Math.ceil((ttl > 0 ? ttl : windowMs) / 1000)));
          fail(reply, 429, 'Too many requests. Please try again later.');
          return false;
        }
        return true;
      } catch {
        // Fall through to in-memory
      }
    }
    return this.consumeMemory(reply, key, max, windowMs);
  }
  
  private consumeMemory(reply: FastifyReply, key: string, max: number, windowMs: number): boolean {
    const now = Date.now();
    for (const [bucketKey, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(bucketKey);
    }
    
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      reply.header('X-RateLimit-Limit', String(max));
      reply.header('X-RateLimit-Remaining', String(Math.max(0, max - 1)));
      reply.header('X-RateLimit-Reset', String(Math.ceil((now + windowMs) / 1000)));
      return true;
    }
    if (bucket.count >= max) {
      reply.header('Retry-After', Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)));
      fail(reply, 429, 'Too many requests. Please try again later.');
      return false;
    }
    bucket.count += 1;
    reply.header('X-RateLimit-Limit', String(max));
    reply.header('X-RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    reply.header('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
    return true;
  }
}
