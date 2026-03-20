/**
 * HTTP 工具函数
 */

export function isEnabledFlag(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function resolvePageAssetPath(request: Request): string | null {
  if (request.method !== 'GET') {
    return null;
  }

  const url = new URL(request.url);
  const pathname = url.pathname;

  if (
    pathname.startsWith('/api/') ||
    pathname === '/sub' ||
    pathname === '/health' ||
    pathname.startsWith('/assets/') ||
    pathname === '/favicon.ico' ||
    pathname === '/logo.png'
  ) {
    return null;
  }

  const pageMap: Record<string, string> = {
    '/': '/index.html',
    '/reset': '/reset.html',
    '/login': '/login.html',
    '/nav': '/nav.html',
    '/navigation': '/navigation.html',
    '/subscriptions': '/subscriptions.html',
    '/notes': '/notes.html',
    '/snippets': '/snippets.html',
    '/clipboard': '/clipboard.html',
    '/logs': '/logs.html',
    '/settings': '/settings.html'
  };

  return pageMap[pathname] ?? null;
}

export function enforceHttps(request: Request): Response | null {
  const url = new URL(request.url);
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    return null;
  }
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const cfVisitor = request.headers.get('cf-visitor');
  const isHttps =
    url.protocol === 'https:' ||
    forwardedProto === 'https' ||
    (cfVisitor ? cfVisitor.includes('"scheme":"https"') : false);

  if (isHttps) {
    return null;
  }

  return Response.redirect(ensureHttpsUrl(url.toString()), 308);
}

function ensureHttpsUrl(urlString: string): string {
  return urlString.replace(/^http:/, 'https:');
}

export async function readResponseTextWithLimit(
  response: Response,
  maxBytes: number,
  controller?: AbortController
): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    const bytes = getByteLength(text);
    if (bytes > maxBytes) {
      controller?.abort();
      throw new Error(`响应过大: ${bytes} 字节（限制 ${maxBytes}）`);
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }
    bytesRead += value.byteLength;
    if (bytesRead > maxBytes) {
      controller?.abort();
      throw new Error(`响应过大: ${bytesRead} 字节（限制 ${maxBytes}）`);
    }
    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  return text;
}

export async function readResponseBytesWithLimit(
  response: Response,
  maxBytes: number,
  controller?: AbortController
): Promise<Uint8Array> {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      controller?.abort();
      throw new Error(`响应过大: ${bytes.byteLength} 字节（限制 ${maxBytes}）`);
    }
    return bytes;
  }

  const reader = response.body.getReader();
  let bytesRead = 0;
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }
    bytesRead += value.byteLength;
    if (bytesRead > maxBytes) {
      controller?.abort();
      throw new Error(`响应过大: ${bytesRead} 字节（限制 ${maxBytes}）`);
    }
    chunks.push(value);
  }

  const result = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return result;
}

function getByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}
