// Centralized application configuration and environment variables
require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 3000,
  DATABASE_URL: process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL || '',
  ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'admin',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'admin123',
  REDIRECT_URL: process.env.REDIRECT_URL || process.env.DEFAULT_REDIRECT_URL || 'https://google.com',
  SESSION_SECRET: process.env.SESSION_SECRET || 'dis-portal-secure-hmac-token-secret-2026',
  DEFAULT_PASSCODE: '12',
  SESSION_MAX_AGE_MS: 7 * 24 * 60 * 60 * 1000 // 7 days
};
