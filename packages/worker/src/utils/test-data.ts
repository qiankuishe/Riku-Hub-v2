/**
 * 测试数据生成工具
 * 
 * 提供测试用的随机数据生成，避免硬编码测试凭据。
 */

/**
 * 生成随机测试用户名
 */
export function generateTestUsername(): string {
  const prefixes = ['test', 'demo', 'user', 'admin'];
  const suffixes = ['001', '123', 'dev', 'temp'];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
  return `${prefix}${suffix}`;
}

/**
 * 生成随机测试密码
 */
export function generateTestPassword(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * 生成随机测试邮箱
 */
export function generateTestEmail(): string {
  const domains = ['test.com', 'example.org', 'demo.net'];
  const username = generateTestUsername();
  const domain = domains[Math.floor(Math.random() * domains.length)];
  return `${username}@${domain}`;
}

/**
 * 生成随机测试令牌
 */
export function generateTestToken(length = 32): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * 生成随机测试密钥（重复字符）
 */
export function generateTestKey(char = 'a', length = 32): string {
  return char.repeat(length);
}

/**
 * 生成测试环境变量对象
 */
export function generateTestEnv(): Record<string, string> {
  return {
    ADMIN_USERNAME: generateTestUsername(),
    ADMIN_PASSWORD_HASH: 'test-hash-' + generateTestToken(16),
    SUB_TOKEN: generateTestToken(32),
    COMPAT_REGISTER_KEY: generateTestKey('a', 32),
    TELEGRAM_BOT_TOKEN: generateTestToken(45),
    TELEGRAM_CHAT_ID: Math.floor(Math.random() * 1000000).toString()
  };
}