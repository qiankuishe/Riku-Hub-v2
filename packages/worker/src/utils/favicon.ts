/**
 * Favicon 服务工具函数
 */

import { readResponseBytesWithLimit } from './http';
import { assertSafeUrl } from './ssrf';

// 常量
const MAX_FAVICON_BYTES = 512 * 1024; // 512KB
const FAVICON_CACHE_TTL_SECONDS = 7 * 24 * 3600; // 7 天

// 类型定义
interface Env {
  CACHE_KV: KVNamespace;
}

interface CacheKeys {
  favicon: (hostname: string) => string;
}

const CACHE_KEYS: CacheKeys = {
  favicon: (hostname: string) => `favicon:${hostname}`
};

/**
 * 获取并缓存 Favicon
 */
export async function fetchAndCacheFavicon(env: Env, hostname: string): Promise<string | null> {
  const faviconSources = [
    `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(hostname)}`,
    `https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(`https://${hostname}`)}&size=64`
  ];

  for (const source of faviconSources) {
    try {
      const result = await fetchFaviconSource(env, source);
      if (!result) {
        continue;
      }

      const payload = JSON.stringify({ dataUrl: result.dataUrl, cachedAt: Date.now(), source });
      await env.CACHE_KV.put(CACHE_KEYS.favicon(hostname), payload, { expirationTtl: FAVICON_CACHE_TTL_SECONDS });
      return result.dataUrl;
    } catch {
      // ignore favicon source failures and try the next one
    }
  }

  return null;
}

/**
 * 从指定 URL 获取 Favicon
 */
async function fetchFaviconSource(env: Env, rawUrl: string): Promise<{ dataUrl: string } | null> {
  const url = new URL(rawUrl);
  await assertSafeUrl(env, url);

  const response = await fetch(url.toString(), {
    headers: { 'User-Agent': 'Riku-Hub/0.1' },
    redirect: 'manual'
  });

  if (response.status >= 300 && response.status < 400) {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (!looksLikeFaviconContentType(contentType)) {
    return null;
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength && Number.parseInt(contentLength, 10) > MAX_FAVICON_BYTES) {
    return null;
  }

  const bytes = await readResponseBytesWithLimit(response, MAX_FAVICON_BYTES);
  if (!bytes.byteLength || bytes.byteLength > MAX_FAVICON_BYTES) {
    return null;
  }

  const mimeType = normalizeFaviconContentType(contentType);
  return {
    dataUrl: `data:${mimeType};base64,${toBase64(bytes)}`
  };
}

/**
 * 检查 Content-Type 是否像 Favicon
 */
function looksLikeFaviconContentType(contentType: string): boolean {
  if (!contentType) {
    return true;
  }

  return (
    contentType.startsWith('image/') ||
    contentType.includes('icon') ||
    contentType.includes('svg') ||
    contentType.includes('octet-stream')
  );
}

/**
 * 规范化 Favicon Content-Type
 */
function normalizeFaviconContentType(contentType: string): string {
  if (!contentType) {
    return 'image/png';
  }

  return contentType.split(';', 1)[0]?.trim() || 'image/png';
}

/**
 * 将字节数组转换为 Base64
 */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}
