/**
 * 检查导航 URL 是否安全（防止 XSS 攻击）
 *
 * 安全规则：
 * 1. 仅允许 http/https 协议
 * 2. 禁止 javascript:, data:, vbscript:, file:, about: 等危险协议
 * 3. 禁止包含脚本标签或事件处理器的 data URI
 *
 * @param url 待检查的 URL
 * @returns 是否安全
 */
export function isSafeNavigationUrl(url: string): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }

  const trimmed = url.trim().toLowerCase();

  // 检查危险协议前缀（包括 URL 编码的变体）
  const dangerousProtocols = [
    'javascript:',
    'data:',
    'vbscript:',
    'file:',
    'about:',
    'blob:',
    'intent:',
    'tel:',
    'sms:',
    // URL 编码变体
    'java%0ascript:',
    'java%09script:',
    'java%0dscript:',
    'java\nscript:',
    'java\rscript:',
    'java\tscript:',
    '%6a%61%76%61%73%63%72%69%70%74:', // javascript 完整编码
  ];

  for (const protocol of dangerousProtocols) {
    if (trimmed.startsWith(protocol) || trimmed.includes(protocol)) {
      return false;
    }
  }

  // 使用 URL 构造函数进行标准解析
  try {
    const parsed = new URL(url);

    // 仅允许 http/https
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }

    // 额外检查：URL 中不应包含脚本关键字（防止某些浏览器的怪异行为）
    const suspiciousPatterns = [
      /<script/i,
      /javascript:/i,
      /on\w+\s*=/i, // onerror=, onclick= 等事件处理器
      /<iframe/i,
      /<embed/i,
      /<object/i,
    ];

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(url)) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

export function normalizeNavigationUrl(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    return '';
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}
