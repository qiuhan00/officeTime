import { resolve } from 'node:path';
import express from 'express';
import {
  hashPassword,
  verifyPassword,
  createRateLimiter,
  parseCookies,
  requireAuth,
  sessionCookie,
  clearSessionCookie,
  newSessionToken,
  sessionExpiry,
} from './auth.js';
import {
  getSettings,
  updateSettings,
  createSession,
  deleteSession,
  deleteExpiredSessions,
} from './db.js';
import { buildBootstrap, parseMonthParam, validateSettingsPatch } from './view.js';
import { punch, saveDay, removeDay } from './mutations.js';
import { refreshHoliday } from './holiday-store.js';

export function createApp({ db, config, fetchImpl = globalThis.fetch, now = () => new Date() }) {
  const app = express();
  app.use(express.json({ limit: '10kb' }));

  const settings = getSettings(db);
  if (!settings.passwordHash && config?.initialPassword) {
    updateSettings(db, { passwordHash: hashPassword(config.initialPassword) });
  }
  deleteExpiredSessions(db, now().toISOString());

  const nowMs = () => now().getTime();
  const loginLimiter = createRateLimiter({ limit: 5, windowMs: 60_000, now: nowMs });
  const globalLoginLimiter = createRateLimiter({ limit: 20, windowMs: 60_000, now: nowMs });
  const GLOBAL_LOGIN_KEY = '__global__';

  function startSession(res) {
    const token = newSessionToken();
    createSession(db, token, sessionExpiry(now()));
    res.setHeader('Set-Cookie', sessionCookie(token));
    return token;
  }

  app.get('/api/health', (req, res) => {
    res.json({ ok: true });
  });

  app.post('/api/login', (req, res) => {
    const password = req.body?.password;
    if (typeof password !== 'string' || password === '') {
      return res.status(400).json({ error: 'bad_request' });
    }

    const current = getSettings(db);
    if (!current.passwordHash) {
      return res.status(503).json({ error: 'not_configured' });
    }

    const ip = req.ip || 'unknown';
    const withinIpLimit = loginLimiter.check(ip);
    const withinGlobalLimit = globalLoginLimiter.check(GLOBAL_LOGIN_KEY);
    if (!withinIpLimit || !withinGlobalLimit) {
      return res.status(429).json({ error: 'too_many_attempts' });
    }

    if (!verifyPassword(password, current.passwordHash)) {
      return res.status(401).json({ error: 'bad_password' });
    }

    loginLimiter.reset(ip);
    globalLoginLimiter.reset(GLOBAL_LOGIN_KEY);
    startSession(res);
    res.json({ ok: true });
  });

  app.post('/api/logout', (req, res) => {
    const token = parseCookies(req.headers.cookie).sid;
    if (token) deleteSession(db, token);
    res.setHeader('Set-Cookie', clearSessionCookie());
    res.json({ ok: true });
  });

  app.get('/api/session', requireAuth(db, now), (req, res) => {
    res.json({ ok: true });
  });

  app.post('/api/password', requireAuth(db, now), (req, res) => {
    const { oldPassword, newPassword } = req.body ?? {};

    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({ error: 'weak_password' });
    }

    const current = getSettings(db);
    if (!current.passwordHash) {
      return res.status(503).json({ error: 'not_configured' });
    }

    if (typeof oldPassword !== 'string' || !verifyPassword(oldPassword, current.passwordHash)) {
      return res.status(401).json({ error: 'bad_password' });
    }

    updateSettings(db, { passwordHash: hashPassword(newPassword) });
    db.prepare('DELETE FROM sessions').run();
    startSession(res);
    res.json({ ok: true });
  });

  app.get('/api/bootstrap', requireAuth(db, now), (req, res) => {
    let month;
    try {
      month = parseMonthParam(req.query.month);
    } catch {
      return res.status(400).json({ error: 'invalid_month' });
    }
    res.json(buildBootstrap({ db, now: now(), month }));
  });

  app.put('/api/settings', requireAuth(db, now), (req, res) => {
    let month;
    try {
      month = parseMonthParam(req.query.month);
    } catch {
      return res.status(400).json({ error: 'invalid_month' });
    }

    const patch = validateSettingsPatch(req.body);
    if (!patch) {
      return res.status(400).json({ error: 'invalid_settings' });
    }

    updateSettings(db, patch);
    res.json(buildBootstrap({ db, now: now(), month }));
  });

  app.post('/api/punch', requireAuth(db, now), (req, res) => {
    const result = punch({ db, now: now(), type: req.body?.type });
    if (result.status === 200) {
      return res.json(result.bootstrap);
    }
    return res.status(result.status).json({ error: result.error });
  });

  app.put('/api/days/:date', requireAuth(db, now), (req, res) => {
    const result = saveDay({ db, now: now(), date: req.params.date, body: req.body });
    if (result.status === 200) {
      return res.json(result.bootstrap);
    }
    return res.status(result.status).json({ error: result.error });
  });

  app.delete('/api/days/:date', requireAuth(db, now), (req, res) => {
    const result = removeDay({ db, now: now(), date: req.params.date });
    if (result.status === 200) {
      return res.json(result.bootstrap);
    }
    return res.status(result.status).json({ error: result.error });
  });

  app.post('/api/holidays/refresh', requireAuth(db, now), async (req, res) => {
    try {
      const meta = await refreshHoliday({ db, fetchImpl, url: config?.holidayUrl });
      const current = getSettings(db);
      res.json({ holiday: { ...meta, bundled: false, auto: current.autoHoliday } });
    } catch (error) {
      console.error(`holiday refresh failed: ${error.message}`);
      res.status(502).json({ error: 'refresh_failed' });
    }
  });

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.get('/', (req, res) => {
    res.sendFile('index.html', { root: resolve('public') });
  });
  app.use(express.static(resolve('public'), { index: 'index.html' }));

  return app;
}
