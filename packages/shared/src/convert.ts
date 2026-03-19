import YAML from 'yaml';
import type { AggregateWarning, FormatResult, NormalizedNode, OutputFormat, WireGuardNode } from './types';
import { ensureUniqueNames } from './utils';

function warning(code: AggregateWarning['code'], message: string, context?: string): AggregateWarning {
  return { code, message, context };
}

export function renderFormat(nodes: NormalizedNode[], format: OutputFormat): FormatResult {
  switch (format) {
    case 'base64':
      return renderBase64(nodes);
    case 'clash':
    case 'stash':
      return renderClash(nodes, format);
    case 'surge':
      return renderLineFormat(nodes, format, convertToSurgeLine);
    case 'loon':
      return renderLineFormat(nodes, format, convertToLoonLine);
    case 'qx':
      return renderLineFormat(nodes, format, convertToQxLine);
    case 'singbox':
      return renderSingbox(nodes);
  }
}

function renderBase64(nodes: NormalizedNode[]): FormatResult {
  const warnings: AggregateWarning[] = [];
  const lines = nodes
    .map((node) => serializeNodeUri(node, warnings))
    .filter((value): value is string => Boolean(value));
  return {
    format: 'base64',
    content: btoa(lines.join('\n')),
    warnings
  };
}

function renderLineFormat(
  nodes: NormalizedNode[],
  format: OutputFormat,
  lineFactory: (node: NormalizedNode) => string | null
): FormatResult {
  const warnings: AggregateWarning[] = [];
  const lines = ensureUniqueNames(nodes)
    .map((node) => {
      const line = lineFactory(node);
      if (!line) {
        warnings.push(warning('unsupported-output', `${node.type} 无法导出为 ${format}`, node.name));
      }
      return line;
    })
    .filter((value): value is string => Boolean(value));

  return {
    format,
    content: lines.join('\n'),
    warnings
  };
}

function renderClash(nodes: NormalizedNode[], format: 'clash' | 'stash'): FormatResult {
  const warnings: AggregateWarning[] = [];
  const proxies = ensureUniqueNames(nodes)
    .map((node) => {
      const converted = convertToClashProxy(node);
      if (!converted) {
        warnings.push(warning('unsupported-output', `${node.type} 无法导出为 ${format}`, node.name));
      }
      return converted;
    })
    .filter((value): value is Record<string, unknown> => Boolean(value));
  const proxyNames = proxies.map((proxy) => String(proxy.name));

  const config = {
    'mixed-port': 7890,
    'allow-lan': true,
    mode: 'rule',
    'log-level': 'info',
    proxies,
    'proxy-groups': [
      { name: '🚀 节点选择', type: 'select', proxies: ['♻️ 自动选择', '☑️ 手动切换', 'DIRECT'] },
      {
        name: '♻️ 自动选择',
        type: 'url-test',
        proxies: proxyNames,
        url: 'http://www.gstatic.com/generate_204',
        interval: 300,
        tolerance: 50
      },
      { name: '☑️ 手动切换', type: 'select', proxies: proxyNames },
      { name: '🤖 AI 服务', type: 'select', proxies: ['🚀 节点选择', '♻️ 自动选择', '☑️ 手动切换'] },
      { name: '📺 流媒体', type: 'select', proxies: ['🚀 节点选择', '♻️ 自动选择', '☑️ 手动切换'] },
      { name: '🛑 广告拦截', type: 'select', proxies: ['REJECT', 'DIRECT'] },
      { name: '🐟 漏网之鱼', type: 'select', proxies: ['🚀 节点选择', '♻️ 自动选择', 'DIRECT'] }
    ],
    rules: [
      'DOMAIN-SUFFIX,openai.com,🤖 AI 服务',
      'DOMAIN-SUFFIX,chatgpt.com,🤖 AI 服务',
      'DOMAIN-SUFFIX,claude.ai,🤖 AI 服务',
      'DOMAIN-SUFFIX,anthropic.com,🤖 AI 服务',
      'DOMAIN-SUFFIX,perplexity.ai,🤖 AI 服务',
      'DOMAIN-SUFFIX,youtube.com,📺 流媒体',
      'DOMAIN-SUFFIX,googlevideo.com,📺 流媒体',
      'DOMAIN-SUFFIX,netflix.com,📺 流媒体',
      'DOMAIN-SUFFIX,spotify.com,📺 流媒体',
      'DOMAIN-SUFFIX,github.com,🚀 节点选择',
      'DOMAIN-SUFFIX,githubusercontent.com,🚀 节点选择',
      'DOMAIN-SUFFIX,x.com,🚀 节点选择',
      'DOMAIN-SUFFIX,twitter.com,🚀 节点选择',
      'DOMAIN-KEYWORD,ads,🛑 广告拦截',
      'GEOIP,CN,DIRECT',
      'MATCH,🐟 漏网之鱼'
    ]
  };

  return { format, content: YAML.stringify(config), warnings };
}

function renderSingbox(nodes: NormalizedNode[]): FormatResult {
  const warnings: AggregateWarning[] = [];
  const outbounds = ensureUniqueNames(nodes)
    .map((node) => {
      const converted = convertToSingboxOutbound(node);
      if (!converted) {
        warnings.push(warning('unsupported-output', `${node.type} 无法导出为 singbox`, node.name));
      }
      return converted;
    })
    .filter((value): value is Record<string, unknown> => Boolean(value));

  return {
    format: 'singbox',
    content: JSON.stringify({ outbounds }, null, 2),
    warnings
  };
}

function serializeNodeUri(node: NormalizedNode, warnings: AggregateWarning[]): string | null {
  switch (node.type) {
    case 'vmess':
      return `vmess://${btoa(
        JSON.stringify({
          v: '2',
          ps: node.name,
          add: node.server,
          port: String(node.port),
          id: node.uuid,
          aid: String(node.alterId),
          scy: node.cipher || 'auto',
          net: node.network || 'tcp',
          tls: node.tls ? 'tls' : '',
          sni: node.sni || '',
          host: node.wsHeaders?.Host || '',
          path: node.wsPath || ''
        })
      )}`;
    case 'vless': {
      const params = new URLSearchParams();
      params.set('type', node.network || 'tcp');
      if (node.tls) {
        params.set('security', node.realityOpts ? 'reality' : 'tls');
      }
      if (node.sni) params.set('sni', node.sni);
      if (node.flow) params.set('flow', node.flow);
      if (node.wsPath) params.set('path', node.wsPath);
      if (node.grpcServiceName) params.set('serviceName', node.grpcServiceName);
      if (node.realityOpts) {
        params.set('pbk', node.realityOpts.publicKey);
        if (node.realityOpts.shortId) params.set('sid', node.realityOpts.shortId);
      }
      return `vless://${node.uuid}@${node.server}:${node.port}?${params.toString()}#${encodeURIComponent(node.name)}`;
    }
    case 'ss':
      return `ss://${btoa(`${node.cipher}:${node.password}`)}@${node.server}:${node.port}#${encodeURIComponent(node.name)}`;
    case 'trojan': {
      const params = new URLSearchParams();
      if (node.sni) params.set('sni', node.sni);
      if (node.network && node.network !== 'tcp') params.set('type', node.network);
      if (node.wsPath) params.set('path', node.wsPath);
      if (node.grpcServiceName) params.set('serviceName', node.grpcServiceName);
      const query = params.toString();
      return `trojan://${encodeURIComponent(node.password)}@${node.server}:${node.port}${query ? `?${query}` : ''}#${encodeURIComponent(node.name)}`;
    }
    case 'hysteria2': {
      const params = new URLSearchParams();
      if (node.sni) params.set('sni', node.sni);
      if (node.obfs) params.set('obfs', node.obfs);
      if (node.obfsPassword) params.set('obfs-password', node.obfsPassword);
      if (node.skipCertVerify) params.set('insecure', '1');
      const query = params.toString();
      return `hysteria2://${encodeURIComponent(node.password)}@${node.server}:${node.port}${query ? `?${query}` : ''}#${encodeURIComponent(node.name)}`;
    }
    case 'tuic': {
      const params = new URLSearchParams();
      if (node.sni) params.set('sni', node.sni);
      if (node.congestionControl) params.set('congestion_control', node.congestionControl);
      if (node.alpn?.length) params.set('alpn', node.alpn.join(','));
      if (node.udpRelayMode) params.set('udp_relay_mode', node.udpRelayMode);
      const query = params.toString();
      return `tuic://${encodeURIComponent(node.uuid)}:${encodeURIComponent(node.password)}@${node.server}:${node.port}${query ? `?${query}` : ''}#${encodeURIComponent(node.name)}`;
    }
    case 'wireguard':
      warnings.push(warning('unsupported-output', 'WireGuard 不导出到 base64/URI 订阅', node.name));
      return null;
  }
}

function convertToClashProxy(node: NormalizedNode): Record<string, unknown> | null {
  switch (node.type) {
    case 'vmess':
      return {
        name: node.name,
        type: 'vmess',
        server: node.server,
        port: node.port,
        uuid: node.uuid,
        alterId: node.alterId,
        cipher: node.cipher,
        tls: node.tls,
        ...(node.sni && { servername: node.sni }),
        'skip-cert-verify': Boolean(node.skipCertVerify),
        ...(node.network && { network: node.network }),
        ...(node.wsPath && { 'ws-opts': { path: node.wsPath, headers: node.wsHeaders } }),
        ...(node.grpcServiceName && { 'grpc-opts': { 'grpc-service-name': node.grpcServiceName } })
      };
    case 'vless':
      return {
        name: node.name,
        type: 'vless',
        server: node.server,
        port: node.port,
        uuid: node.uuid,
        ...(node.flow && { flow: node.flow }),
        tls: node.tls,
        ...(node.sni && { servername: node.sni }),
        'skip-cert-verify': Boolean(node.skipCertVerify),
        ...(node.network && { network: node.network }),
        ...(node.wsPath && { 'ws-opts': { path: node.wsPath, headers: node.wsHeaders } }),
        ...(node.grpcServiceName && { 'grpc-opts': { 'grpc-service-name': node.grpcServiceName } }),
        ...(node.realityOpts && {
          'reality-opts': {
            'public-key': node.realityOpts.publicKey,
            ...(node.realityOpts.shortId && { 'short-id': node.realityOpts.shortId })
          }
        })
      };
    case 'ss':
      return { name: node.name, type: 'ss', server: node.server, port: node.port, cipher: node.cipher, password: node.password };
    case 'trojan':
      return {
        name: node.name,
        type: 'trojan',
        server: node.server,
        port: node.port,
        password: node.password,
        ...(node.sni && { sni: node.sni }),
        'skip-cert-verify': Boolean(node.skipCertVerify),
        ...(node.network && { network: node.network }),
        ...(node.wsPath && { 'ws-opts': { path: node.wsPath } }),
        ...(node.grpcServiceName && { 'grpc-opts': { 'grpc-service-name': node.grpcServiceName } })
      };
    case 'hysteria2':
      return {
        name: node.name,
        type: 'hysteria2',
        server: node.server,
        port: node.port,
        password: node.password,
        ...(node.obfs && { obfs: node.obfs }),
        ...(node.obfsPassword && { 'obfs-password': node.obfsPassword }),
        ...(node.sni && { sni: node.sni }),
        'skip-cert-verify': Boolean(node.skipCertVerify),
        alpn: ['h3']
      };
    case 'tuic':
      return {
        name: node.name,
        type: 'tuic',
        server: node.server,
        port: node.port,
        uuid: node.uuid,
        password: node.password,
        'congestion-controller': node.congestionControl || 'bbr',
        alpn: node.alpn || ['h3'],
        ...(node.sni && { sni: node.sni }),
        'skip-cert-verify': Boolean(node.skipCertVerify),
        'udp-relay-mode': node.udpRelayMode || 'native'
      };
    case 'wireguard':
      return convertWireGuardClash(node);
  }
}

function convertWireGuardClash(node: WireGuardNode): Record<string, unknown> {
  return {
    name: node.name,
    type: 'wireguard',
    server: node.server,
    port: node.port,
    'private-key': node.privateKey ?? '',
    'public-key': node.publicKey,
    ...(node.presharedKey && { 'pre-shared-key': node.presharedKey }),
    ip: node.localAddress,
    ...(node.dns?.length && { dns: node.dns }),
    ...(node.mtu && { mtu: node.mtu }),
    ...(node.reserved?.length && { reserved: node.reserved }),
    ...(node.clientId && { 'client-id': node.clientId })
  };
}

function convertToSingboxOutbound(node: NormalizedNode): Record<string, unknown> | null {
  switch (node.type) {
    case 'vmess':
      return {
        tag: node.name,
        type: 'vmess',
        server: node.server,
        server_port: node.port,
        uuid: node.uuid,
        alter_id: node.alterId,
        security: node.cipher,
        ...(node.tls && { tls: { enabled: true, server_name: node.sni, insecure: node.skipCertVerify } }),
        ...(node.network && node.network !== 'tcp' && {
          transport: { type: node.network, path: node.wsPath, headers: node.wsHeaders, service_name: node.grpcServiceName }
        })
      };
    case 'vless':
      return {
        tag: node.name,
        type: 'vless',
        server: node.server,
        server_port: node.port,
        uuid: node.uuid,
        ...(node.flow && { flow: node.flow }),
        ...(node.tls && !node.realityOpts && {
          tls: { enabled: true, server_name: node.sni, insecure: node.skipCertVerify }
        }),
        ...(node.realityOpts && {
          tls: { enabled: true, server_name: node.sni, insecure: node.skipCertVerify },
          reality: { enabled: true, public_key: node.realityOpts.publicKey, short_id: node.realityOpts.shortId }
        }),
        ...(node.network && node.network !== 'tcp' && {
          transport: { type: node.network, path: node.wsPath, headers: node.wsHeaders, service_name: node.grpcServiceName }
        })
      };
    case 'ss':
      return {
        tag: node.name,
        type: 'shadowsocks',
        server: node.server,
        server_port: node.port,
        method: node.cipher,
        password: node.password
      };
    case 'trojan':
      return {
        tag: node.name,
        type: 'trojan',
        server: node.server,
        server_port: node.port,
        password: node.password,
        tls: { enabled: true, server_name: node.sni, insecure: node.skipCertVerify },
        ...(node.network && node.network !== 'tcp' && {
          transport: { type: node.network, path: node.wsPath, service_name: node.grpcServiceName }
        })
      };
    case 'hysteria2':
      return {
        tag: node.name,
        type: 'hysteria2',
        server: node.server,
        server_port: node.port,
        password: node.password,
        ...(node.obfs && { obfs: { type: node.obfs, password: node.obfsPassword } }),
        tls: { enabled: true, server_name: node.sni, insecure: node.skipCertVerify }
      };
    case 'tuic':
      return {
        tag: node.name,
        type: 'tuic',
        server: node.server,
        server_port: node.port,
        uuid: node.uuid,
        password: node.password,
        ...(node.congestionControl && { congestion_control: node.congestionControl }),
        ...(node.alpn?.length && { alpn: node.alpn }),
        ...(node.udpRelayMode && { udp_relay_mode: node.udpRelayMode }),
        tls: { enabled: true, server_name: node.sni, insecure: node.skipCertVerify }
      };
    case 'wireguard':
      return {
        tag: node.name,
        type: 'wireguard',
        server: node.server,
        server_port: node.port,
        private_key: node.privateKey ?? '',
        peer_public_key: node.publicKey,
        ...(node.presharedKey && { pre_shared_key: node.presharedKey }),
        local_address: node.localAddress,
        ...(node.dns?.length && { dns: node.dns }),
        ...(node.mtu && { mtu: node.mtu }),
        ...(node.reserved?.length && { reserved: node.reserved })
      };
  }
}

function convertToSurgeLine(node: NormalizedNode): string | null {
  switch (node.type) {
    case 'vmess':
      return `${node.name} = vmess, ${node.server}, ${node.port}, username=${node.uuid}${node.tls ? ', tls=true' : ''}${node.sni ? `, sni=${node.sni}` : ''}${node.wsPath ? `, ws=true, ws-path=${node.wsPath}` : ''}`;
    case 'trojan':
      return `${node.name} = trojan, ${node.server}, ${node.port}, password=${node.password}${node.sni ? `, sni=${node.sni}` : ''}${node.skipCertVerify ? ', skip-cert-verify=true' : ''}`;
    case 'ss':
      return `${node.name} = ss, ${node.server}, ${node.port}, encrypt-method=${node.cipher}, password=${node.password}`;
    case 'hysteria2':
      return `${node.name} = hysteria2, ${node.server}, ${node.port}, password=${node.password}${node.sni ? `, sni=${node.sni}` : ''}${node.skipCertVerify ? ', skip-cert-verify=true' : ''}`;
    case 'tuic':
      return `${node.name} = tuic, ${node.server}, ${node.port}, token=${node.uuid}:${node.password}${node.sni ? `, sni=${node.sni}` : ''}`;
    default:
      return null;
  }
}

function convertToLoonLine(node: NormalizedNode): string | null {
  switch (node.type) {
    case 'vmess':
      return `${node.name} = vmess, ${node.server}, ${node.port}, ${node.uuid}, transport=${node.network || 'tcp'}${node.tls ? ', over-tls=true' : ''}${node.sni ? `, tls-name=${node.sni}` : ''}${node.wsPath ? `, path=${node.wsPath}` : ''}`;
    case 'vless':
      return `${node.name} = vless, ${node.server}, ${node.port}, ${node.uuid}, transport=${node.network || 'tcp'}${node.tls ? ', over-tls=true' : ''}${node.sni ? `, tls-name=${node.sni}` : ''}`;
    case 'trojan':
      return `${node.name} = trojan, ${node.server}, ${node.port}, ${node.password}${node.sni ? `, tls-name=${node.sni}` : ''}${node.skipCertVerify ? ', skip-cert-verify=true' : ''}`;
    case 'ss':
      return `${node.name} = shadowsocks, ${node.server}, ${node.port}, ${node.cipher}, "${node.password}"`;
    case 'hysteria2':
      return `${node.name} = Hysteria2, ${node.server}, ${node.port}, "${node.password}"${node.sni ? `, tls-name=${node.sni}` : ''}${node.skipCertVerify ? ', skip-cert-verify=true' : ''}`;
    default:
      return null;
  }
}

function convertToQxLine(node: NormalizedNode): string | null {
  switch (node.type) {
    case 'vmess':
      return `vmess=${node.server}:${node.port}, method=${node.cipher || 'auto'}, password=${node.uuid}${node.tls ? ', obfs=over-tls' : ''}${node.sni ? `, obfs-host=${node.sni}` : ''}${node.wsPath ? `, obfs-uri=${node.wsPath}` : ''}, tag=${node.name}`;
    case 'trojan':
      return `trojan=${node.server}:${node.port}, password=${node.password}${node.sni ? `, tls-host=${node.sni}` : ''}${node.skipCertVerify ? ', tls-verification=false' : ''}, tag=${node.name}`;
    case 'ss':
      return `shadowsocks=${node.server}:${node.port}, method=${node.cipher}, password=${node.password}, tag=${node.name}`;
    case 'hysteria2':
      return `hysteria2=${node.server}:${node.port}, password=${node.password}${node.sni ? `, sni=${node.sni}` : ''}${node.skipCertVerify ? ', tls-verification=false' : ''}, tag=${node.name}`;
    default:
      return null;
  }
}
