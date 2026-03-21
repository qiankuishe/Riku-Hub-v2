/**
 * Unified Logger Utility
 * 
 * Provides structured logging with different levels and context support.
 * In production, debug logs are suppressed to reduce noise.
 */

export interface LogContext {
  requestId?: string;
  userId?: string;
  [key: string]: unknown;
}

export interface LoggerConfig {
  enableDebug?: boolean;
  enableInfo?: boolean;
  enableWarn?: boolean;
  enableError?: boolean;
}

class Logger {
  private config: LoggerConfig;

  constructor(config: LoggerConfig = {}) {
    this.config = {
      enableDebug: config.enableDebug ?? this.isDevelopment(),
      enableInfo: config.enableInfo ?? true,
      enableWarn: config.enableWarn ?? true,
      enableError: config.enableError ?? true
    };
  }

  private isDevelopment(): boolean {
    // In Cloudflare Workers, we don't have process.env.NODE_ENV
    // We can use a custom env variable or default to false (production)
    return false;
  }

  private formatMessage(level: string, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString();
    const contextStr = context ? ` ${JSON.stringify(context)}` : '';
    return `[${timestamp}] [${level}] ${message}${contextStr}`;
  }

  debug(message: string, context?: LogContext): void {
    if (this.config.enableDebug) {
      console.log(this.formatMessage('DEBUG', message, context));
    }
  }

  info(message: string, context?: LogContext): void {
    if (this.config.enableInfo) {
      console.log(this.formatMessage('INFO', message, context));
    }
  }

  warn(message: string, context?: LogContext): void {
    if (this.config.enableWarn) {
      console.warn(this.formatMessage('WARN', message, context));
    }
  }

  error(message: string, error?: unknown, context?: LogContext): void {
    if (!this.config.enableError) {
      return;
    }

    const errorInfo = error instanceof Error 
      ? { 
          message: error.message, 
          stack: this.config.enableDebug ? error.stack : undefined,
          name: error.name
        }
      : { error };
    
    const fullContext = { ...errorInfo, ...context };
    console.error(this.formatMessage('ERROR', message, fullContext));
  }

  security(event: string, context?: LogContext): void {
    // Security events are always logged
    console.warn(this.formatMessage('SECURITY', event, context));
  }

  migration(message: string, context?: LogContext): void {
    // Migration logs are always logged
    console.log(this.formatMessage('MIGRATION', message, context));
  }
}

// Export singleton instance
export const logger = new Logger();

// Export factory for custom configurations
export function createLogger(config: LoggerConfig): Logger {
  return new Logger(config);
}
