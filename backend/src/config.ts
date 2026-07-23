import path from 'node:path';

export const config = {
  // Server
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),
  host: process.env.HOST || '0.0.0.0',
  
  // Database
  databaseUrl: process.env.DATABASE_URL || '',
  
  // Security
  jwtSecret: process.env.JWT_SECRET || '',
  marketAccessKey: process.env.MARKET_ACCESS_KEY || '',
  
  // Storage
  storageDir: path.resolve(process.env.STORAGE_DIR || './storage'),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 250),
  maxArchiveEntries: Number(process.env.MAX_ARCHIVE_ENTRIES || 10000),
  maxUncompressedMb: Number(process.env.MAX_UNCOMPRESSED_MB || 1024),
  maxArchiveEntryMb: Number(process.env.MAX_ARCHIVE_ENTRY_MB || 100),
  
  // Rate limiting
  // Relaxed defaults still protect the endpoints from accidental or automated abuse.
  loginRateLimitMax: Number(process.env.LOGIN_RATE_LIMIT_MAX || 60),
  loginRateLimitWindowSeconds: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_SECONDS || 900),
  downloadRateLimitMax: Number(process.env.DOWNLOAD_RATE_LIMIT_MAX || 120),
  downloadRateLimitWindowSeconds: Number(process.env.DOWNLOAD_RATE_LIMIT_WINDOW_SECONDS || 60),
  uploadRateLimitMax: Number(process.env.UPLOAD_RATE_LIMIT_MAX || 20),
  uploadRateLimitWindowSeconds: Number(process.env.UPLOAD_RATE_LIMIT_WINDOW_SECONDS || 3600),
  registerRateLimitMax: Number(process.env.REGISTER_RATE_LIMIT_MAX || 20),
  registerRateLimitWindowSeconds: Number(process.env.REGISTER_RATE_LIMIT_WINDOW_SECONDS || 3600),
  
  // Redis
  redisUrl: process.env.REDIS_URL || '',
  
  // CORS
  corsOrigin: process.env.CORS_ORIGIN || '',
  
  // Features
  allowSelfRegister: process.env.ALLOW_SELF_REGISTER !== 'false',
  deckChangeTracking: process.env.DECK_CHANGE_TRACKING === 'true',
  auditRetentionDays: Number(process.env.AUDIT_RETENTION_DAYS || 90),
  auditArchiveIntervalHours: Number(process.env.AUDIT_ARCHIVE_INTERVAL_HOURS || 24),
  
  // API
  apiVersion: '0.3.1-phase3',
};

// Validate required config
if (!config.jwtSecret || config.jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters');
}
if (!config.marketAccessKey || config.marketAccessKey.length < 24) {
  throw new Error('MARKET_ACCESS_KEY must be at least 24 characters');
}

export const maxUploadBytes = config.maxUploadMb * 1024 * 1024;
export const maxUncompressedBytes = config.maxUncompressedMb * 1024 * 1024;
export const maxArchiveEntryBytes = config.maxArchiveEntryMb * 1024 * 1024;
