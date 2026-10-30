import crypto from 'node:crypto';
import { getSession, deleteSession } from './db.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_ONLY_TTL_MS = 24 * 60 * 60 * 1000;
const SALT_BYTES = 16;
const KEY_BYTES = 64;
const HEX_RE = /^[0-9a-f]+$/i;

export function hashPassword(pw) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const hash = crypto.scryptSync(String(pw), salt, KEY_BYTES);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(pw, stored) {
  if (typeof pw !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, saltHex, hashHex] = parts;
  if (!HEX_RE.test(saltHex) || !HEX_RE.test(hashHex)) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  if (salt.length === 0 || expected.length !== KEY_BYTES) return false;
  let actual;
  try {
    actual = crypto.scryptSync(pw, salt, expected.length);
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

export function createRateLimiter({ limit = 5, windowMs = 60_000, now = () => Date.now() } = {}) {
  const entries = new Map();

  function entryFor(key, at) {
    const existing = entries.get(key);
    if (existing && existing.resetAt > at) return existing;
    const fresh = { count: 0, resetAt: at + windowMs };
    entries.set(key, fresh);
    return fresh;
  }

  return {
    check(key) {
      const entry = entryFor(key, now());
      if (entry.count >= limit) return false;
      entry.count += 1;
      return true;
    },
    reset(key) {
      entries.delete(key);
    },
  };
}

export function parseCookies(header) {
  const out = {};
  if (typeof header !== 'string' || header === '') return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    if (!name) continue;
    const raw = part.slice(idx + 1).trim();
    try {
      out[name] = decodeURIComponent(raw);
    } catch {
      out[name] = raw;
    }
  }
  return out;
}

export function sessionCookie(token, { persistent = true } = {}) {
  const base = `sid=${token}; HttpOnly; SameSite=Lax; Path=/`;
  return persistent ? `${base}; Max-Age=${SESSION_TTL_MS / 1000}` : base;
}

export function clearSessionCookie() {
  return 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0';
}

export function newSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function sessionExpiry(now, { persistent = true } = {}) {
  const ttl = persistent ? SESSION_TTL_MS : SESSION_ONLY_TTL_MS;
  return new Date(now.getTime() + ttl).toISOString();
}

export function requireAuth(db, now = () => new Date()) {
  return (req, res, next) => {
    const token = parseCookies(req.headers.cookie).sid;
    if (!token) return res.status(401).json({ error: 'unauthorized' });
    const session = getSession(db, token);
    if (!session) return res.status(401).json({ error: 'unauthorized' });
    const expiresAt = Date.parse(session.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= now().getTime()) {
      deleteSession(db, token);
      return res.status(401).json({ error: 'unauthorized' });
    }
    req.session = session;
    req.sessionToken = token;
    next();
  };
}
