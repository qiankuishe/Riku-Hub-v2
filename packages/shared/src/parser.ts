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

function warning(code: AggregateWarning['code'], message: string, context?: string): AggregateWarning {
  return { code, message, context };
}

export function isNodeUri(input: string): boolean {
  const trimmed = input.trim().toLowerCase();
  return (
    trimmed.startsWith('vmess://') ||
    trimmed.startsWith('vless://') ||
    trimmed.startsWith('ss://') ||
    trimmed.startsWith('trojan://') ||
    trimmed.startsWith('hysteria2://') ||
    trimmed.startsWith('hy2://') ||
    trimmed.startsWith('tuic://') ||
    trimmed.startsWith('wireguard://')
  );
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
  if (lines.some((line) => isNodeUri(line))) {
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
    if (isHttpUrl(line)) {
      urls.push(line);
      continue;
    }

    if (!isNodeUri(line)) {
      warnings.push(warning('parse-failed', `忽略无法识别的输入: ${line.slice(0, 40)}`, line));
      continue;
    }

    const parsed = parseUri(line);
    if (parsed) {
      nodes.push(parsed);
    } else {
      warnings.push(warning('parse-failed', `无法解析节点 URI: ${line.slice(0, 40)}`, line));
    }
  }

  return { urls, nodes, warnings };
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
      const node = convertClashProxy(proxy);
      if (node) {
        nodes.push(node);
      } else {
        warnings.push(warning('unsupported-protocol', `Clash 中存在未支持协议: ${String(proxy.type ?? 'unknown')}`));
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

      const node = convertSingboxOutbound(outbound);
      if (node) {
        nodes.push(node);
      } else {
        warnings.push(warning('unsupported-protocol', `SingBox 中存在未支持协议: ${type}`));
      }
    }

    return { nodes, warnings };
  } catch (error) {
    return { nodes: [], warnings: [warning('parse-failed', `SingBox 解析失败: ${String(error)}`)] };
  }
}

export function parseUri(uri: string): NormalizedNode | null {
  const trimmed = uri.trim();
  try {
    if (trimmed.startsWith('vmess://')) {
      return parseVmessUri(trimmed);
    }
    if (trimmed.startsWith('vless://')) {
      return parseVlessUri(trimmed);
    }
    if (trimmed.startsWith('ss://')) {
      return parseShadowsocksUri(trimmed);
    }
    if (trimmed.startsWith('trojan://')) {
      return parseTrojanUri(trimmed);
    }
    if (trimmed.startsWith('hysteria2://') || trimmed.startsWith('hy2://')) {
      return parseHysteria2Uri(trimmed);
    }
    if (trimmed.startsWith('tuic://')) {
      return parseTuicUri(trimmed);
    }
    if (trimmed.startsWith('wireguard://')) {
      return parseWireGuardUri(trimmed);
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
  return {
    type: 'vless',
    name: decodeURIComponent(url.hash.slice(1)) || `VLESS-${url.hostname}`,
    server: url.hostname,
    port: Number.parseInt(url.port, 10),
    uuid: decodeURIComponent(url.username),
    flow: params.get('flow') || undefined,
    tls: params.get('security') === 'tls' || params.get('security') === 'reality',
    sni: params.get('sni') || undefined,
    skipCertVerify: params.get('allowInsecure') === '1',
    network: (params.get('type') as VlessNode['network']) || 'tcp',
    wsPath: params.get('path') || undefined,
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

    // 处理 SIP002 格式：ss://base64(method:password)@server:port
    if (mainPart.includes('@')) {
      const atIndex = mainPart.lastIndexOf('@');
      const encoded = mainPart.slice(0, atIndex);
      const serverPart = mainPart.slice(atIndex + 1);

      const decoded = decodeBase64Loose(encoded);
      const colonIndex = decoded.indexOf(':');
      if (colonIndex === -1) {
        return null;
      }

      const cipher = decoded.slice(0, colonIndex);
      const password = decoded.slice(colonIndex + 1);
      const parsedServer = parseServerEndpoint(serverPart);
      if (!parsedServer) {
        return null;
      }

      return {
        type: 'ss',
        name: name || `SS-${parsedServer.server}`,
        server: parsedServer.server,
        port: parsedServer.port,
        cipher,
        password
      };
    }

    // 处理旧格式：ss://base64(method:password@server:port)
    const decoded = decodeBase64Loose(mainPart);
    const colonIndex = decoded.indexOf(':');
    const atIndex = decoded.lastIndexOf('@');
    if (colonIndex === -1 || atIndex <= colonIndex) {
      return null;
    }

    const cipher = decoded.slice(0, colonIndex);
    const password = decoded.slice(colonIndex + 1, atIndex);
    const parsedServer = parseServerEndpoint(decoded.slice(atIndex + 1));
    if (!parsedServer) {
      return null;
    }

    return {
      type: 'ss',
      name: name || `SS-${parsedServer.server}`,
      server: parsedServer.server,
      port: parsedServer.port,
      cipher,
      password
    };
  } catch {
    return null;
  }
}

function parseTrojanUri(uri: string): TrojanNode {
  const url = new URL(uri);
  const params = url.searchParams;
  return {
    type: 'trojan',
    name: decodeURIComponent(url.hash.slice(1)) || `Trojan-${url.hostname}`,
    server: url.hostname,
    port: Number.parseInt(url.port, 10),
    password: decodeURIComponent(url.username),
    sni: params.get('sni') || url.hostname,
    skipCertVerify: params.get('allowInsecure') === '1',
    network: (params.get('type') as TrojanNode['network']) || 'tcp',
    wsPath: params.get('path') || undefined,
    grpcServiceName: params.get('serviceName') || undefined
  };
}

function parseHysteria2Uri(uri: string): Hysteria2Node {
  const normalized = uri.replace('hy2://', 'hysteria2://');
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
    skipCertVerify: params.get('insecure') === '1'
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
    skipCertVerify: params.get('allow_insecure') === '1',
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
    case 'ss':
      return {
        type: 'ss',
        name: String(proxy.name ?? 'SS'),
        server: String(proxy.server ?? ''),
        port: Number(proxy.port ?? 0),
        cipher: String(proxy.cipher ?? 'aes-256-gcm'),
        password: String(proxy.password ?? '')
      };
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
    case 'shadowsocks':
      return {
        type: 'ss',
        name: String(outbound.tag ?? 'SS'),
        server: String(outbound.server ?? ''),
        port: Number(outbound.server_port ?? 0),
        cipher: String(outbound.method ?? 'aes-256-gcm'),
        password: String(outbound.password ?? '')
      };
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
