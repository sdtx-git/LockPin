export const APP_NAME = 'LockPin Enterprise';
export const APP_VERSION = '3.0.0';

export const VAULT_VERSION = 1;

export const MAX_LOGIN_ATTEMPTS = 5;
export const LOGIN_LOCKOUT_SECONDS = 30;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const KDF_ITERATIONS = 600_000;
export const KDF_HASH = 'SHA-256';
export const KDF_SALT_BYTES = 32;

export const ARGON2_MEM_COST = 65536; // 64 MB
export const ARGON2_TIME_COST = 3;
export const ARGON2_PARALLELISM = 1;

export const RATE_LIMIT_MAX_ATTEMPTS = 5;
export const RATE_LIMIT_WINDOW_MS = 30_000;

export const TOTP_INTERVAL_SECONDS = 30;
export const TOTP_DIGITS = 6;

export const CLIPBOARD_CLEAR_MS = 10_000;

export const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const PAGINATION_PAGE_SIZE = 50;

export const BREACH_SCAN_PROBABILITY = 0.05;

export const AUTO_LOCK_TIMEOUT = 5 * 60 * 1000;
