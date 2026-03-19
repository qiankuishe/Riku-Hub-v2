import type { NormalizedNode, OutputFormat } from './types';

export const OUTPUT_FORMAT_ALIASES: Record<string, OutputFormat> = {
  base64: 'base64',
  b64: 'base64',
  clash: 'clash',
  stash: 'stash',
  surge: 'surge',
  loon: 'loon',
  qx: 'qx',
  quantumult: 'qx',
  singbox: 'singbox',
  sb: 'singbox'
};

export const UA_FORMAT_MAP: Array<{ pattern: RegExp; format: OutputFormat }> = [
  { pattern: /clash/i, format: 'clash' },
  { pattern: /stash/i, format: 'stash' },
  { pattern: /surge/i, format: 'surge' },
  { pattern: /loon/i, format: 'loon' },
  { pattern: /quantumult/i, format: 'qx' },
  { pattern: /shadowrocket/i, format: 'base64' },
  { pattern: /sing-?box/i, format: 'singbox' }
];

export function detectFormatFromUserAgent(userAgent: string): OutputFormat {
  for (const { pattern, format } of UA_FORMAT_MAP) {
    if (pattern.test(userAgent)) {
      return format;
    }
  }
  return 'base64';
}

export function parseSubQuery(searchParams: URLSearchParams): { token: string | null; format: OutputFormat | null } {
  let token: string | null = null;
  let format: OutputFormat | null = null;

  // 优先从标准参数读取
  const tokenParam = searchParams.get('token');
  const formatParam = searchParams.get('format');
  
  if (tokenParam) {
    token = tokenParam;
  }
  
  if (formatParam) {
    const normalized = formatParam.toLowerCase();
    if (OUTPUT_FORMAT_ALIASES[normalized]) {
      format = OUTPUT_FORMAT_ALIASES[normalized];
    }
  }
  
  // 兼容旧格式：?{token}&clash
  if (!token || !format) {
    for (const key of searchParams.keys()) {
      const normalized = key.toLowerCase();
      if (OUTPUT_FORMAT_ALIASES[normalized]) {
        format = format || OUTPUT_FORMAT_ALIASES[normalized];
      } else if (!token && key !== 'token' && key !== 'format') {
        token = key;
      }
    }
  }

  return { token, format };
}

export function isHttpUrl(input: string): boolean {
  const trimmed = input.trim();
  return /^https?:\/\//i.test(trimmed);
}

export function fixUrl(rawUrl: string): string {
  return rawUrl.trim().replace(/^https?:\/\/https?:\/\//i, 'https://');
}

export function ensureHttpsUrl(input: string): string {
  const url = new URL(input);
  url.protocol = 'https:';
  return url.toString();
}

export function ensureUniqueNames<T extends NormalizedNode>(nodes: T[]): T[] {
  const counts = new Map<string, number>();
  return nodes.map((node) => {
    const count = counts.get(node.name) ?? 0;
    counts.set(node.name, count + 1);
    if (count === 0) {
      return node;
    }
    return { ...node, name: `${node.name} (${count + 1})` };
  });
}

export function getNodeIdentity(node: NormalizedNode): string {
  switch (node.type) {
    case 'vmess':
      return `vmess:${node.server}:${node.port}:${node.uuid}:${node.network ?? 'tcp'}:${node.tls ? '1' : '0'}:${node.sni ?? ''}:${node.wsPath ?? ''}:${node.wsHeaders?.Host ?? ''}:${node.grpcServiceName ?? ''}`;
    case 'vless':
      return `vless:${node.server}:${node.port}:${node.uuid}:${node.flow ?? ''}:${node.tls ? '1' : '0'}:${node.sni ?? ''}:${node.realityOpts?.publicKey ?? ''}:${node.realityOpts?.shortId ?? ''}:${node.network ?? 'tcp'}:${node.wsPath ?? ''}:${node.wsHeaders?.Host ?? ''}:${node.grpcServiceName ?? ''}`;
    case 'ss':
      return `ss:${node.server}:${node.port}:${node.cipher}:${node.password}:${node.plugin ?? ''}`;
    case 'trojan':
      return `trojan:${node.server}:${node.port}:${node.password}:${node.sni ?? ''}:${node.skipCertVerify ? '1' : '0'}:${node.network ?? 'tcp'}:${node.wsPath ?? ''}:${node.wsHeaders?.Host ?? ''}:${node.grpcServiceName ?? ''}`;
    case 'hysteria2':
      return `hy2:${node.server}:${node.port}:${node.password}:${node.sni ?? ''}:${node.obfs ?? ''}:${node.obfsPassword ?? ''}`;
    case 'tuic':
      return `tuic:${node.server}:${node.port}:${node.uuid}:${node.password}:${node.sni ?? ''}:${node.udpRelayMode ?? ''}`;
    case 'wireguard':
      return `wireguard:${node.server}:${node.port}:${node.publicKey}:${node.localAddress.join(',')}:${node.clientId ?? ''}`;
  }
}

export function deduplicateNodes(nodes: NormalizedNode[]): { nodes: NormalizedNode[]; duplicateCount: number } {
  const seen = new Set<string>();
  const result: NormalizedNode[] = [];
  let duplicateCount = 0;

  for (const node of nodes) {
    const identity = getNodeIdentity(node);
    if (seen.has(identity)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(identity);
    result.push(node);
  }

  return { nodes: result, duplicateCount };
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function randomId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const value = Array.from(bytes, (part) => part.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${value}`;
}
