import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type express from 'express';

const ADMIN_CREDENTIAL_PATH = path.join(process.cwd(), 'src/data/admin_credential.json');
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

interface StoredAdminCredential {
  salt: string;
  hash: string;
  createdAt: string;
}

// Active in-memory Bearer sessions: token -> expiresAt (ms)
const activeSessions = new Map<string, number>();

function pruneExpiredSessions(now = Date.now()): void {
  for (const [token, expiresAt] of activeSessions.entries()) {
    if (expiresAt <= now) {
      activeSessions.delete(token);
    }
  }
}

function readClaimedCredential(): StoredAdminCredential | null {
  try {
    if (!fs.existsSync(ADMIN_CREDENTIAL_PATH)) return null;
    const raw = fs.readFileSync(ADMIN_CREDENTIAL_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.salt === 'string' &&
      parsed.salt.length >= 16 &&
      typeof parsed.hash === 'string' &&
      parsed.hash.length >= 64
    ) {
      return parsed as StoredAdminCredential;
    }
  } catch {}
  return null;
}

function getEnvPasscode(): string | null {
  const raw = process.env.ADMIN_PASSCODE;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return raw.trim();
  }
  return null;
}

export function getAdminAuthStatus(): {
  configured: boolean;
  needsSetup: boolean;
  source: 'env' | 'claimed' | 'none';
} {
  if (getEnvPasscode()) {
    return { configured: true, needsSetup: false, source: 'env' };
  }
  if (readClaimedCredential()) {
    return { configured: true, needsSetup: false, source: 'claimed' };
  }
  return { configured: false, needsSetup: true, source: 'none' };
}

function issueSessionToken(): string {
  pruneExpiredSessions();
  const token = crypto.randomBytes(32).toString('hex');
  activeSessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

function safeDigestEqual(a: string, b: string): boolean {
  const da = crypto.createHash('sha256').update(a, 'utf8').digest();
  const db = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(da, db);
}

export function validatePasscodeFormat(passcode: unknown): string | null {
  if (typeof passcode !== 'string') return null;
  const trimmed = passcode.trim();
  if (trimmed.length < 4 || trimmed.length > 64) return null;
  return trimmed;
}

export function setupFirstAdminPasscode(passcode: unknown): {
  ok: boolean;
  token?: string;
  error?: string;
  statusCode?: number;
} {
  const status = getAdminAuthStatus();
  if (!status.needsSetup) {
    return {
      ok: false,
      error: 'Admin passcode is already configured',
      statusCode: 409,
    };
  }

  const validCode = validatePasscodeFormat(passcode);
  if (!validCode) {
    return {
      ok: false,
      error: 'Admin code must be between 4 and 64 characters',
      statusCode: 400,
    };
  }

  try {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(validCode, salt, 64).toString('hex');
    const record: StoredAdminCredential = {
      salt,
      hash,
      createdAt: new Date().toISOString(),
    };
    fs.mkdirSync(path.dirname(ADMIN_CREDENTIAL_PATH), { recursive: true });
    const tmpPath = `${ADMIN_CREDENTIAL_PATH}.tmp.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}`;
    fs.writeFileSync(tmpPath, JSON.stringify(record, null, 2), { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(tmpPath, ADMIN_CREDENTIAL_PATH);
    return { ok: true, token: issueSessionToken() };
  } catch (err) {
    console.error('[AdminAuth] Failed to persist initial admin credential:', err);
    return {
      ok: false,
      error: 'Failed to save admin credential',
      statusCode: 500,
    };
  }
}

export function loginAdminWithPasscode(passcode: unknown): {
  ok: boolean;
  token?: string;
  error?: string;
  statusCode?: number;
} {
  const validCode = validatePasscodeFormat(passcode);
  if (!validCode) {
    return { ok: false, error: 'Access denied.', statusCode: 401 };
  }

  const envPasscode = getEnvPasscode();
  if (envPasscode !== null) {
    if (safeDigestEqual(validCode, envPasscode)) {
      return { ok: true, token: issueSessionToken() };
    }
    return { ok: false, error: 'Access denied.', statusCode: 401 };
  }

  const stored = readClaimedCredential();
  if (!stored) {
    return {
      ok: false,
      error: 'Admin passcode is not configured yet.',
      statusCode: 409,
    };
  }

  try {
    const derived = crypto.scryptSync(validCode, stored.salt, 64);
    const expected = Buffer.from(stored.hash, 'hex');
    if (derived.length === expected.length && crypto.timingSafeEqual(derived, expected)) {
      return { ok: true, token: issueSessionToken() };
    }
  } catch (err) {
    console.error('[AdminAuth] Verification error:', err);
  }

  return { ok: false, error: 'Access denied.', statusCode: 401 };
}

export function extractBearerToken(req: express.Request): string | null {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+([A-Za-z0-9._-]+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

export function verifyAdminToken(token: string | null): boolean {
  if (!token) return false;
  const now = Date.now();
  const expiresAt = activeSessions.get(token);
  if (!expiresAt) return false;
  if (expiresAt <= now) {
    activeSessions.delete(token);
    return false;
  }
  // Sliding expiration refresh
  activeSessions.set(token, now + SESSION_TTL_MS);
  return true;
}

export function revokeAdminToken(token: string | null): void {
  if (token) {
    activeSessions.delete(token);
  }
}

export function requireAdminAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const token = extractBearerToken(req);
  if (!verifyAdminToken(token)) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }
  next();
}
