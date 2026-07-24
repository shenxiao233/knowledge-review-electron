import path from 'node:path';

/**
 * Parse an environment variable as a finite number.
 * Returns `fallback` when the variable is unset or empty.
 * Throws on startup if the variable is set to a non-numeric value — this
 * prevents silent NaN propagation that would disable security limits such as
 * upload size caps and rate-limit thresholds (BUG-A2 fix).
 */
function num(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`Configuration ${name} must be a finite number (got: ${JSON.stringify(value)})`);
  }
  return n;
}

export const config = {
  // Server
  nodeEnv: process.env.NODE_ENV || 'development',
  port: num(process.env.PORT, 4000, 'PORT'),
  host: process.env.HOST || '0.0.0.0',
  
  // Database
  databaseUrl: process.env.DATABASE_URL || '',
  
  // Security
  jwtSecret: process.env.JWT_SECRET || '',
  marketAccessKey: process.env.MARKET_ACCESS_KEY || '',
  
  // Storage
  storageDir: path.resolve(process.env.STORAGE_DIR || './storage'),
  maxUploadMb: num(process.env.MAX_UPLOAD_MB, 250, 'MAX_UPLOAD_MB'),
  maxArchiveEntries: num(process.env.MAX_ARCHIVE_ENTRIES, 10000, 'MAX_ARCHIVE_ENTRIES'),
  maxUncompressedMb: num(process.env.MAX_UNCOMPRESSED_MB, 1024, 'MAX_UNCOMPRESSED_MB'),
  maxArchiveEntryMb: num(process.env.MAX_ARCHIVE_ENTRY_MB, 100, 'MAX_ARCHIVE_ENTRY_MB'),
  
  // Rate limiting
  // Relaxed defaults still protect the endpoints from accidental or automated abuse.
  loginRateLimitMax: num(process.env.LOGIN_RATE_LIMIT_MAX, 60, 'LOGIN_RATE_LIMIT_MAX'),
  loginRateLimitWindowSeconds: num(process.env.LOGIN_RATE_LIMIT_WINDOW_SECONDS, 900, 'LOGIN_RATE_LIMIT_WINDOW_SECONDS'),
  downloadRateLimitMax: num(process.env.DOWNLOAD_RATE_LIMIT_MAX, 120, 'DOWNLOAD_RATE_LIMIT_MAX'),
  downloadRateLimitWindowSeconds: num(process.env.DOWNLOAD_RATE_LIMIT_WINDOW_SECONDS, 60, 'DOWNLOAD_RATE_LIMIT_WINDOW_SECONDS'),
  uploadRateLimitMax: num(process.env.UPLOAD_RATE_LIMIT_MAX, 20, 'UPLOAD_RATE_LIMIT_MAX'),
  uploadRateLimitWindowSeconds: num(process.env.UPLOAD_RATE_LIMIT_WINDOW_SECONDS, 3600, 'UPLOAD_RATE_LIMIT_WINDOW_SECONDS'),
  registerRateLimitMax: num(process.env.REGISTER_RATE_LIMIT_MAX, 20, 'REGISTER_RATE_LIMIT_MAX'),
  registerRateLimitWindowSeconds: num(process.env.REGISTER_RATE_LIMIT_WINDOW_SECONDS, 3600, 'REGISTER_RATE_LIMIT_WINDOW_SECONDS'),
  
  // Redis
  redisUrl: process.env.REDIS_URL || '',
  
  // CORS
  corsOrigin: process.env.CORS_ORIGIN || '',
  
  // Features
  allowSelfRegister: process.env.ALLOW_SELF_REGISTER !== 'false',
  deckChangeTracking: process.env.DECK_CHANGE_TRACKING === 'true',
  auditRetentionDays: num(process.env.AUDIT_RETENTION_DAYS, 30, 'AUDIT_RETENTION_DAYS'),
  auditArchiveIntervalHours: num(process.env.AUDIT_ARCHIVE_INTERVAL_HOURS, 24, 'AUDIT_ARCHIVE_INTERVAL_HOURS'),
  
  // Proxy
  trustProxy: process.env.TRUST_PROXY === 'true',
  
  // Invitation validation rate limit
  invitationValidateRateLimitMax: num(process.env.INVITATION_VALIDATE_RATE_LIMIT_MAX, 30, 'INVITATION_VALIDATE_RATE_LIMIT_MAX'),
  invitationValidateRateLimitWindowSeconds: num(process.env.INVITATION_VALIDATE_RATE_LIMIT_WINDOW_SECONDS, 60, 'INVITATION_VALIDATE_RATE_LIMIT_WINDOW_SECONDS'),
  
  // API
  apiVersion: '0.3.1-phase3',
};

// Validate required config
if (!config.jwtSecret || config.jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters');
}

export const maxUploadBytes = config.maxUploadMb * 1024 * 1024;
export const maxUncompressedBytes = config.maxUncompressedMb * 1024 * 1024;
export const maxArchiveEntryBytes = config.maxArchiveEntryMb * 1024 * 1024;
