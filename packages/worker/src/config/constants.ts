/**
 * Shared KV / D1 app_meta key constants.
 * Single source of truth — import from here instead of redefining locally.
 */
export const APP_KEYS = {
  subToken: 'config:sub-token',
  aggregateMeta: 'config:aggregate-meta',
  navigationSeeded: 'config:navigation-seeded',
  sourceIndex: 'source:index',
  logsRecent: 'logs:recent',
  navCategoryIndex: 'nav:category:index',
  noteIndex: 'note:index',
  snippetIndex: 'snippet:index',
  clipboardIndex: 'clipboard:index',
  refreshLock: 'lock:refresh-aggregate',
  settingsImportLock: 'lock:settings-import',
  kvToD1Migrated: 'migration:kv-to-d1-v1'
} as const;

export const CACHE_KEYS = {
  nodes: 'cache:nodes',
  format: (format: string) => `cache:format:${format}`,
  favicon: (hostname: string) => `favicon:${hostname}`
} as const;
