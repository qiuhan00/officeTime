import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, getHolidayRow, saveHolidayRow } from '../src/db.js';
import { parseHolidayData } from '../src/holiday.js';
import { seedHolidayIfEmpty, refreshHoliday, startHolidayScheduler } from '../src/holiday-store.js';
import { startServer } from './helpers.js';

const sample = JSON.stringify({
  holidays: { '2026-10-01': 'National Day,国庆节,7' },
  workdays: { '2026-10-10': 'National Day,国庆节,7' },
});

const newerSample = JSON.stringify({
  holidays: { '2027-01-01': 'New Year,元旦,1' },
  workdays: { '2027-01-09': 'New Year,元旦,1' },
});

function oldRow() {
  return {
    json: sample,
    coverageMin: '2026-10-01',
    coverageMax: '2026-10-10',
    fetchedAt: '2026-01-01T00:00:00.000Z',
  };
}

async function waitFor(predicate, timeoutMs = 2000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('空库时用内置快照播种', () => {
  const db = openDb(':memory:');
  const result = seedHolidayIfEmpty(db);

  assert.deepEqual(result, { seeded: true });
  const row = getHolidayRow(db);
  assert.ok(row);
  assert.ok(row.coverageMax);
  assert.equal(row.fetchedAt, '1970-01-01T00:00:00.000Z');
});

test('默认内置快照路径不依赖 cwd', () => {
  const dir = mkdtempSync(join(tmpdir(), 'holiday-cwd-'));
  const previousCwd = process.cwd();

  try {
    process.chdir(dir);
    const db = openDb(':memory:');
    assert.deepEqual(seedHolidayIfEmpty(db), { seeded: true });
  } finally {
    process.chdir(previousCwd);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('已存在数据时不重复播种', () => {
  const db = openDb(':memory:');
  saveHolidayRow(db, oldRow());

  const result = seedHolidayIfEmpty(db);

  assert.deepEqual(result, { seeded: false });
  assert.equal(getHolidayRow(db).json, sample);
});

test('刷新成功覆盖旧数据', async () => {
  const db = openDb(':memory:');
  saveHolidayRow(db, oldRow());

  let requestedUrl = null;
  const meta = await refreshHoliday({
    db,
    url: 'https://example.test/holidays.json',
    fetchImpl: async (url) => {
      requestedUrl = url;
      return new Response(newerSample, { status: 200 });
    },
  });

  assert.equal(requestedUrl, 'https://example.test/holidays.json');
  assert.equal(meta.coverageMin, '2027-01-01');
  assert.equal(meta.coverageMax, '2027-01-09');
  const row = getHolidayRow(db);
  assert.equal(row.coverageMin, '2027-01-01');
  assert.equal(row.coverageMax, '2027-01-09');
  assert.equal(row.fetchedAt, meta.updatedAt);
  assert.notEqual(row.fetchedAt, oldRow().fetchedAt);
});

test('刷新失败保留旧数据并抛错', async () => {
  const db = openDb(':memory:');
  saveHolidayRow(db, oldRow());

  await assert.rejects(refreshHoliday({
    db,
    fetchImpl: async () => {
      throw new Error('network down');
    },
  }), /network down/);

  const row = getHolidayRow(db);
  assert.deepEqual(row, oldRow());

  await assert.rejects(refreshHoliday({
    db,
    fetchImpl: async () => new Response('not json', { status: 200 }),
  }));

  assert.deepEqual(getHolidayRow(db), oldRow());
});

test('POST /api/holidays/refresh 成功返回覆盖范围', async () => {
  const db = openDb(':memory:');
  const server = await startServer({
    db,
    config: { initialPassword: 'secret123' },
    fetchImpl: async () => new Response(newerSample, { status: 200 }),
  });

  try {
    const anonymous = await fetch(`${server.baseUrl}/api/holidays/refresh`, { method: 'POST' });
    assert.equal(anonymous.status, 401);

    const login = await fetch(`${server.baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'secret123' }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie');

    const response = await fetch(`${server.baseUrl}/api/holidays/refresh`, {
      method: 'POST',
      headers: { cookie },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.holiday.coverageMin, '2027-01-01');
    assert.equal(body.holiday.coverageMax, '2027-01-09');
    assert.ok(body.holiday.updatedAt);
    assert.equal(body.holiday.auto, true);
  } finally {
    await server.close();
  }
});

test('POST /api/holidays/refresh 失败返回 502 且旧数据可用', async () => {
  const db = openDb(':memory:');
  saveHolidayRow(db, oldRow());
  const server = await startServer({
    db,
    config: { initialPassword: 'secret123' },
    fetchImpl: async () => new Response('boom', { status: 500 }),
  });

  try {
    const login = await fetch(`${server.baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'secret123' }),
    });
    const cookie = login.headers.get('set-cookie');

    const response = await fetch(`${server.baseUrl}/api/holidays/refresh`, {
      method: 'POST',
      headers: { cookie },
    });
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'refresh_failed' });
    assert.deepEqual(getHolidayRow(db), oldRow());
  } finally {
    await server.close();
  }
});

test('调度器启动立即执行一次，可停止', async () => {
  const db = openDb(':memory:');
  let calls = 0;
  const warnings = [];
  const fetchImpl = async () => {
    calls += 1;
    return new Response(sample, { status: 200 });
  };

  const stop = startHolidayScheduler({
    db,
    fetchImpl,
    intervalMs: 60_000,
    logger: { warn: (message) => warnings.push(message) },
  });

  assert.equal(typeof stop, 'function');
  await waitFor(() => calls === 1);
  assert.ok(getHolidayRow(db));

  stop();
  const afterStop = calls;
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(calls, afterStop);
  assert.deepEqual(warnings, []);
});

test('内置快照损坏时播种抛错', () => {
  const dir = mkdtempSync(join(tmpdir(), 'holiday-store-'));
  const bundledPath = join(dir, 'chinese-days.json');
  writeFileSync(bundledPath, 'not json');

  try {
    const db = openDb(':memory:');
    assert.throws(() => seedHolidayIfEmpty(db, { bundledPath }), (error) => (
      error.code === 'INVALID_HOLIDAY_DATA'
    ));
    assert.equal(getHolidayRow(db), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('默认内置快照可被解析', () => {
  const raw = readFileSync('assets/chinese-days.json', 'utf8');
  const parsed = parseHolidayData(raw);
  assert.ok(parsed.coverageMin);
  assert.ok(parsed.coverageMax);
  assert.ok(parsed.holidays.size > 0);
});

test('停止后未开始的立即刷新不再执行', async () => {
  const db = openDb(':memory:');
  let calls = 0;
  const stop = startHolidayScheduler({
    db,
    fetchImpl: async () => {
      calls += 1;
      return new Response(sample, { status: 200 });
    },
    intervalMs: 60_000,
    logger: { warn: () => {} },
  });

  stop();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(calls, 0);
  assert.equal(getHolidayRow(db), null);
});
