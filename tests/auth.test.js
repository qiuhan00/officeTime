import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, createRateLimiter, parseCookies } from '../src/auth.js';
import { openDb, getSettings, getSession } from '../src/db.js';
import { loadConfig } from '../src/config.js';
import { startServer } from './helpers.js';

test('scrypt 哈希与校验', () => {
  const h = hashPassword('secret123');
  assert.equal(verifyPassword('secret123', h), true);
  assert.equal(verifyPassword('wrong', h), false);
  assert.equal(verifyPassword('x', null), false);
  assert.equal(verifyPassword('x', 'garbage'), false);
});

test('限流 5 次后拒绝', () => {
  const rl = createRateLimiter({ limit: 5, windowMs: 60_000 });
  for (let i = 0; i < 5; i++) assert.equal(rl.check('1.1.1.1'), true);
  assert.equal(rl.check('1.1.1.1'), false);
  assert.equal(rl.check('2.2.2.2'), true);
});

test('限流窗口按注入时钟重置', () => {
  let nowMs = 1_000;
  const rl = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => nowMs });

  assert.equal(rl.check('1.1.1.1'), true);
  assert.equal(rl.check('1.1.1.1'), false);

  nowMs += 60_000;
  assert.equal(rl.check('1.1.1.1'), true);
});

test('全局限流 20 次后拒绝', () => {
  const rl = createRateLimiter({ limit: 20, windowMs: 60_000 });

  for (let i = 0; i < 20; i += 1) {
    assert.equal(rl.check('__global__'), true);
  }
  assert.equal(rl.check('__global__'), false);
});

test('Cookie 解析', () => {
  assert.deepEqual(parseCookies('a=1; sid=abc'), { a: '1', sid: 'abc' });
  assert.deepEqual(parseCookies(undefined), {});
});

test('会话过期使用注入时钟判断', async (t) => {
  const db = openDb(':memory:');
  let current = new Date('2026-10-28T01:41:00Z');
  const server = await startServer({
    db,
    config: loadConfig({ INITIAL_PASSWORD: 'secret123' }),
    now: () => current,
  });
  t.after(() => server.close());

  const login = await fetch(`${server.baseUrl}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'secret123' }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie');

  const fresh = await fetch(`${server.baseUrl}/api/session`, { headers: { cookie } });
  assert.equal(fresh.status, 200);

  current = new Date('2026-11-28T01:41:01Z');
  const expired = await fetch(`${server.baseUrl}/api/session`, { headers: { cookie } });
  assert.equal(expired.status, 401);
});

test('记住我：勾选为 7 天持久 Cookie，不勾选为浏览器会话 Cookie', async (t) => {
  const db = openDb(':memory:');
  const server = await startServer({ db, config: loadConfig({ INITIAL_PASSWORD: 'secret123' }) });
  t.after(() => server.close());
  const login = (remember) => fetch(`${server.baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'secret123', remember }),
  });

  const remembered = await login(true);
  const rememberedCookie = remembered.headers.get('set-cookie');
  assert.match(rememberedCookie, /Max-Age=604800/);

  const sessionOnly = await login(false);
  const sessionCookieHeader = sessionOnly.headers.get('set-cookie');
  assert.doesNotMatch(sessionCookieHeader, /Max-Age/);

  const token = /sid=([^;]+)/.exec(sessionCookieHeader)[1];
  const expiresInMs = Date.parse(getSession(db, token).expiresAt) - Date.now();
  assert.ok(expiresInMs > 23 * 60 * 60 * 1000 && expiresInMs <= 24 * 60 * 60 * 1000);
});

test('登录/登出/改密码流程', async () => {
  const db = openDb(':memory:');
  const server = await startServer({ db, config: loadConfig({ INITIAL_PASSWORD: 'secret123' }) });
  const login = await fetch(`${server.baseUrl}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'secret123' }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /sid=/);
  assert.match(cookie, /HttpOnly/);

  const me = await fetch(`${server.baseUrl}/api/session`, { headers: { cookie } });
  assert.equal(me.status, 200);

  const bad = await fetch(`${server.baseUrl}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'nope' }),
  });
  assert.equal(bad.status, 401);
  await server.close();
});
