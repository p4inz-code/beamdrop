const crypto = require('crypto');
const path = require('path');

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * Sanitize an untrusted filename to prevent path traversal, control chars,
 * and Windows reserved device name exploits.
 */
function sanitizeFilename(rawName) {
  if (typeof rawName !== 'string') return 'unnamed_file';

  // Extract basename across both POSIX and Windows separators
  const base = rawName.split(/[/\\]/).pop() || '';
  // Remove null bytes, control chars, Unicode BiDi overrides, and invalid Windows filename chars
  let clean = base
    .replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069<>:"|?*]/g, '_')
    .replace(/^\.+/, '')
    .trim();

  if (!clean || clean === '.' || clean === '..') {
    return 'unnamed_file';
  }

  if (WINDOWS_RESERVED.test(clean)) {
    clean = `_${clean}`;
  }

  // Cap filename length to avoid OS path limit issues
  if (clean.length > 200) {
    const ext = path.extname(clean).slice(0, 20);
    const stem = path.basename(clean, ext).slice(0, 200 - ext.length);
    clean = `${stem}${ext}`;
  }

  return clean;
}

/**
 * Resolve a target path strictly inside baseDir. Throws if traversal is attempted.
 */
function resolveSafePath(baseDir, targetRelative) {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, targetRelative);

  if (
    resolvedTarget !== resolvedBase &&
    !resolvedTarget.startsWith(resolvedBase + path.sep)
  ) {
    throw new Error('Path traversal detected');
  }
  return resolvedTarget;
}

/**
 * Generate a cryptographically random 4-digit PIN.
 */
function generatePin() {
  return crypto.randomInt(1000, 10000).toString();
}

/**
 * Generate a 256-bit hex session token.
 */
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Constant-time string comparison to prevent timing side-channels.
 */
function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function monotonicNowMs() {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

/**
 * Validate whether a string is a safe http/https URL (blocks javascript:, data:, file:).
 */
function isSafeHttpUrl(raw) {
  if (typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Per-IP rate limiter for PIN authentication attempts (monotonic clock).
 */
class PinRateLimiter {
  constructor({ maxAttempts = 5, windowMs = 60_000, lockoutMs = 120_000 } = {}) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
    this.lockoutMs = lockoutMs;
    this.records = new Map();
  }

  isLocked(ip) {
    const rec = this.records.get(ip);
    if (!rec) return { locked: false, retryAfterSec: 0 };
    const now = monotonicNowMs();
    if (rec.lockedUntil && now < rec.lockedUntil) {
      return {
        locked: true,
        retryAfterSec: Math.ceil((rec.lockedUntil - now) / 1000)
      };
    }
    if (now - rec.firstAttempt > this.windowMs) {
      this.records.delete(ip);
    }
    return { locked: false, retryAfterSec: 0 };
  }

  recordFailure(ip) {
    const now = monotonicNowMs();
    let rec = this.records.get(ip);
    if (!rec || now - rec.firstAttempt > this.windowMs) {
      rec = { count: 1, firstAttempt: now, lockedUntil: 0 };
    } else {
      rec.count += 1;
    }

    if (rec.count >= this.maxAttempts) {
      rec.lockedUntil = now + this.lockoutMs;
    }
    if (!this.records.has(ip) && this.records.size >= 5000) {
      // Evict oldest entry to bound memory under spoofed/flood traffic
      const oldest = this.records.keys().next().value;
      if (oldest) this.records.delete(oldest);
    }
    this.records.set(ip, rec);
    return {
      attemptsLeft: Math.max(0, this.maxAttempts - rec.count),
      locked: rec.count >= this.maxAttempts,
      retryAfterSec: rec.lockedUntil ? Math.ceil((rec.lockedUntil - now) / 1000) : 0
    };
  }

  recordSuccess(ip) {
    this.records.delete(ip);
  }
}

module.exports = {
  sanitizeFilename,
  resolveSafePath,
  generatePin,
  generateToken,
  timingSafeEqualStr,
  isSafeHttpUrl,
  PinRateLimiter
};
