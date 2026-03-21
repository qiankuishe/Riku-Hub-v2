/**
 * External API endpoint constants.
 * Centralised here so they can be updated in one place.
 */
export const API_ENDPOINTS = {
  telegram: {
    /** Base URL for Telegram Bot API calls. Append /<method> after the token segment. */
    base: (token: string) => `https://api.telegram.org/bot${token}`,
    /** Direct file download base URL. */
    file: (token: string) => `https://api.telegram.org/file/bot${token}`
  },
  dns: {
    /** Cloudflare DNS-over-HTTPS resolver. */
    cloudflare: 'https://cloudflare-dns.com/dns-query'
  },
  favicon: {
    /** Google favicon service. */
    google: (hostname: string) =>
      `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(hostname)}`,
    /** Gstatic favicon service (fallback). */
    gstatic: (hostname: string) =>
      `https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(`https://${hostname}`)}&size=64`
  }
} as const;
