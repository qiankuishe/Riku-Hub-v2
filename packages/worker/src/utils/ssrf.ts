/**
 * SSRF（服务器端请求伪造）防护工具函数
 * 
 * 提供 URL 安全校验、DNS 解析、IP 地址检测等功能，
 * 防止通过恶意 URL 访问内网资源或敏感服务。
 */

import { formatError } from './error';
import { API_ENDPOINTS } from '../config/api-endpoints';

// 常量
const DNS_QUERY_TIMEOUT_MS = 4_000;

// 类型定义
interface Env {
  // 预留给未来可能的环境配置
}

/**
 * 校验 URL 是否安全（防止 SSRF 攻击）
 * 
 * 检查项：
 * 1. 协议白名单（仅允许 http/https）
 * 2. 禁止访问 localhost 和内网域名
 * 3. 禁止访问私有 IP 地址
 * 4. DNS 解析检查（防止域名解析到内网 IP）
 * 
 * @throws {Error} 如果 URL 不安全
 */
export async function assertSafeUrl(_env: Env, url: URL): Promise<void> {
  // 1. 协议白名单
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`禁止协议: ${url.protocol}`);
  }

  const hostname = url.hostname.toLowerCase();

  // 2. 禁止访问 localhost
  if (['localhost', 'localhost.localdomain', '0.0.0.0', '::1', '[::1]', '[::]'].includes(hostname)) {
    throw new Error(`禁止访问内网主机: ${hostname}`);
  }

  // 3. 禁止访问内网域名
  if (isInternalHostname(hostname)) {
    throw new Error(`禁止访问内网域名: ${hostname}`);
  }

  // 4. IP 地址直接检查
  if (isIpAddress(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new Error(`禁止访问保留地址: ${hostname}`);
    }
    return;
  }

  // 5. DNS 解析检查（防止域名解析到内网 IP）
  const addresses = await resolveAddresses(hostname);
  for (const address of addresses) {
    if (isBlockedIp(address)) {
      throw new Error(`域名解析命中保留地址: ${hostname} -> ${address}`);
    }
  }
}

/**
 * 解析域名的所有 IP 地址（A 和 AAAA 记录）
 */
async function resolveAddresses(hostname: string): Promise<string[]> {
  const [aRecords, aaaaRecords] = await Promise.all([
    resolveDnsType(hostname, 'A'),
    resolveDnsType(hostname, 'AAAA')
  ]);
  return [...aRecords, ...aaaaRecords];
}

/**
 * 解析指定类型的 DNS 记录
 * 
 * 使用 Cloudflare DNS over HTTPS 服务进行查询
 */
async function resolveDnsType(hostname: string, type: 'A' | 'AAAA'): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DNS_QUERY_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${API_ENDPOINTS.dns.cloudflare}?name=${encodeURIComponent(hostname)}&type=${type}`,
      {
        headers: { Accept: 'application/dns-json' },
        signal: controller.signal
      }
    );

    if (!response.ok) {
      throw new Error(`DNS 查询失败: HTTP ${response.status}`);
    }

    const data = (await response.json()) as { Answer?: Array<{ data?: string; type?: number }> };
    return (data.Answer ?? [])
      .filter((record) => Boolean(record.data))
      .map((record) => String(record.data))
      .filter((value) => (type === 'A' ? isIpv4(value) : isIpv6(value)));
  } catch (error) {
    // DNS 查询失败时抛出错误，而不是返回空数组放行
    throw new Error(`DNS 解析失败 (${hostname} ${type}): ${formatError(error)}`);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 检查是否为内网域名后缀
 */
function isInternalHostname(hostname: string): boolean {
  return ['.local', '.internal', '.lan', '.home', '.corp', '.intranet'].some((suffix) =>
    hostname.endsWith(suffix)
  );
}

/**
 * 检查是否为 IP 地址（IPv4 或 IPv6）
 */
function isIpAddress(value: string): boolean {
  return isIpv4(value) || isIpv6(value);
}

/**
 * 检查是否为 IPv4 地址
 */
function isIpv4(value: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(value);
}

/**
 * 检查是否为 IPv6 地址
 */
function isIpv6(value: string): boolean {
  return /^[a-fA-F0-9:]+$/.test(value) && value.includes(':');
}

/**
 * 检查 IP 地址是否在黑名单中
 * 
 * IPv4 黑名单：
 * - 127.0.0.0/8: 回环地址
 * - 10.0.0.0/8: 私有网络
 * - 172.16.0.0/12: 私有网络
 * - 192.168.0.0/16: 私有网络
 * - 169.254.0.0/16: 链路本地地址
 * - 0.0.0.0/8: 当前网络
 * - 100.64.0.0/10: 共享地址空间
 * - 192.0.0.0/24: IETF 协议分配
 * - 192.0.2.0/24: 测试网络
 * - 198.18.0.0/15: 基准测试
 * - 198.51.100.0/24: 文档示例
 * - 203.0.113.0/24: 文档示例
 * - 224.0.0.0/4: 组播地址
 * - 240.0.0.0/4: 保留地址
 * - 255.255.255.255/32: 广播地址
 * 
 * IPv6 黑名单：
 * - ::1: 回环地址
 * - fc00::/7: 唯一本地地址
 * - fe80::/10: 链路本地地址
 * - ::ffff:127.0.0.0/104: IPv4 映射的回环地址
 */
function isBlockedIp(value: string): boolean {
  if (isIpv4(value)) {
    return [
      /^127\./,                                          // 127.0.0.0/8
      /^10\./,                                           // 10.0.0.0/8
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,                 // 172.16.0.0/12
      /^192\.168\./,                                     // 192.168.0.0/16
      /^169\.254\./,                                     // 169.254.0.0/16
      /^0\./,                                            // 0.0.0.0/8
      /^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./, // 100.64.0.0/10
      /^192\.0\.0\./,                                    // 192.0.0.0/24
      /^192\.0\.2\./,                                    // 192.0.2.0/24
      /^198\.18\./,                                      // 198.18.0.0/15
      /^198\.51\.100\./,                                 // 198.51.100.0/24
      /^203\.0\.113\./,                                  // 203.0.113.0/24
      /^224\./,                                          // 224.0.0.0/4
      /^240\./,                                          // 240.0.0.0/4
      /^255\./                                           // 255.0.0.0/8
    ].some((pattern) => pattern.test(value));
  }

  // IPv6 检查
  const normalized = value.toLowerCase();
  return (
    normalized === '::1' ||                              // 回环地址
    normalized.startsWith('fc') ||                       // fc00::/7 唯一本地地址
    normalized.startsWith('fd') ||                       // fd00::/8 唯一本地地址
    normalized.startsWith('fe80:') ||                    // fe80::/10 链路本地地址
    normalized.startsWith('::ffff:127.')                 // IPv4 映射的回环地址
  );
}
