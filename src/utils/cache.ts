interface CacheItem<T = any> {
  data: T;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
}

class SimpleCache {
  private cache: Map<string, CacheItem> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Clean up expired items every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
  }

  /**
   * Set item in cache with TTL
   */
  set<T>(key: string, data: T, ttlMs: number = 5 * 60 * 1000): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttlMs
    });
  }

  /**
   * Get item from cache
   */
  get<T>(key: string): T | null {
    const item = this.cache.get(key);
    
    if (!item) {
      return null;
    }

    // Check if item is expired
    if (Date.now() - item.timestamp > item.ttl) {
      this.cache.delete(key);
      return null;
    }

    return item.data;
  }

  /**
   * Delete item from cache
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Check if item exists and is not expired
   */
  has(key: string): boolean {
    const item = this.cache.get(key);
    
    if (!item) {
      return false;
    }

    // Check if item is expired
    if (Date.now() - item.timestamp > item.ttl) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Clear all cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    keys: string[];
  } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }

  /**
   * Clean up expired items
   */
  private cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, item] of this.cache.entries()) {
      if (now - item.timestamp > item.ttl) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => this.cache.delete(key));
    
    if (keysToDelete.length > 0) {
      console.log(`🧹 Cache cleanup: removed ${keysToDelete.length} expired items`);
    }
  }

  /**
   * Destroy cache and cleanup interval
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.clear();
  }
}

// Create singleton instance
export const cache = new SimpleCache();

// Cache middleware for Express
export const cacheMiddleware = (ttlMs: number = 5 * 60 * 1000) => {
  return (req: any, res: any, next: any) => {
    const key = `cache_${req.method}_${req.originalUrl}`;
    
    // Try to get from cache
    const cached = cache.get(key);
    if (cached) {
      console.log(`🎯 Cache HIT: ${key}`);
      return res.json(cached);
    }
    
    console.log(`❌ Cache MISS: ${key}`);
    
    // Override res.json to cache the response
    const originalJson = res.json;
    res.json = function(data: any) {
      cache.set(key, data, ttlMs);
      return originalJson.call(this, data);
    };
    
    next();
  };
};

// Helper functions for common cache patterns
export const cacheHelpers = {
  // Cache products for 10 minutes
  cacheProducts: (products: any[]) => {
    cache.set('products_all', products, 10 * 60 * 1000);
  },
  
  getProducts: () => {
    return cache.get('products_all');
  },
  
  // Cache proteins for 10 minutes
  cacheProteins: (proteins: any[]) => {
    cache.set('proteins_all', proteins, 10 * 60 * 1000);
  },
  
  getProteins: () => {
    return cache.get('proteins_all');
  },
  
  // Cache menu (products + proteins) for 5 minutes
  cacheMenu: (menu: any) => {
    cache.set('menu_combined', menu, 5 * 60 * 1000);
  },
  
  getMenu: () => {
    return cache.get('menu_combined');
  },
  
  // Invalidate related caches
  invalidateProducts: () => {
    cache.delete('products_all');
    cache.delete('menu_combined');
    console.log('🗑️ Invalidated product caches');
  },
  
  invalidateProteins: () => {
    cache.delete('proteins_all');
    console.log('🗑️ Invalidated protein caches');
  },
  
  clearAll: () => {
    cache.clear();
    console.log('🗑️ Cleared all caches');
  }
};
