import YAML from 'yaml';
import type {
  AggregateWarning,
  Hysteria2Node,
  InputFormat,
  NormalizedNode,
  ParsedContent,
  ShadowsocksNode,
  TrojanNode,
  TuicNode,
  VlessNode,
  VmessNode,
  WireGuardNode
} from './types';
import { isHttpUrl } from './utils';

type ClashLikeProxy = Record<string, unknown>;
type SingboxOutbound = Record<string, unknown>;
const MIXED_TOKEN_PATTERN =
  /(?:https?:\/\/[^\s"'<>]+|(?:vmess|vless|ss|trojan|hysteria2|hy2|tuic|wireguard):\/\/[^\s"'<>]+)/gi;
const MAX_PARSE_WARNINGS = 200;

function warning(code: AggregateWarning['code'], message: string, context?: string): AggregateWarning {
  return { code, message, context };
}

function pushWarningWithCap(list: AggregateWarning[], next: AggregateWarning): void {
  if (list.length < MAX_PARSE_WARNINGS) {
    list.push(next);
    return;
  }
  if (list.length === MAX_PARSE_WARNINGS) {
    list.push(warning('parse-failed', '解析警告过多，后续内容已省略'));
  }
}

export function isNodeUri(input: string): boolean {
  return /^(vmess|vless|ss|trojan|hysteria2|hy2|tuic|wireguard):\/\//i.test(input.trim());
}

export function detectInputFormat(content: string): InputFormat {
  const trimmed = content.trim();
  if (!trimmed) {
    return 'unknown';
  }

  if (trimmed.includes('proxies:') || trimmed.startsWith('mixed-port:') || trimmed.startsWith('port:')) {
    return 'clash';
  }

  if (trimmed.startsWith('{') && (trimmed.includes('"outbounds"') || trimmed.includes('"inbounds"'))) {
    return 'singbox';
  }

  try {
    const decoded = decodeBase64Loose(trimmed);
    if (decoded.includes('://') || decoded.includes('proxies:') || decoded.includes('"outbounds"')) {
      return 'base64';
    }
  } catch {
    // noop
  }

  const lines = trimmed.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.some((line) => extractInlineTokens(line).some((token) => isNodeUri(token)))) {
    return 'base64';
  }

  return 'unknown';
}

export function parseMixedInput(content: string): {
  urls: string[];
  nodes: NormalizedNode[];
  warnings: AggregateWarning[];
} {
  const urls: string[] = [];
  const nodes: NormalizedNode[] = [];
  const warnings: AggregateWarning[] = [];

  for (const line of content.split('\n').map((value) => value.trim()).filter(Boolean)) {
    const tokens = extractInlineTokens(line);
    if (!tokens.length) {
      pushWarningWithCap(warnings, warning('parse-failed', `忽略无法识别的输入: ${line.slice(0, 40)}`, line));
      continue;
    }

    for (const token of tokens) {
      if (isHttpUrl(token)) {
        urls.push(token);
        continue;
      }

      if (!isNodeUri(token)) {
        pushWarningWithCap(warnings, warning('parse-failed', `忽略无法识别的输入: ${token.slice(0, 40)}`, token));
        continue;
      }

      const parsed = parseUri(token);
      if (parsed) {
        nodes.push(parsed);
      } else {
        pushWarningWithCap(warnings, warning('parse-failed', `无法解析节点 URI: ${token.slice(0, 40)}`, token));
      }
    }
  }

  return { urls: Array.from(new Set(urls)), nodes, warnings };
}

export function parseContent(content: string, format?: InputFormat): ParsedContent {
  const actualFormat = format ?? detectInputFormat(content);
  switch (actualFormat) {
    case 'base64':
      return parseBase64Content(content);
    case 'clash':
      return parseClashContent(content);
    case 'singbox':
      return parseSingboxContent(content);
    default:
      return { nodes: [], warnings: [warning('parse-failed', '无法识别订阅内容格式')] };
  }
}

export function parseBase64Content(content: string): ParsedContent {
  let decoded = content.trim();
  try {
    decoded = decodeBase64Loose(content.trim());
  } catch {
    decoded = content;
  }

  const { nodes, warnings } = parseMixedInput(decoded);
  return { nodes, warnings };
}

export function parseClashContent(content: string): ParsedContent {
  try {
    const parsed = YAML.parse(content) as { proxies?: ClashLikeProxy[] };
    const proxies = parsed?.proxies ?? [];
    const nodes: NormalizedNode[] = [];
    const warnings: AggregateWarning[] = [];

    for (const proxy of proxies) {
      const node = sanitizeNode(convertClashProxy(proxy));
      if (node) {
        nodes.push(node);
      } else {
        pushWarningWithCap(warnings, warning('unsupported-protocol', `Clash 中存在未支持协议: ${String(proxy.type ?? 'unknown')}`));
      }
    }

    return { nodes, warnings };
  } catch (error) {
    return { nodes: [], warnings: [warning('parse-failed', `Clash 解析失败: ${String(error)}`)] };
  }
}

export function parseSingboxContent(content: string): ParsedContent {
  try {
    const parsed = JSON.parse(content) as { outbounds?: SingboxOutbound[] };
    const outbounds = parsed?.outbounds ?? [];
    const nodes: NormalizedNode[] = [];
    const warnings: AggregateWarning[] = [];

    for (const outbound of outbounds) {
      const type = String(outbound.type ?? '');
      if (['direct', 'block', 'dns', 'selector', 'urltest'].includes(type)) {
        continue;
      }

      const node = sanitizeNode(convertSingboxOutbound(outbound));
      if (node) {
        nodes.push(node);
      } else {
        pushWarningWithCap(warnings, warning('unsupported-protocol', `SingBox 中存在未支持协议: ${type}`));
      }
    }

    return { nodes, warnings };
  } catch (error) {
    return { nodes: [], warnings: [warning('parse-failed', `SingBox 解析失败: ${String(error)}`)] };
  }
}

export function parseUri(uri: string): NormalizedNode | null {
  const trimmed = normalizeUriScheme(uri.trim());
  const lowered = trimmed.toLowerCase();
  try {
    if (lowered.startsWith('vmess://')) {
      return sanitizeNode(parseVmessUri(trimmed));
    }
    if (lowered.startsWith('vless://')) {
      return sanitizeNode(parseVlessUri(trimmed));
    }
    if (lowered.startsWith('ss://')) {
      return sanitizeNode(parseShadowsocksUri(trimmed));
    }
    if (lowered.startsWith('trojan://')) {
      return sanitizeNode(parseTrojanUri(trimmed));
    }
    if (lowered.startsWith('hysteria2://') || lowered.startsWith('hy2://')) {
      return sanitizeNode(parseHysteria2Uri(trimmed));
    }
    if (lowered.startsWith('tuic://')) {
      return sanitizeNode(parseTuicUri(trimmed));
    }
    if (lowered.startsWith('wireguard://')) {
      return sanitizeNode(parseWireGuardUri(trimmed));
    }
  } catch {
    return null;
  }
  return null;
}

function parseVmessUri(uri: string): VmessNode {
  const json = JSON.parse(decodeBase64Loose(uri.slice(8))) as Record<string, string>;
  return {
    type: 'vmess',
    name: json.ps || json.remarks || `VMess-${json.add}`,
    server: json.add,
    port: Number.parseInt(json.port, 10),
    uuid: json.id,
    alterId: Number.parseInt(json.aid || '0', 10),
    cipher: json.scy || 'auto',
    tls: json.tls === 'tls',
    sni: json.sni || json.host,
    network: (json.net as VmessNode['network']) || 'tcp',
    wsPath: json.path || undefined,
    wsHeaders: json.host ? { Host: json.host } : undefined
  };
}

function parseVlessUri(uri: string): VlessNode {
  const url = new URL(uri);
  const params = url.searchParams;
  const hostHeader = params.get('host') || params.get('Host');
  return {
    type: 'vless',
    name: decodeURIComponent(url.hash.slice(1)) || `VLESS-${url.hostname}`,
    server: url.hostname,
    port: Number.parseInt(url.port, 10),
    uuid: decodeURIComponent(url.username),
    flow: params.get('flow') || undefined,
    tls: params.get('security') === 'tls' || params.get('security') === 'reality',
    sni: params.get('sni') || undefined,
    skipCertVerify:
      params.get('allowInsecure') === '1' || params.get('allow_insecure') === '1' || params.get('insecure') === '1',
    network: (params.get('type') as VlessNode['network']) || 'tcp',
    wsPath: params.get('path') || undefined,
    wsHeaders: hostHeader ? { Host: hostHeader } : undefined,
    grpcServiceName: params.get('serviceName') || undefined,
    realityOpts:
      params.get('security') === 'reality'
        ? {
            publicKey: params.get('pbk') || '',
            shortId: params.get('sid') || undefined
          }
        : undefined
  };
}

function parseShadowsocksUri(uri: string): ShadowsocksNode | null {
  try {
    const hashIndex = uri.indexOf('#');
    const name = hashIndex > -1 ? decodeURIComponent(uri.slice(hashIndex + 1)) : '';
    const mainPart = hashIndex > -1 ? uri.slice(5, hashIndex) : uri.slice(5);
    const extracted = extractShadowsocksPlugin(mainPart);
    const payload = extracted.payload;

    // SIP002: ss://base64(method:password)@host:port
    if (payload.includes('@')) {
      const atIndex = payload.lastIndexOf('@');
      const credentialPart = payload.slice(0, atIndex);
      const endpointPart = payload.slice(atIndex + 1);
      const credentials = parseShadowsocksCredentials(credentialPart);
      const endpoint = parseServerEndpoint(endpointPart);
      if (!credentials || !endpoint) {
        return null;
      }

      return {
        type: 'ss',
        name: name || `SS-${endpoint.server}`,
        server: endpoint.server,
        port: endpoint.port,
        cipher: credentials.cipher,
        password: credentials.password,
        plugin: extracted.plugin
      };
    }

    // Legacy: ss://base64(method:password@host:port)
    const decoded = decodeBase64Loose(payload);
    const credentialAndEndpoint = decoded.trim();
    const atIndex = credentialAndEndpoint.lastIndexOf('@');
    if (atIndex === -1) {
      return null;
    }
    const credentials = parseShadowsocksCredentials(credentialAndEndpoint.slice(0, atIndex), true);
    const endpoint = parseServerEndpoint(credentialAndEndpoint.slice(atIndex + 1));
    if (!credentials || !endpoint) {
      return null;
    }

    return {
      type: 'ss',
      name: name || `SS-${endpoint.server}`,
      server: endpoint.server,
      port: endpoint.port,
      cipher: credentials.cipher,
      password: credentials.password,
      plugin: extracted.plugin
    };
  } catch {
    return null;
  }
}

function parseTrojanUri(uri: string): TrojanNode {
  const url = new URL(uri);
  const params = url.searchParams;
  const hostHeader = params.get('host') || params.get('Host');
  return {
    type: 'trojan',
    name: decodeURIComponent(url.hash.slice(1)) || `Trojan-${url.hostname}`,
    server: url.hostname,
    port: Number.parseInt(url.port, 10),
    password: decodeURIComponent(url.username),
    sni: params.get('sni') || url.hostname,
    skipCertVerify:
      params.get('allowInsecure') === '1' || params.get('allow_insecure') === '1' || params.get('insecure') === '1',
    network: (params.get('type') as TrojanNode['network']) || 'tcp',
    wsPath: params.get('path') || undefined,
    wsHeaders: hostHeader ? { Host: hostHeader } : undefined,
    grpcServiceName: params.get('serviceName') || undefined
  };
}

function parseHysteria2Uri(uri: string): Hysteria2Node {
  const normalized = uri.replace(/^hy2:\/\//i, 'hysteria2://');
  const url = new URL(normalized);
  const params = url.searchParams;
  return {
    type: 'hysteria2',
    name: decodeURIComponent(url.hash.slice(1)) || `Hysteria2-${url.hostname}`,
    server: url.hostname,
    port: Number.parseInt(url.port, 10),
    password: decodeURIComponent(url.username),
    obfs: params.get('obfs') || undefined,
    obfsPassword: params.get('obfs-password') || undefined,
    sni: params.get('sni') || url.hostname,
    skipCertVerify: params.get('insecure') === '1' || params.get('allowInsecure') === '1'
  };
}

function parseTuicUri(uri: string): TuicNode {
  const url = new URL(uri);
  const params = url.searchParams;
  return {
    type: 'tuic',
    name: decodeURIComponent(url.hash.slice(1)) || `TUIC-${url.hostname}`,
    server: url.hostname,
    port: Number.parseInt(url.port, 10),
    uuid: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    congestionControl: params.get('congestion_control') || 'bbr',
    alpn: params.get('alpn')?.split(',') || ['h3'],
    sni: params.get('sni') || url.hostname,
    skipCertVerify:
      params.get('allow_insecure') === '1' || params.get('allowInsecure') === '1' || params.get('insecure') === '1',
    udpRelayMode: params.get('udp_relay_mode') || undefined
  };
}

function parseWireGuardUri(uri: string): WireGuardNode {
  const decoded = JSON.parse(decodeBase64Loose(uri.slice('wireguard://'.length))) as Record<string, unknown>;
  return {
    type: 'wireguard',
    name: String(decoded.name ?? 'WireGuard'),
    server: String(decoded.server ?? ''),
    port: Number(decoded.port ?? 0),
    privateKey: decoded.privateKey ? String(decoded.privateKey) : undefined,
    publicKey: String(decoded.publicKey ?? ''),
    presharedKey: decoded.presharedKey ? String(decoded.presharedKey) : undefined,
    localAddress: Array.isArray(decoded.localAddress) ? decoded.localAddress.map(String) : [],
    dns: Array.isArray(decoded.dns) ? decoded.dns.map(String) : undefined,
    mtu: decoded.mtu ? Number(decoded.mtu) : undefined,
    reserved: Array.isArray(decoded.reserved) ? decoded.reserved.map((item) => Number(item)) : undefined,
    clientId: decoded.clientId ? String(decoded.clientId) : undefined
  };
}

function decodeBase64Loose(input: string): string {
  const normalized = normalizeBase64Input(input);
  const binary = atob(normalized);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function normalizeBase64Input(input: string): string {
  const compact = input.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const remainder = compact.length % 4;
  if (remainder === 0) {
    return compact;
  }
  return compact.padEnd(compact.length + (4 - remainder), '=');
}

function parseServerEndpoint(input: string): { server: string; port: number } | null {
  const endpoint = input.split('?', 1)[0]?.trim() ?? '';
  if (!endpoint) {
    return null;
  }

  if (endpoint.startsWith('[')) {
    const endBracketIndex = endpoint.indexOf(']');
    if (endBracketIndex === -1) {
      return null;
    }
    const server = endpoint.slice(1, endBracketIndex);
    const portPart = endpoint.slice(endBracketIndex + 1);
    if (!portPart.startsWith(':')) {
      return null;
    }
    const port = Number.parseInt(portPart.slice(1), 10);
    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
      return null;
    }
    return { server, port };
  }

  const lastColonIndex = endpoint.lastIndexOf(':');
  if (lastColonIndex === -1) {
    return null;
  }
  const server = endpoint.slice(0, lastColonIndex);
  const port = Number.parseInt(endpoint.slice(lastColonIndex + 1), 10);
  if (!server || !Number.isFinite(port) || port <= 0 || port > 65535) {
    return null;
  }
  return { server, port };
}

function parseShadowsocksCredentials(
  input: string,
  treatAsPlain = false
): { cipher: string; password: string } | null {
  const raw = treatAsPlain ? input : decodeShadowsocksCredentialInput(input);
  const colonIndex = raw.indexOf(':');
  if (colonIndex <= 0) {
    return null;
  }
  return {
    cipher: raw.slice(0, colonIndex),
    password: raw.slice(colonIndex + 1)
  };
}

function decodeShadowsocksCredentialInput(input: string): string {
  const decodedCandidate = safeDecodeURIComponent(input);
  if (decodedCandidate.includes(':')) {
    return decodedCandidate;
  }
  return decodeBase64Loose(input);
}

function extractShadowsocksPlugin(input: string): { payload: string; plugin?: string } {
  let payload = input.trim();
  let plugin: string | undefined;

  const legacyPluginPrefix = '/plugin=';
  const legacyPluginIndex = payload.indexOf(legacyPluginPrefix);
  if (legacyPluginIndex !== -1) {
    plugin = normalizeShadowsocksPlugin(payload.slice(legacyPluginIndex + 1));
    payload = payload.slice(0, legacyPluginIndex);
  }

  const queryIndex = payload.indexOf('?');
  if (queryIndex !== -1) {
    const query = payload.slice(queryIndex + 1);
    payload = payload.slice(0, queryIndex);
    const params = new URLSearchParams(query);
    const queryPlugin = params.get('plugin');
    if (queryPlugin) {
      plugin = normalizeShadowsocksPlugin(queryPlugin);
    }
  }

  return { payload: payload.replace(/\/+$/, ''), plugin };
}

function normalizeShadowsocksPlugin(input: string): string {
  const trimmed = input.trim();
  const decoded = safeDecodeURIComponent(trimmed);
  return decoded.startsWith('plugin=') ? decoded.slice('plugin='.length) : decoded;
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function buildShadowsocksPlugin(plugin: unknown, pluginOptions?: unknown): string | undefined {
  if (typeof plugin !== 'string' || !plugin.trim()) {
    return undefined;
  }
  const name = plugin.trim();
  const serializedOptions = serializePluginOptions(pluginOptions);
  return serializedOptions ? `${name};${serializedOptions}` : name;
}

function serializePluginOptions(options: unknown): string {
  if (!options) {
    return '';
  }
  if (typeof options === 'string') {
    return options.trim().replace(/^[?&]/, '');
  }
  if (typeof options !== 'object' || Array.isArray(options)) {
    return '';
  }
  return Object.entries(options as Record<string, unknown>)
    .map(([key, value]) => `${key}=${serializePluginOptionValue(value)}`)
    .join(';');
}

function serializePluginOptionValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(',');
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  return String(value ?? '');
}

function extractInlineTokens(line: string): string[] {
  const matches = line.match(MIXED_TOKEN_PATTERN) ?? [];
  return matches.map(sanitizeExtractedToken).filter(Boolean);
}

function sanitizeExtractedToken(token: string): string {
  let value = token.trim();
  while (/[，,；;]$/.test(value)) {
    value = value.slice(0, -1);
  }
  return value;
}

function normalizeUriScheme(uri: string): string {
  return uri.replace(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//, (_full, scheme: string) => `${scheme.toLowerCase()}://`);
}

function sanitizeNode(node: NormalizedNode | null): NormalizedNode | null {
  if (!node || !isValidServer(node.server) || !isValidPort(node.port)) {
    return null;
  }

  switch (node.type) {
    case 'vmess':
      return hasText(node.uuid) ? node : null;
    case 'vless':
      return hasText(node.uuid) ? node : null;
    case 'ss':
      return hasText(node.cipher) && hasText(node.password) ? node : null;
    case 'trojan':
      return hasText(node.password) ? node : null;
    case 'hysteria2':
      return hasText(node.password) ? node : null;
    case 'tuic':
      return hasText(node.uuid) && hasText(node.password) ? node : null;
    case 'wireguard':
      return hasText(node.publicKey) && node.localAddress.length > 0 ? node : null;
    default:
      return null;
  }
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidServer(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && !/\s/.test(trimmed);
}

function isValidPort(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= 65_535;
}

function convertClashProxy(proxy: ClashLikeProxy): NormalizedNode | null {
  switch (String(proxy.type ?? '')) {
    case 'vmess':
      return {
        type: 'vmess',
        name: String(proxy.name ?? 'VMess'),
        server: String(proxy.server ?? ''),
        port: Number(proxy.port ?? 0),
        uuid: String(proxy.uuid ?? ''),
        alterId: Number(proxy.alterId ?? 0),
        cipher: String(proxy.cipher ?? 'auto'),
        tls: Boolean(proxy.tls),
        sni: typeof proxy.servername === 'string' ? proxy.servername : typeof proxy.sni === 'string' ? proxy.sni : undefined,
        skipCertVerify: Boolean(proxy['skip-cert-verify']),
        network: (proxy.network as VmessNode['network']) ?? 'tcp',
        wsPath: (proxy['ws-opts'] as Record<string, unknown> | undefined)?.path as string | undefined,
        wsHeaders: (proxy['ws-opts'] as Record<string, unknown> | undefined)?.headers as Record<string, string> | undefined,
        grpcServiceName: (proxy['grpc-opts'] as Record<string, unknown> | undefined)?.['grpc-service-name'] as string | undefined
      };
    case 'vless':
      return {
        type: 'vless',
        name: String(proxy.name ?? 'VLESS'),
        server: String(proxy.server ?? ''),
        port: Number(proxy.port ?? 0),
        uuid: String(proxy.uuid ?? ''),
        flow: typeof proxy.flow === 'string' ? proxy.flow : undefined,
        tls: Boolean(proxy.tls),
        sni: typeof proxy.servername === 'string' ? proxy.servername : typeof proxy.sni === 'string' ? proxy.sni : undefined,
        skipCertVerify: Boolean(proxy['skip-cert-verify']),
        network: (proxy.network as VlessNode['network']) ?? 'tcp',
        wsPath: (proxy['ws-opts'] as Record<string, unknown> | undefined)?.path as string | undefined,
        wsHeaders: (proxy['ws-opts'] as Record<string, unknown> | undefined)?.headers as Record<string, string> | undefined,
        grpcServiceName: (proxy['grpc-opts'] as Record<string, unknown> | undefined)?.['grpc-service-name'] as string | undefined,
        realityOpts:
          proxy['reality-opts'] && typeof proxy['reality-opts'] === 'object'
            ? {
                publicKey: String((proxy['reality-opts'] as Record<string, unknown>)['public-key'] ?? ''),
                shortId:
                  typeof (proxy['reality-opts'] as Record<string, unknown>)['short-id'] === 'string'
                    ? String((proxy['reality-opts'] as Record<string, unknown>)['short-id'])
                    : undefined
              }
            : undefined
      };
    case 'ss': {
      const clashSsPlugin = buildShadowsocksPlugin(
        proxy.plugin,
        (proxy['plugin-opts'] as Record<string, unknown> | string | undefined) ?? proxy.plugin_opts
      );
      return {
        type: 'ss',
        name: String(proxy.name ?? 'SS'),
        server: String(proxy.server ?? ''),
        port: Number(proxy.port ?? 0),
        cipher: String(proxy.cipher ?? 'aes-256-gcm'),
        password: String(proxy.password ?? ''),
        plugin: clashSsPlugin
      };
    }
    case 'trojan':
      return {
        type: 'trojan',
        name: String(proxy.name ?? 'Trojan'),
        server: String(proxy.server ?? ''),
        port: Number(proxy.port ?? 0),
        password: String(proxy.password ?? ''),
        sni: typeof proxy.sni === 'string' ? proxy.sni : undefined,
        skipCertVerify: Boolean(proxy['skip-cert-verify']),
        network: (proxy.network as TrojanNode['network']) ?? 'tcp',
        wsPath: (proxy['ws-opts'] as Record<string, unknown> | undefined)?.path as string | undefined,
        wsHeaders: (proxy['ws-opts'] as Record<string, unknown> | undefined)?.headers as Record<string, string> | undefined,
        grpcServiceName: (proxy['grpc-opts'] as Record<string, unknown> | undefined)?.['grpc-service-name'] as string | undefined
      };
    case 'hysteria2':
      return {
        type: 'hysteria2',
        name: String(proxy.name ?? 'Hysteria2'),
        server: String(proxy.server ?? ''),
        port: Number(proxy.port ?? 0),
        password: String(proxy.password ?? ''),
        obfs: typeof proxy.obfs === 'string' ? proxy.obfs : undefined,
        obfsPassword: typeof proxy['obfs-password'] === 'string' ? proxy['obfs-password'] : undefined,
        sni: typeof proxy.sni === 'string' ? proxy.sni : undefined,
        skipCertVerify: Boolean(proxy['skip-cert-verify'])
      };
    case 'tuic':
      return {
        type: 'tuic',
        name: String(proxy.name ?? 'TUIC'),
        server: String(proxy.server ?? ''),
        port: Number(proxy.port ?? 0),
        uuid: String(proxy.uuid ?? ''),
        password: String(proxy.password ?? ''),
        congestionControl:
          typeof proxy['congestion-control'] === 'string'
            ? proxy['congestion-control']
            : typeof proxy['congestion-controller'] === 'string'
              ? proxy['congestion-controller']
              : undefined,
        alpn: Array.isArray(proxy.alpn) ? proxy.alpn.map(String) : undefined,
        sni: typeof proxy.sni === 'string' ? proxy.sni : undefined,
        skipCertVerify: Boolean(proxy['skip-cert-verify']),
        udpRelayMode: typeof proxy['udp-relay-mode'] === 'string' ? proxy['udp-relay-mode'] : undefined
      };
    case 'wireguard':
      return {
        type: 'wireguard',
        name: String(proxy.name ?? 'WireGuard'),
        server: String(proxy.server ?? ''),
        port: Number(proxy.port ?? 0),
        privateKey: typeof proxy['private-key'] === 'string' ? proxy['private-key'] : undefined,
        publicKey:
          typeof proxy['public-key'] === 'string'
            ? proxy['public-key']
            : typeof proxy.publicKey === 'string'
              ? proxy.publicKey
              : '',
        presharedKey: typeof proxy['pre-shared-key'] === 'string' ? proxy['pre-shared-key'] : undefined,
        localAddress: Array.isArray(proxy.ip)
          ? proxy.ip.map(String)
          : typeof proxy.ip === 'string'
            ? [proxy.ip]
            : [],
        dns: Array.isArray(proxy.dns) ? proxy.dns.map(String) : typeof proxy.dns === 'string' ? [proxy.dns] : undefined,
        mtu: proxy.mtu ? Number(proxy.mtu) : undefined,
        reserved: Array.isArray(proxy.reserved) ? proxy.reserved.map((value) => Number(value)) : undefined,
        clientId: typeof proxy['client-id'] === 'string' ? proxy['client-id'] : undefined
      };
    default:
      return null;
  }
}

function convertSingboxOutbound(outbound: SingboxOutbound): NormalizedNode | null {
  switch (String(outbound.type ?? '')) {
    case 'vmess':
      return {
        type: 'vmess',
        name: String(outbound.tag ?? 'VMess'),
        server: String(outbound.server ?? ''),
        port: Number(outbound.server_port ?? 0),
        uuid: String(outbound.uuid ?? ''),
        alterId: Number(outbound.alter_id ?? 0),
        cipher: String(outbound.security ?? 'auto'),
        tls: Boolean((outbound.tls as Record<string, unknown> | undefined)?.enabled),
        sni: (outbound.tls as Record<string, unknown> | undefined)?.server_name as string | undefined,
        skipCertVerify: Boolean((outbound.tls as Record<string, unknown> | undefined)?.insecure),
        network: (outbound.transport as Record<string, unknown> | undefined)?.type as VmessNode['network'] | undefined,
        wsPath: (outbound.transport as Record<string, unknown> | undefined)?.path as string | undefined,
        wsHeaders: (outbound.transport as Record<string, unknown> | undefined)?.headers as Record<string, string> | undefined,
        grpcServiceName: (outbound.transport as Record<string, unknown> | undefined)?.service_name as string | undefined
      };
    case 'vless':
      return {
        type: 'vless',
        name: String(outbound.tag ?? 'VLESS'),
        server: String(outbound.server ?? ''),
        port: Number(outbound.server_port ?? 0),
        uuid: String(outbound.uuid ?? ''),
        flow: typeof outbound.flow === 'string' ? outbound.flow : undefined,
        tls:
          Boolean((outbound.tls as Record<string, unknown> | undefined)?.enabled) ||
          Boolean((outbound.reality as Record<string, unknown> | undefined)?.enabled),
        sni: (outbound.tls as Record<string, unknown> | undefined)?.server_name as string | undefined,
        skipCertVerify: Boolean((outbound.tls as Record<string, unknown> | undefined)?.insecure),
        network: (outbound.transport as Record<string, unknown> | undefined)?.type as VlessNode['network'] | undefined,
        wsPath: (outbound.transport as Record<string, unknown> | undefined)?.path as string | undefined,
        wsHeaders: (outbound.transport as Record<string, unknown> | undefined)?.headers as Record<string, string> | undefined,
        grpcServiceName: (outbound.transport as Record<string, unknown> | undefined)?.service_name as string | undefined,
        realityOpts:
          (outbound.reality as Record<string, unknown> | undefined)?.enabled
            ? {
                publicKey: String((outbound.reality as Record<string, unknown>)?.public_key ?? ''),
                shortId: (outbound.reality as Record<string, unknown>)?.short_id as string | undefined
              }
            : undefined
      };
    case 'shadowsocks': {
      const singboxSsPlugin = buildShadowsocksPlugin(outbound.plugin, outbound.plugin_opts);
      return {
        type: 'ss',
        name: String(outbound.tag ?? 'SS'),
        server: String(outbound.server ?? ''),
        port: Number(outbound.server_port ?? 0),
        cipher: String(outbound.method ?? 'aes-256-gcm'),
        password: String(outbound.password ?? ''),
        plugin: singboxSsPlugin
      };
    }
    case 'trojan':
      return {
        type: 'trojan',
        name: String(outbound.tag ?? 'Trojan'),
        server: String(outbound.server ?? ''),
        port: Number(outbound.server_port ?? 0),
        password: String(outbound.password ?? ''),
        sni: (outbound.tls as Record<string, unknown> | undefined)?.server_name as string | undefined,
        skipCertVerify: Boolean((outbound.tls as Record<string, unknown> | undefined)?.insecure),
        network: (outbound.transport as Record<string, unknown> | undefined)?.type as TrojanNode['network'] | undefined,
        wsPath: (outbound.transport as Record<string, unknown> | undefined)?.path as string | undefined,
        wsHeaders: (outbound.transport as Record<string, unknown> | undefined)?.headers as Record<string, string> | undefined,
        grpcServiceName: (outbound.transport as Record<string, unknown> | undefined)?.service_name as string | undefined
      };
    case 'hysteria2':
      return {
        type: 'hysteria2',
        name: String(outbound.tag ?? 'Hysteria2'),
        server: String(outbound.server ?? ''),
        port: Number(outbound.server_port ?? 0),
        password: String(outbound.password ?? ''),
        obfs: (outbound.obfs as Record<string, unknown> | undefined)?.type as string | undefined,
        obfsPassword: (outbound.obfs as Record<string, unknown> | undefined)?.password as string | undefined,
        sni: (outbound.tls as Record<string, unknown> | undefined)?.server_name as string | undefined,
        skipCertVerify: Boolean((outbound.tls as Record<string, unknown> | undefined)?.insecure)
      };
    case 'tuic':
      return {
        type: 'tuic',
        name: String(outbound.tag ?? 'TUIC'),
        server: String(outbound.server ?? ''),
        port: Number(outbound.server_port ?? 0),
        uuid: String(outbound.uuid ?? ''),
        password: String(outbound.password ?? ''),
        congestionControl: outbound.congestion_control as string | undefined,
        alpn: Array.isArray(outbound.alpn) ? outbound.alpn.map(String) : undefined,
        sni: (outbound.tls as Record<string, unknown> | undefined)?.server_name as string | undefined,
        skipCertVerify: Boolean((outbound.tls as Record<string, unknown> | undefined)?.insecure),
        udpRelayMode: outbound.udp_relay_mode as string | undefined
      };
    case 'wireguard':
      return {
        type: 'wireguard',
        name: String(outbound.tag ?? 'WireGuard'),
        server: String(outbound.server ?? ''),
        port: Number(outbound.server_port ?? 0),
        privateKey: outbound.private_key as string | undefined,
        publicKey: String(outbound.peer_public_key ?? outbound.public_key ?? ''),
        presharedKey: outbound.pre_shared_key as string | undefined,
        localAddress: Array.isArray(outbound.local_address) ? outbound.local_address.map(String) : [],
        dns: Array.isArray(outbound.dns) ? outbound.dns.map(String) : undefined,
        mtu: outbound.mtu ? Number(outbound.mtu) : undefined,
        reserved: Array.isArray(outbound.reserved) ? outbound.reserved.map((value) => Number(value)) : undefined
      };
    default:
      return null;
  }
}
