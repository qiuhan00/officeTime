import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { loadConfig } from '../src/config.js';
import { startServer } from './helpers.js';

test('GET /api/health 返回 ok', async () => {
  const db = openDb(':memory:');
  const server = await startServer({ db, config: loadConfig({}) });
  const res = await fetch(`${server.baseUrl}/api/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  await server.close();
});
