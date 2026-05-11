type CacheEntry<T> = {
  data: T;
  expires: number;
};

const cache = new Map<string, CacheEntry<unknown>>();
const pending = new Map<string, Promise<unknown>>();

export async function getCached<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (entry && entry.expires > now) {
    return entry.data;
  }

  const inFlight = pending.get(key) as Promise<T> | undefined;
  if (inFlight) {
    return inFlight;
  }

  const request = loader()
    .then((data) => {
      cache.set(key, { data, expires: now + ttlMs });
      return data;
    })
    .finally(() => {
      pending.delete(key);
    });

  pending.set(key, request);
  return request;
}

export function setCached<T>(key: string, data: T, ttlMs: number) {
  cache.set(key, { data, expires: Date.now() + ttlMs });
}

export function invalidateCached(key: string) {
  cache.delete(key);
  pending.delete(key);
}
