import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, upsertDay, saveHolidayRow } from '../src/db.js';
import { loadConfig } from '../src/config.js';
import { startServer } from './helpers.js';

const NOW = () => new Date('2026-10-28T01:41:00Z');

async function setup(t, { now = NOW } = {}) {
  const db = openDb(':memory:');
  const server = await startServer({
    db,
    config: loadConfig({ INITIAL_PASSWORD: 'secret123' }),
    now,
  });
  t.after(() => server.close());

  const login = await fetch(`${server.baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'secret123' }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];

  async function get(path) {
    const res = await fetch(`${server.baseUrl}${path}`, { headers: { cookie } });
    return { status: res.status, body: await res.json() };
  }

  async function put(path, body) {
    const res = await fetch(`${server.baseUrl}${path}`, {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  }

  return { db, server, cookie, get, put };
}

test('未登录返回 401', async (t) => {
  const db = openDb(':memory:');
  const server = await startServer({
    db,
    config: loadConfig({ INITIAL_PASSWORD: 'secret123' }),
    now: NOW,
  });
  t.after(() => server.close());

  const bootstrap = await fetch(`${server.baseUrl}/api/bootstrap`);
  assert.equal(bootstrap.status, 401);

  const settings = await fetch(`${server.baseUrl}/api/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(settings.status, 401);
});

test('结构完整、today 为空、可上班不可下班', async (t) => {
  const { get } = await setup(t);
  const { status, body } = await get('/api/bootstrap');

  assert.equal(status, 200);
  assert.deepEqual(Object.keys(body), ['settings', 'holiday', 'now', 'today', 'punch', 'view']);
  assert.deepEqual(body.settings, {
    periodStartDay: 26,
    overtimeStart: '19:00',
    workdays: [1, 2, 3, 4, 5],
    autoHoliday: true,
  });
  assert.deepEqual(body.holiday, {
    coverageMin: null,
    coverageMax: null,
    updatedAt: null,
    auto: true,
  });
  assert.deepEqual(body.now, { date: '2026-10-28', time: '09:41' });
  assert.equal(body.today, null);
  assert.deepEqual(body.punch, { canIn: true, canOut: false, delayedOutDate: null });
  assert.equal(body.view.month, '2026-10');
  assert.deepEqual(body.view.period, {
    start: '2026-10-26',
    end: '2026-11-25',
    totalMinutes: 0,
  });
  assert.equal(body.view.days.length, 31);
  assert.equal(body.view.days[0].date, '2026-10-01');
  assert.equal(body.view.days.at(-1).date, '2026-10-31');

  for (const day of body.view.days) {
    assert.deepEqual(Object.keys(day), [
      'date',
      'inAt',
      'outAt',
      'outNextDay',
      'isRest',
      'type',
      'holidayName',
      'overtimeMinutes',
      'incomplete',
    ]);
  }

  assert.deepEqual(body.view.days[0], {
    date: '2026-10-01',
    inAt: null,
    outAt: null,
    outNextDay: 0,
    isRest: null,
    type: 'work',
    holidayName: null,
    overtimeMinutes: 0,
    incomplete: false,
  });
});

test('周期锚点：当前月用今天，其它月用 1 号', async (t) => {
  const { get } = await setup(t);

  const current = await get('/api/bootstrap?month=2026-10');
  assert.equal(current.body.view.month, '2026-10');
  assert.deepEqual(current.body.view.period, {
    start: '2026-10-26',
    end: '2026-11-25',
    totalMinutes: 0,
  });

  const september = await get('/api/bootstrap?month=2026-09');
  assert.equal(september.body.view.month, '2026-09');
  assert.equal(september.body.view.days.length, 30);
  assert.deepEqual(september.body.view.period, {
    start: '2026-08-26',
    end: '2026-09-25',
    totalMinutes: 0,
  });

  const november = await get('/api/bootstrap?month=2026-11');
  assert.deepEqual(november.body.view.period, {
    start: '2026-10-26',
    end: '2026-11-25',
    totalMinutes: 0,
  });

  const bad = await get('/api/bootstrap?month=2026-13');
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body, { error: 'invalid_month' });
});

test('合计只统计区间内完整记录，并按分钟累加', async (t) => {
  const { db, get } = await setup(t);
  // 10-27 19:00 后计 83 分钟
  upsertDay(db, { date: '2026-10-27', inAt: '09:00', outAt: '20:23', outNextDay: 0, isRest: null });
  // 只有上班，不计
  upsertDay(db, { date: '2026-10-29', inAt: '09:00', outAt: null, outNextDay: 0, isRest: null });
  // 周期区间 10-26..11-25 内，但不在 10 月视图内
  upsertDay(db, { date: '2026-11-02', inAt: '09:00', outAt: '20:00', outNextDay: 0, isRest: null });
  // 完整但在周期开始之前，不计
  upsertDay(db, { date: '2026-10-25', inAt: '09:00', outAt: '22:00', outNextDay: 0, isRest: null });

  const { body } = await get('/api/bootstrap?month=2026-10');
  assert.deepEqual(body.view.period, {
    start: '2026-10-26',
    end: '2026-11-25',
    totalMinutes: 143,
  });

  const day27 = body.view.days.find((d) => d.date === '2026-10-27');
  assert.equal(day27.overtimeMinutes, 83);
  assert.equal(day27.incomplete, false);

  const day29 = body.view.days.find((d) => d.date === '2026-10-29');
  assert.equal(day29.incomplete, true);
  assert.equal(day29.overtimeMinutes, 0);
});

test('日历每天都有，节假日带名称且类型为 rest', async (t) => {
  const { db, get } = await setup(t);
  saveHolidayRow(db, {
    json: JSON.stringify({ holidays: { '2026-10-01': '2026-10-01,国庆节' }, workdays: {} }),
    coverageMin: '2026-10-01',
    coverageMax: '2026-10-01',
    fetchedAt: '2026-10-28T00:00:00.000Z',
  });

  const { body } = await get('/api/bootstrap?month=2026-10');
  assert.deepEqual(body.holiday, {
    coverageMin: '2026-10-01',
    coverageMax: '2026-10-01',
    updatedAt: '2026-10-28T00:00:00.000Z',
    auto: true,
  });
  assert.equal(body.view.days.length, 31);

  const nationalDay = body.view.days.find((d) => d.date === '2026-10-01');
  assert.equal(nationalDay.type, 'rest');
  assert.equal(nationalDay.holidayName, '国庆节');

  // 未覆盖的日期回落到工作日设置（2026-10-02 周五）
  const uncovered = body.view.days.find((d) => d.date === '2026-10-02');
  assert.equal(uncovered.type, 'work');
  assert.equal(uncovered.holidayName, null);

  // 周六为休息日
  const saturday = body.view.days.find((d) => d.date === '2026-10-03');
  assert.equal(saturday.type, 'rest');

  // 手动标记覆盖节假日判断
  upsertDay(db, { date: '2026-10-01', inAt: null, outAt: null, outNextDay: 0, isRest: 0 });
  const overridden = await get('/api/bootstrap?month=2026-10');
  const overriddenDay = overridden.body.view.days.find((d) => d.date === '2026-10-01');
  assert.equal(overriddenDay.type, 'work');
  assert.equal(overriddenDay.holidayName, null);
});

test('设置修改后立即重算', async (t) => {
  const { get, put } = await setup(t);

  const update = await put('/api/settings', { periodStartDay: 1, autoHoliday: false });
  assert.equal(update.status, 200);
  assert.equal(update.body.settings.periodStartDay, 1);
  assert.equal(update.body.settings.autoHoliday, false);
  assert.deepEqual(update.body.view.period, {
    start: '2026-10-01',
    end: '2026-10-31',
    totalMinutes: 0,
  });

  const refetched = await get('/api/bootstrap');
  assert.equal(refetched.body.settings.periodStartDay, 1);

  const invalidTime = await put('/api/settings', { periodStartDay: 5, overtimeStart: '25:00' });
  assert.equal(invalidTime.status, 400);
  assert.deepEqual(invalidTime.body, { error: 'invalid_settings' });

  const emptyWorkdays = await put('/api/settings', { workdays: [] });
  assert.equal(emptyWorkdays.status, 400);

  const duplicateWorkdays = await put('/api/settings', { workdays: [1, 1, 2] });
  assert.equal(duplicateWorkdays.status, 400);

  const after = await get('/api/bootstrap');
  assert.equal(after.body.settings.periodStartDay, 1);
  assert.equal(after.body.settings.overtimeStart, '19:00');
  assert.deepEqual(after.body.settings.workdays, [1, 2, 3, 4, 5]);
});

test('凌晨可补前日下班', async (t) => {
  const { db, get } = await setup(t, {
    // 上海 2026-10-28 01:41
    now: () => new Date('2026-10-27T17:41:00Z'),
  });
  upsertDay(db, { date: '2026-10-27', inAt: '09:00', outAt: null, outNextDay: 0, isRest: null });

  const { body } = await get('/api/bootstrap');
  assert.deepEqual(body.now, { date: '2026-10-28', time: '01:41' });
  assert.equal(body.today, null);
  assert.deepEqual(body.punch, {
    canIn: true,
    canOut: true,
    delayedOutDate: '2026-10-27',
  });
});
