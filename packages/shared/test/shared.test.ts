import { describe, expect, it } from 'vitest';
import { deduplicateNodes, parseClashContent, renderFormat } from '../src';

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
