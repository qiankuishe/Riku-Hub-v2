import { clearFaviconCache } from './faviconCache';

async function clearCacheStorage() {
  if (typeof window === 'undefined' || !('caches' in window)) {
    return;
  }

  try {
    const cacheNames = await window.caches.keys();
    await Promise.allSettled(cacheNames.map((cacheName) => window.caches.delete(cacheName)));
  } catch {
    // ignore Cache Storage failures
  }
}

export function restartCurrentSection() {
  if (typeof window === 'undefined') {
    return;
  }

  void (async () => {
    try {
      window.sessionStorage.clear();
    } catch {
      // ignore sessionStorage failures
    }

    try {
      window.localStorage.clear();
    } catch {
      // ignore localStorage failures
    }

    await Promise.allSettled([clearFaviconCache(), clearCacheStorage()]);

    if ('clearResourceTimings' in window.performance) {
      window.performance.clearResourceTimings();
    }

    window.location.reload();
  })();
}
