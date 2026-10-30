import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { loadConfig } from '../src/config.js';
import { startServer } from './helpers.js';

async function login(baseUrl, password = 'secret123') {
  const response = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password, remember: true }),
  });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie');
}

test('关闭登录验证后无需会话即可读写，改密码仍需要会话', async (t) => {
  const db = openDb(':memory:');
  const server = await startServer({ db, config: loadConfig({ INITIAL_PASSWORD: 'secret123' }) });
  t.after(() => server.close());
  const cookie = await login(server.baseUrl);

  const disable = await fetch(`${server.baseUrl}/api/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ loginRequired: false }),
  });
  assert.equal(disable.status, 200);
  const disabled = await disable.json();
  assert.equal(disabled.settings.loginRequired, false);

  const anonymousBootstrap = await fetch(`${server.baseUrl}/api/bootstrap`);
  assert.equal(anonymousBootstrap.status, 200);

  const anonymousPunch = await fetch(`${server.baseUrl}/api/punch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'in' }),
  });
  assert.equal(anonymousPunch.status, 200);

  const anonymousPassword = await fetch(`${server.baseUrl}/api/password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ oldPassword: 'secret123', newPassword: 'newsecret123' }),
  });
  assert.equal(anonymousPassword.status, 401);

  const anonymousSession = await fetch(`${server.baseUrl}/api/session`, { headers: { cookie } });
  assert.equal(anonymousSession.status, 200);

  const enable = await fetch(`${server.baseUrl}/api/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ loginRequired: true }),
  });
  assert.equal(enable.status, 200);

  const lockedBootstrap = await fetch(`${server.baseUrl}/api/bootstrap`);
  assert.equal(lockedBootstrap.status, 401);
});
