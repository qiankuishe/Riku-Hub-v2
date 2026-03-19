import { describe, expect, it } from 'vitest';
import { deduplicateNodes, detectInputFormat, parseClashContent, parseContent, parseMixedInput, parseSubQuery, renderFormat } from '../src';

describe('shared aggregation rules', () => {
  it('keeps nodes with same host and port but different identities', () => {
    const result = deduplicateNodes([
      {
        type: 'vmess',
        name: 'A',
        server: 'example.com',
        port: 443,
        uuid: 'uuid-a',
        alterId: 0,
        cipher: 'auto'
      },
      {
        type: 'vmess',
        name: 'B',
        server: 'example.com',
        port: 443,
        uuid: 'uuid-b',
        alterId: 0,
        cipher: 'auto'
      }
    ]);

    expect(result.nodes).toHaveLength(2);
    expect(result.duplicateCount).toBe(0);
  });

  it('parses wireguard from clash content', () => {
    const parsed = parseClashContent(`
proxies:
  - name: WG
    type: wireguard
    server: 198.51.100.2
    port: 51820
    private-key: private-key
    public-key: public-key
    ip:
      - 10.0.0.2/32
      - 2606:4700:110:8d56::2/128
`);

    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0]?.type).toBe('wireguard');
  });

  it('warns when base64 output cannot represent wireguard', () => {
    const rendered = renderFormat(
      [
        {
          type: 'wireguard',
          name: 'WG',
          server: '198.51.100.2',
          port: 51820,
          publicKey: 'pub',
          localAddress: ['10.0.0.2/32']
        }
      ],
      'base64'
    );

    expect(rendered.warnings).toHaveLength(1);
    expect(rendered.content).toBe(btoa(''));
  });
});

describe('regression: critical fixes', () => {
  it('parseSubQuery supports both standard and legacy formats', () => {
    // 标准格式：?token=xxx&format=clash
    const params1 = new URLSearchParams('token=mytoken&format=clash');
    const result1 = parseSubQuery(params1);
    expect(result1.token).toBe('mytoken');
    expect(result1.format).toBe('clash');

    // 旧格式：?mytoken&clash
    const params2 = new URLSearchParams('mytoken&clash');
    const result2 = parseSubQuery(params2);
    expect(result2.token).toBe('mytoken');
    expect(result2.format).toBe('clash');

    // 混合格式：?token=xxx&singbox
    const params3 = new URLSearchParams('token=mytoken&singbox');
    const result3 = parseSubQuery(params3);
    expect(result3.token).toBe('mytoken');
    expect(result3.format).toBe('singbox');
  });

  it('detectInputFormat recognizes full base64/clash/singbox content', () => {
    // Base64 订阅
    const base64Content = btoa('vmess://xxx\nvless://yyy');
    expect(detectInputFormat(base64Content)).toBe('base64');

    // Clash 配置
    const clashContent = 'proxies:\n  - name: test\n    type: vmess';
    expect(detectInputFormat(clashContent)).toBe('clash');

    // Singbox 配置
    const singboxContent = '{"outbounds":[{"type":"vmess"}]}';
    expect(detectInputFormat(singboxContent)).toBe('singbox');
  });

  it('parseContent handles full configuration files', () => {
    // 完整的 Clash 配置
    const clashConfig = `
mixed-port: 7890
proxies:
  - name: Test
    type: vmess
    server: example.com
    port: 443
    uuid: test-uuid
    alterId: 0
    cipher: auto
`;
    const parsed = parseContent(clashConfig, 'clash');
    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0]?.name).toBe('Test');
  });

  it('deduplicateNodes uses enhanced identity with TLS/SNI/transport', () => {
    // 相同服务器，不同 TLS 配置应该被识别为不同节点
    const result = deduplicateNodes([
      {
        type: 'vmess',
        name: 'A',
        server: 'example.com',
        port: 443,
        uuid: 'same-uuid',
        alterId: 0,
        cipher: 'auto',
        tls: true,
        sni: 'sni1.com'
      },
      {
        type: 'vmess',
        name: 'B',
        server: 'example.com',
        port: 443,
        uuid: 'same-uuid',
        alterId: 0,
        cipher: 'auto',
        tls: true,
        sni: 'sni2.com'
      }
    ]);

    expect(result.nodes).toHaveLength(2);
    expect(result.duplicateCount).toBe(0);
  });

  it('renderFormat outputs correct file extension hint', () => {
    const nodes = [
      {
        type: 'vmess' as const,
        name: 'Test',
        server: 'example.com',
        port: 443,
        uuid: 'test-uuid',
        alterId: 0,
        cipher: 'auto'
      }
    ];

    const singboxResult = renderFormat(nodes, 'singbox');
    expect(singboxResult.format).toBe('singbox');
    // Singbox 应该输出 JSON 格式
    expect(() => JSON.parse(singboxResult.content)).not.toThrow();
  });

  it('handles vmess nodes with non-ASCII names', () => {
    const rendered = renderFormat(
      [
        {
          type: 'vmess',
          name: '中文节点',
          server: 'example.com',
          port: 443,
          uuid: '11111111-1111-1111-1111-111111111111',
          alterId: 0,
          cipher: 'auto'
        }
      ],
      'base64'
    );

    const parsed = parseContent(rendered.content, 'base64');
    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0]?.name).toBe('中文节点');
  });

  it('detects and parses URL-safe base64 payloads', () => {
    const raw = 'ss://YWVzLTEyOC1nY206cGFzcw==@example.com:8388#Test';
    const encoded = btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    expect(detectInputFormat(encoded)).toBe('base64');

    const parsed = parseContent(encoded);
    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0]?.type).toBe('ss');
  });

  it('parses SIP002 shadowsocks IPv6 endpoints', () => {
    const parsed = parseContent('ss://YWVzLTEyOC1nY206cGFzcw==@[2001:db8::1]:8388#IPv6');
    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0]).toMatchObject({
      type: 'ss',
      server: '2001:db8::1',
      port: 8388
    });
  });

  it('extracts urls and node uris from mixed inline text', () => {
    const mixed = parseMixedInput(
      '订阅A: https://8.8.8.8/sub, 备用节点: vless://11111111-1111-1111-1111-111111111111@example.com:443?encryption=none&security=none#inline'
    );

    expect(mixed.urls).toEqual(['https://8.8.8.8/sub']);
    expect(mixed.nodes).toHaveLength(1);
    expect(mixed.nodes[0]).toMatchObject({
      type: 'vless',
      server: 'example.com',
      port: 443
    });
  });

  it('keeps vless ws host header during parse and render', () => {
    const parsed = parseContent(
      'vless://11111111-1111-1111-1111-111111111111@example.com:443?encryption=none&security=tls&type=ws&host=cdn.example.com&path=%2F#ws-host'
    );
    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0]).toMatchObject({
      type: 'vless',
      wsHeaders: { Host: 'cdn.example.com' }
    });

    const rendered = renderFormat(parsed.nodes, 'base64');
    const roundTrip = parseContent(rendered.content, 'base64');
    expect(roundTrip.nodes[0]).toMatchObject({
      type: 'vless',
      wsHeaders: { Host: 'cdn.example.com' }
    });
  });

  it('parses and renders shadowsocks plugin nodes', () => {
    const parsed = parseContent(
      'ss://bm9uZTo3YmQxODBlOC0xMTQyLTQzODctOTNmNS0wM2U4ZDc1MGE4OTZANS4xNjEuOTAuMTE6ODA/plugin=v2ray-plugin;mode=websocket;host=5.161.90.11;path=/7bd180e8;sni=5.161.90.11#ss-plugin'
    );

    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0]).toMatchObject({
      type: 'ss',
      plugin: 'v2ray-plugin;mode=websocket;host=5.161.90.11;path=/7bd180e8;sni=5.161.90.11'
    });

    const rendered = renderFormat(parsed.nodes, 'base64');
    const roundTrip = parseContent(rendered.content, 'base64');
    expect(roundTrip.nodes[0]).toMatchObject({
      type: 'ss',
      plugin: 'v2ray-plugin;mode=websocket;host=5.161.90.11;path=/7bd180e8;sni=5.161.90.11'
    });
  });
});
