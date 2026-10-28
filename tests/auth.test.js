import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, createRateLimiter, parseCookies } from '../src/auth.js';
import { openDb, getSettings } from '../src/db.js';
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

test('Cookie 解析', () => {
  assert.deepEqual(parseCookies('a=1; sid=abc'), { a: '1', sid: 'abc' });
  assert.deepEqual(parseCookies(undefined), {});
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
