export type ProxyType =
  | 'vmess'
  | 'vless'
  | 'ss'
  | 'trojan'
  | 'hysteria2'
  | 'tuic'
  | 'wireguard';

export type NetworkType = 'tcp' | 'ws' | 'grpc' | 'h2' | 'quic' | 'kcp';

export type OutputFormat = 'base64' | 'clash' | 'stash' | 'surge' | 'loon' | 'qx' | 'singbox';
export type InputFormat = 'base64' | 'clash' | 'singbox' | 'unknown';

export interface ProxyNodeBase {
  name: string;
  type: ProxyType;
  server: string;
  port: number;
}

export interface VmessNode extends ProxyNodeBase {
  type: 'vmess';
  uuid: string;
  alterId: number;
  cipher: string;
  tls?: boolean;
  sni?: string;
  skipCertVerify?: boolean;
  network?: NetworkType;
  wsPath?: string;
  wsHeaders?: Record<string, string>;
  grpcServiceName?: string;
}

export interface VlessNode extends ProxyNodeBase {
  type: 'vless';
  uuid: string;
  flow?: string;
  tls?: boolean;
  sni?: string;
  skipCertVerify?: boolean;
  network?: NetworkType;
  wsPath?: string;
  wsHeaders?: Record<string, string>;
  grpcServiceName?: string;
  realityOpts?: {
    publicKey: string;
    shortId?: string;
  };
}

export interface ShadowsocksNode extends ProxyNodeBase {
  type: 'ss';
  cipher: string;
  password: string;
  plugin?: string;
}

export interface TrojanNode extends ProxyNodeBase {
  type: 'trojan';
  password: string;
  sni?: string;
  skipCertVerify?: boolean;
  network?: NetworkType;
  wsPath?: string;
  wsHeaders?: Record<string, string>;
  grpcServiceName?: string;
}

export interface Hysteria2Node extends ProxyNodeBase {
  type: 'hysteria2';
  password: string;
  obfs?: string;
  obfsPassword?: string;
  sni?: string;
  skipCertVerify?: boolean;
}

export interface TuicNode extends ProxyNodeBase {
  type: 'tuic';
  uuid: string;
  password: string;
  congestionControl?: string;
  alpn?: string[];
  sni?: string;
  skipCertVerify?: boolean;
  udpRelayMode?: string;
}

export interface WireGuardNode extends ProxyNodeBase {
  type: 'wireguard';
  privateKey?: string;
  publicKey: string;
  presharedKey?: string;
  localAddress: string[];
  dns?: string[];
  mtu?: number;
  reserved?: number[];
  clientId?: string;
}

export type NormalizedNode =
  | VmessNode
  | VlessNode
  | ShadowsocksNode
  | TrojanNode
  | Hysteria2Node
  | TuicNode
  | WireGuardNode;

export interface AggregateWarning {
  code:
    | 'unsupported-protocol'
    | 'unsupported-output'
    | 'fetch-failed'
    | 'parse-failed'
    | 'security-blocked'
    | 'cache-stale';
  message: string;
  context?: string;
}

export interface ParsedContent {
  nodes: NormalizedNode[];
  warnings: AggregateWarning[];
}

export interface FormatResult {
  format: OutputFormat;
  content: string;
  warnings: AggregateWarning[];
}

export interface SourceRecord {
  id: string;
  name: string;
  content: string;
  nodeCount: number;
  sortOrder: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LogRecord {
  id: string;
  action: string;
  detail: string | null;
  createdAt: string;
}

export interface AggregateMeta {
  cacheStatus: 'fresh' | 'stale' | 'missing';
  totalNodes: number;
  warningCount: number;
  lastRefreshTime: string;
  lastRefreshError: string;
  nextRefreshAfter?: string;
}

export interface CachedNodesPayload {
  nodes: NormalizedNode[];
  warnings: AggregateWarning[];
  refreshedAt: string;
}

export interface CachedFormatPayload {
  format: OutputFormat;
  content: string;
  warnings: AggregateWarning[];
  refreshedAt: string;
}

export interface ValidationSummary {
  valid: boolean;
  urlCount: number;
  nodeCount: number;
  totalCount: number;
  duplicateCount: number;
  warnings: AggregateWarning[];
}
