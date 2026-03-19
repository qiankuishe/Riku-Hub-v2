const DB_NAME = 'riku-hub-favicon-cache';
const STORE_NAME = 'favicons';
const DB_VERSION = 1;
const MAX_CACHE_SIZE = 50 * 1024 * 1024;
const EXPIRY_DAYS = 7;

interface FaviconCacheEntry {
  hostname: string;
  dataUrl: string;
  size: number;
  cachedAt: number;
  accessedAt: number;
}

let db: IDBDatabase | null = null;

async function openDB(): Promise<IDBDatabase> {
  if (db) {
    return db;
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'hostname' });
        store.createIndex('accessedAt', 'accessedAt', { unique: false });
      }
    };
  });
}

function getHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function isExpired(entry: FaviconCacheEntry): boolean {
  return Date.now() - entry.cachedAt > EXPIRY_DAYS * 24 * 60 * 60 * 1000;
}

export async function getFavicon(url: string): Promise<string | null> {
  try {
    const database = await openDB();
    const hostname = getHostname(url);

    return await new Promise((resolve) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(hostname);

      request.onsuccess = () => {
        const entry = request.result as FaviconCacheEntry | undefined;
        if (!entry || isExpired(entry)) {
          if (entry) {
            store.delete(hostname);
          }
          resolve(null);
          return;
        }

        entry.accessedAt = Date.now();
        store.put(entry);
        resolve(entry.dataUrl);
      };

      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function setFavicon(url: string, dataUrl: string): Promise<void> {
  try {
    const database = await openDB();
    const hostname = getHostname(url);
    const size = new Blob([dataUrl]).size;

    await ensureCacheSize(size);

    const entry: FaviconCacheEntry = {
      hostname,
      dataUrl,
      size,
      cachedAt: Date.now(),
      accessedAt: Date.now()
    };

    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(entry);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    // ignore cache write failures
  }
}

export async function clearFaviconCache(): Promise<void> {
  try {
    if (db) {
      db.close();
      db = null;
    }

    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  } catch {
    // ignore cache clear failures
  }
}

async function ensureCacheSize(newEntrySize: number): Promise<void> {
  try {
    const database = await openDB();

    await new Promise<void>((resolve) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('accessedAt');
      const request = index.openCursor();
      let totalSize = 0;
      const staleKeys: string[] = [];

      request.onsuccess = async (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          const entry = cursor.value as FaviconCacheEntry;
          if (isExpired(entry)) {
            staleKeys.push(entry.hostname);
          } else {
            totalSize += entry.size;
          }
          cursor.continue();
          return;
        }

        staleKeys.forEach((key) => store.delete(key));
        if (totalSize + newEntrySize > MAX_CACHE_SIZE) {
          void evictLRU(store, totalSize + newEntrySize - MAX_CACHE_SIZE).then(resolve);
          return;
        }
        resolve();
      };

      request.onerror = () => resolve();
    });
  } catch {
    // ignore cache cleanup failures
  }
}

async function evictLRU(store: IDBObjectStore, bytesToFree: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const index = store.index('accessedAt');
    const request = index.openCursor();
    let freedBytes = 0;

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor && freedBytes < bytesToFree) {
        const entry = cursor.value as FaviconCacheEntry;
        freedBytes += entry.size;
        cursor.delete();
        cursor.continue();
        return;
      }
      resolve();
    };

    request.onerror = () => resolve();
  });
}
