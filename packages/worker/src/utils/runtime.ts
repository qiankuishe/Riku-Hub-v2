type NumberEnv = {
  MAX_LOG_ENTRIES?: string;
  AGGREGATE_TTL_SECONDS?: string;
};

type D1Env = {
  DB?: D1Database;
};

type MetaEnv = D1Env & {
  APP_KV: KVNamespace;
};

export function getMaxLogEntries(env: NumberEnv): number {
  return parseBoundedInteger(env.MAX_LOG_ENTRIES, 200, 10, 5_000);
}

export function getAggregateTtlSeconds(env: NumberEnv): number {
  return parseBoundedInteger(env.AGGREGATE_TTL_SECONDS, 3_600, 60, 86_400);
}

export function randomToken(byteLength = 24): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes, (part) => part.toString(16).padStart(2, '0')).join('');
}

export function hasD1<T extends D1Env>(env: T): env is T & { DB: D1Database } {
  return Boolean(env.DB);
}

export function getDatabase(env: D1Env): D1Database {
  if (!env.DB) {
    throw new Error('DB binding is missing. Connect your D1 database to the `DB` binding in Cloudflare Dashboard.');
  }
  return env.DB;
}

export async function getAppMetaValue(env: MetaEnv, key: string): Promise<string | null> {
  if (!hasD1(env)) {
    return env.APP_KV.get(`meta:${key}`);
  }
  const row = await getDatabase(env).prepare('SELECT value FROM app_meta WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setAppMetaValue(env: MetaEnv, key: string, value: string): Promise<void> {
  if (!hasD1(env)) {
    await env.APP_KV.put(`meta:${key}`, value);
    return;
  }
  await getDatabase(env)
    .prepare(
      `INSERT INTO app_meta (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at`
    )
    .bind(key, value, new Date().toISOString())
    .run();
}

function parseBoundedInteger(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  if (parsed < min) {
    return min;
  }
  if (parsed > max) {
    return max;
  }
  return parsed;
}
