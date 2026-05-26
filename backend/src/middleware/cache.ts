import { Request, Response, NextFunction } from 'express';

interface AuthRequest extends Request {
  user?: any;
}

// Simple in-memory cache for static/reference data
// In production, consider using Redis or a dedicated caching solution
const cache = new Map<string, { data: any; timestamp: number; ttl: number }>();

const CACHE_TTL = {
  SHORT: 5 * 60 * 1000, // 5 minutes
  MEDIUM: 15 * 60 * 1000, // 15 minutes
  LONG: 60 * 60 * 1000, // 1 hour
};

// Generate cache key from request
const generateCacheKey = (req: Request): string => {
  const userId = (req as any).user?.id || 'anonymous';
  const path = req.path;
  const query = JSON.stringify(req.query);
  return `${userId}:${path}:${query}`;
};

// Check if cache entry is valid
const isCacheValid = (entry: { timestamp: number; ttl: number }): boolean => {
  return Date.now() - entry.timestamp < entry.ttl;
};

// Cache middleware factory
export const cacheResponse = (ttl: number = CACHE_TTL.MEDIUM) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = generateCacheKey(req);
    const cached = cache.get(key);

    if (cached && isCacheValid(cached)) {
      console.log(`[Cache] HIT: ${key}`);
      return res.json(cached.data);
    }

    console.log(`[Cache] MISS: ${key}`);

    // Store original json method
    const originalJson = res.json.bind(res);

    // Override json method to cache response
    res.json = function(data: any) {
      cache.set(key, {
        data,
        timestamp: Date.now(),
        ttl
      });
      return originalJson(data);
    };

    next();
  };
};

// Invalidate cache for specific pattern
export const invalidateCache = (pattern: string) => {
  for (const key of cache.keys()) {
    if (key.includes(pattern)) {
      cache.delete(key);
      console.log(`[Cache] INVALIDATED: ${key}`);
    }
  }
};

// Invalidate cache for user
export const invalidateUserCache = (userId: string) => {
  for (const key of cache.keys()) {
    if (key.startsWith(`${userId}:`)) {
      cache.delete(key);
      console.log(`[Cache] INVALIDATED for user ${userId}: ${key}`);
    }
  }
};

// Clear all cache (use with caution)
export const clearAllCache = () => {
  const size = cache.size;
  cache.clear();
  console.log(`[Cache] CLEARED ALL: ${size} entries`);
};

// Get cache statistics
export const getCacheStats = () => {
  let hits = 0;
  let misses = 0;
  let expired = 0;

  for (const [key, entry] of cache.entries()) {
    if (isCacheValid(entry)) {
      hits++;
    } else {
      expired++;
    }
  }

  return {
    totalEntries: cache.size,
    validEntries: hits,
    expiredEntries: expired,
    size: JSON.stringify([...cache.entries()]).length
  };
};

// Clean up expired cache entries (run periodically)
export const cleanupExpiredCache = () => {
  let cleaned = 0;
  for (const [key, entry] of cache.entries()) {
    if (!isCacheValid(entry)) {
      cache.delete(key);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`[Cache] CLEANED: ${cleaned} expired entries`);
  }
  return cleaned;
};

// Schedule periodic cleanup (every 5 minutes)
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupExpiredCache, 5 * 60 * 1000);
}

export { CACHE_TTL };
