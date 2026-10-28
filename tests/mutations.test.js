import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, getDay, upsertDay } from '../src/db.js';
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

  async function request(method, path, body) {
    const headers = { cookie };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`${server.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  }

  return {
    db,
    server,
    cookie,
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    del: (path) => request('DELETE', path),
  };
}

function day(body, date) {
  return body.view.days.find((entry) => entry.date === date);
}

test('上班打卡写入服务器时间', async (t) => {
  const { db, post } = await setup(t);

  const res = await post('/api/punch', { type: 'in' });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.now, { date: '2026-10-28', time: '09:41' });
  assert.deepEqual(res.body.today, {
    date: '2026-10-28',
    inAt: '09:41',
    outAt: null,
    outNextDay: 0,
    isRest: null,
    type: 'work',
    holidayName: null,
    baseType: 'work',
    baseHolidayName: null,
    overtimeMinutes: 0,
    incomplete: true,
  });
  assert.deepEqual(res.body.punch, { canIn: false, canOut: true, delayedOutDate: null });
  assert.equal(res.body.view.month, '2026-10');
  assert.deepEqual(getDay(db, '2026-10-28'), {
    date: '2026-10-28',
    inAt: '09:41',
    outAt: null,
    outNextDay: 0,
    isRest: null,
  });
});

test('重复上班返回 409 already_in', async (t) => {
  const { db, post } = await setup(t);

  assert.equal((await post('/api/punch', { type: 'in' })).status, 200);
  const res = await post('/api/punch', { type: 'in' });

  assert.equal(res.status, 409);
  assert.deepEqual(res.body, { error: 'already_in' });
  assert.deepEqual(getDay(db, '2026-10-28'), {
    date: '2026-10-28',
    inAt: '09:41',
    outAt: null,
    outNextDay: 0,
    isRest: null,
  });
});

test('下班打卡补全当天', async (t) => {
  const { db, post } = await setup(t);

  await post('/api/punch', { type: 'in' });
  const res = await post('/api/punch', { type: 'out' });

  assert.equal(res.status, 200);
  assert.equal(res.body.today.inAt, '09:41');
  assert.equal(res.body.today.outAt, '09:41');
  assert.equal(res.body.today.outNextDay, 0);
  assert.equal(res.body.today.incomplete, false);
  assert.equal(res.body.today.overtimeMinutes, 0);
  assert.deepEqual(res.body.punch, { canIn: false, canOut: false, delayedOutDate: null });
  assert.deepEqual(getDay(db, '2026-10-28'), {
    date: '2026-10-28',
    inAt: '09:41',
    outAt: '09:41',
    outNextDay: 0,
    isRest: null,
  });
});

test('未上班点下班返回 409 not_clocked_in', async (t) => {
  const { db, post } = await setup(t);

  const res = await post('/api/punch', { type: 'out' });

  assert.equal(res.status, 409);
  assert.deepEqual(res.body, { error: 'not_clocked_in' });
  assert.equal(getDay(db, '2026-10-28'), null);
});

test('凌晨 00:00–06:00 可给昨天补下班', async (t) => {
  const { db, post } = await setup(t, {
    // 上海 2026-10-30 01:30
    now: () => new Date('2026-10-29T17:30:00Z'),
  });
  upsertDay(db, {
    date: '2026-10-29',
    inAt: '09:00',
    outAt: null,
    outNextDay: 0,
    isRest: null,
  });

  const res = await post('/api/punch', { type: 'out' });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.now, { date: '2026-10-30', time: '01:30' });
  assert.equal(res.body.today, null);
  assert.deepEqual(getDay(db, '2026-10-29'), {
    date: '2026-10-29',
    inAt: '09:00',
    outAt: '01:30',
    outNextDay: 1,
    isRest: null,
  });
  assert.equal(res.body.view.month, '2026-10');
});

test('06:00 起不再提供延迟下班', async (t) => {
  const { db, get, post } = await setup(t, {
    // 上海 2026-10-30 06:00
    now: () => new Date('2026-10-29T22:00:00Z'),
  });
  upsertDay(db, {
    date: '2026-10-29',
    inAt: '09:00',
    outAt: null,
    outNextDay: 0,
    isRest: null,
  });

  const bootstrap = await get('/api/bootstrap');
  assert.equal(bootstrap.body.now.time, '06:00');
  assert.deepEqual(bootstrap.body.punch, {
    canIn: true,
    canOut: false,
    delayedOutDate: null,
  });

  const res = await post('/api/punch', { type: 'out' });
  assert.equal(res.status, 409);
  assert.deepEqual(res.body, { error: 'not_clocked_in' });
  assert.equal(getDay(db, '2026-10-29').outAt, null);
});

test('补录：只填上班允许，且不计合计', async (t) => {
  const { db, put } = await setup(t);

  const res = await put('/api/days/2026-10-27', { inAt: '09:00' });

  assert.equal(res.status, 200);
  assert.equal(res.body.view.month, '2026-10');
  assert.deepEqual(res.body.view.period, {
    start: '2026-10-26',
    end: '2026-11-25',
    totalMinutes: 0,
  });
  assert.deepEqual(day(res.body, '2026-10-27'), {
    date: '2026-10-27',
    inAt: '09:00',
    outAt: null,
    outNextDay: 0,
    isRest: null,
    type: 'work',
    holidayName: null,
    baseType: 'work',
    baseHolidayName: null,
    overtimeMinutes: 0,
    incomplete: true,
  });
  assert.deepEqual(getDay(db, '2026-10-27'), {
    date: '2026-10-27',
    inAt: '09:00',
    outAt: null,
    outNextDay: 0,
    isRest: null,
  });
});

test('补录：下班早于上班 → 次日，时长正确', async (t) => {
  const { db, put } = await setup(t);

  const res = await put('/api/days/2026-10-27', {
    inAt: '09:00',
    outAt: '01:00',
    isRest: null,
  });

  assert.equal(res.status, 200);
  const resolved = day(res.body, '2026-10-27');
  assert.equal(resolved.outNextDay, 1);
  assert.equal(resolved.overtimeMinutes, 360);
  assert.equal(resolved.incomplete, false);
  assert.equal(res.body.view.period.totalMinutes, 360);
  assert.equal(getDay(db, '2026-10-27').outNextDay, 1);
});

test('补录：今天晚于当前时间返回 400 future_time', async (t) => {
  const { put } = await setup(t);

  const res = await put('/api/days/2026-10-28', { inAt: '10:00' });

  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: 'future_time' });
});

test('补录：未来日期返回 400 invalid_date', async (t) => {
  const { put } = await setup(t);

  const res = await put('/api/days/2026-10-29', { inAt: '09:00' });

  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: 'invalid_date' });
});

test('补录：非法日期格式或不存在日期返回 400 invalid_date', async (t) => {
  const { put } = await setup(t);

  const malformed = await put('/api/days/not-a-date', { inAt: '09:00' });
  assert.equal(malformed.status, 400);
  assert.deepEqual(malformed.body, { error: 'invalid_date' });

  const impossible = await put('/api/days/2026-02-30', { inAt: '09:00' });
  assert.equal(impossible.status, 400);
  assert.deepEqual(impossible.body, { error: 'invalid_date' });
});

test('补录：非法时间返回 400 invalid_time', async (t) => {
  const { put } = await setup(t);

  const shortHour = await put('/api/days/2026-10-27', { inAt: '9:00' });
  assert.equal(shortHour.status, 400);
  assert.deepEqual(shortHour.body, { error: 'invalid_time' });

  const badHour = await put('/api/days/2026-10-27', { outAt: '24:00' });
  assert.equal(badHour.status, 400);
  assert.deepEqual(badHour.body, { error: 'invalid_time' });
});

test('补录：跨零点且次日已有记录返回 409 next_day_conflict', async (t) => {
  const { db, put } = await setup(t);
  upsertDay(db, {
    date: '2026-10-28',
    inAt: '08:00',
    outAt: null,
    outNextDay: 0,
    isRest: null,
  });

  const res = await put('/api/days/2026-10-27', {
    inAt: '09:00',
    outAt: '01:00',
    isRest: null,
  });

  assert.equal(res.status, 409);
  assert.deepEqual(res.body, { error: 'next_day_conflict' });
  assert.equal(getDay(db, '2026-10-27'), null);
});

test('删除当天记录后合计归零', async (t) => {
  const { db, del, get } = await setup(t);
  upsertDay(db, {
    date: '2026-10-28',
    inAt: '09:00',
    outAt: '20:00',
    outNextDay: 0,
    isRest: null,
  });

  const before = await get('/api/bootstrap');
  assert.equal(before.body.view.period.totalMinutes, 60);

  const res = await del('/api/days/2026-10-28');

  assert.equal(res.status, 200);
  assert.equal(res.body.today, null);
  assert.equal(res.body.view.period.totalMinutes, 0);
  assert.equal(getDay(db, '2026-10-28'), null);
});

test('isRest=null 恢复默认', async (t) => {
  const { db, get, put } = await setup(t);
  upsertDay(db, {
    date: '2026-10-27',
    inAt: '09:00',
    outAt: '19:00',
    outNextDay: 0,
    isRest: 1,
  });

  const before = await get('/api/bootstrap');
  assert.equal(day(before.body, '2026-10-27').type, 'rest');

  const res = await put('/api/days/2026-10-27', {
    inAt: '09:00',
    outAt: '19:00',
    isRest: null,
  });

  assert.equal(res.status, 200);
  assert.equal(day(res.body, '2026-10-27').isRest, null);
  assert.equal(day(res.body, '2026-10-27').type, 'work');
});

test('补录：非法 isRest 返回 400 invalid_rest', async (t) => {
  const { put } = await setup(t);

  const res = await put('/api/days/2026-10-27', {
    inAt: '09:00',
    outAt: '19:00',
    isRest: 2,
  });

  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: 'invalid_rest' });
});

test('打卡：非法 type 返回 400 invalid_type', async (t) => {
  const { post } = await setup(t);

  const res = await post('/api/punch', { type: 'sideways' });

  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: 'invalid_type' });
});

test('补录：缺少或非法请求体返回 400 invalid_body', async (t) => {
  const { db, server, cookie } = await setup(t);

  const missing = await fetch(`${server.baseUrl}/api/days/2026-10-27`, {
    method: 'PUT',
    headers: { cookie },
  });
  assert.equal(missing.status, 400);
  assert.deepEqual(await missing.json(), { error: 'invalid_body' });

  const array = await fetch(`${server.baseUrl}/api/days/2026-10-27`, {
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/json' },
    body: '[]',
  });
  assert.equal(array.status, 400);
  assert.deepEqual(await array.json(), { error: 'invalid_body' });

  const empty = await fetch(`${server.baseUrl}/api/days/2026-10-27`, {
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(empty.status, 400);
  assert.deepEqual(await empty.json(), { error: 'invalid_body' });
  assert.equal(getDay(db, '2026-10-27'), null);
});

test('补录：显式全 null 等价删除', async (t) => {
  const { db, put } = await setup(t);
  upsertDay(db, {
    date: '2026-10-27',
    inAt: '09:00',
    outAt: '19:00',
    outNextDay: 0,
    isRest: 1,
  });

  const res = await put('/api/days/2026-10-27', { inAt: null, outAt: null, isRest: null });

  assert.equal(res.status, 200);
  assert.equal(getDay(db, '2026-10-27'), null);

  const again = await put('/api/days/2026-10-27', { inAt: null, outAt: null, isRest: null });
  assert.equal(again.status, 200);
  assert.equal(getDay(db, '2026-10-27'), null);
});

test('补录：上下班时间相同不计加班', async (t) => {
  const { put } = await setup(t);

  const res = await put('/api/days/2026-10-27', {
    inAt: '09:00',
    outAt: '09:00',
    isRest: null,
  });

  assert.equal(res.status, 200);
  const resolved = day(res.body, '2026-10-27');
  assert.equal(resolved.outNextDay, 0);
  assert.equal(resolved.overtimeMinutes, 0);
  assert.equal(resolved.incomplete, false);
});

test('补录：凌晨相等时间记 0 且不判次日（工作日与休息日）', async (t) => {
  const { put } = await setup(t);

  for (const time of ['00:00', '01:00', '05:59', '06:00']) {
    const work = await put('/api/days/2026-10-27', {
      inAt: time,
      outAt: time,
      isRest: null,
    });
    assert.equal(work.status, 200, `work ${time}`);
    const workDay = day(work.body, '2026-10-27');
    assert.equal(workDay.outNextDay, 0, `work outNextDay ${time}`);
    assert.equal(workDay.overtimeMinutes, 0, `work overtime ${time}`);

    const rest = await put('/api/days/2026-10-27', {
      inAt: time,
      outAt: time,
      isRest: 1,
    });
    assert.equal(rest.status, 200, `rest ${time}`);
    const restDay = day(rest.body, '2026-10-27');
    assert.equal(restDay.outNextDay, 0, `rest outNextDay ${time}`);
    assert.equal(restDay.overtimeMinutes, 0, `rest overtime ${time}`);
  }
});

test('补录：相等时间不触发次日冲突', async (t) => {
  const { db, put } = await setup(t);
  upsertDay(db, {
    date: '2026-10-28',
    inAt: '08:00',
    outAt: '18:00',
    outNextDay: 0,
    isRest: null,
  });

  const res = await put('/api/days/2026-10-27', {
    inAt: '01:00',
    outAt: '01:00',
    isRest: null,
  });

  assert.equal(res.status, 200);
  assert.equal(day(res.body, '2026-10-27').outNextDay, 0);
  assert.equal(getDay(db, '2026-10-27').outNextDay, 0);
});

test('补录：有效下班时间在未来返回 400 future_time', async (t) => {
  const { put } = await setup(t);

  const cases = [
    ['2026-10-28', { inAt: '09:00', outAt: '01:00' }],
    ['2026-10-28', { outAt: '01:00' }],
    ['2026-10-27', { inAt: '22:00', outAt: '10:00' }],
    ['2026-10-27', { inAt: '23:00', outAt: '22:00' }],
  ];

  for (const [date, body] of cases) {
    const res = await put(`/api/days/${date}`, { ...body, isRest: null });
    assert.equal(res.status, 400, `${date} ${JSON.stringify(body)}`);
    assert.deepEqual(res.body, { error: 'future_time' });
  }
});

test('补录：昨天跨零点且有效下班时间已过仍可保存', async (t) => {
  const { db, put } = await setup(t);

  const res = await put('/api/days/2026-10-27', {
    inAt: '22:00',
    outAt: '01:00',
    isRest: null,
  });

  assert.equal(res.status, 200);
  assert.equal(day(res.body, '2026-10-27').outNextDay, 1);
  assert.equal(getDay(db, '2026-10-27').outNextDay, 1);
});

test('凌晨只给昨天补下班，更早的缺口不处理', async (t) => {
  const { db, post } = await setup(t, {
    // 上海 2026-10-30 01:30，昨天是 10-29
    now: () => new Date('2026-10-29T17:30:00Z'),
  });
  upsertDay(db, {
    date: '2026-10-27',
    inAt: '09:00',
    outAt: null,
    outNextDay: 0,
    isRest: null,
  });

  const tooOld = await post('/api/punch', { type: 'out' });
  assert.equal(tooOld.status, 409);
  assert.deepEqual(tooOld.body, { error: 'not_clocked_in' });
  assert.equal(getDay(db, '2026-10-27').outAt, null);

  upsertDay(db, {
    date: '2026-10-29',
    inAt: '09:00',
    outAt: null,
    outNextDay: 0,
    isRest: null,
  });

  const found = await post('/api/punch', { type: 'out' });
  assert.equal(found.status, 200);
  assert.equal(getDay(db, '2026-10-29').outAt, '01:30');
  assert.equal(getDay(db, '2026-10-27').outAt, null);
});

test('凌晨重复点下班：第一次成功，第二次 409 且不关闭更早记录', async (t) => {
  const { db, post } = await setup(t, {
    // 上海 2026-10-30 01:30，昨天是 10-29
    now: () => new Date('2026-10-29T17:30:00Z'),
  });
  upsertDay(db, {
    date: '2026-10-29',
    inAt: '09:00',
    outAt: null,
    outNextDay: 0,
    isRest: null,
  });
  upsertDay(db, {
    date: '2026-10-27',
    inAt: '09:00',
    outAt: null,
    outNextDay: 0,
    isRest: null,
  });

  const first = await post('/api/punch', { type: 'out' });
  assert.equal(first.status, 200);
  assert.equal(getDay(db, '2026-10-29').outAt, '01:30');

  const second = await post('/api/punch', { type: 'out' });
  assert.equal(second.status, 409);
  assert.deepEqual(second.body, { error: 'not_clocked_in' });
  assert.equal(getDay(db, '2026-10-27').outAt, null);
});

test('打卡跨月补下班返回目标月份', async (t) => {
  const { db, post } = await setup(t, {
    // 上海 2026-11-01 01:30
    now: () => new Date('2026-10-31T17:30:00Z'),
  });
  upsertDay(db, {
    date: '2026-10-31',
    inAt: '09:00',
    outAt: null,
    outNextDay: 0,
    isRest: null,
  });

  const res = await post('/api/punch', { type: 'out' });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.now, { date: '2026-11-01', time: '01:30' });
  assert.equal(res.body.view.month, '2026-10');
  assert.equal(day(res.body, '2026-10-31').outAt, '01:30');
});

test('删除其它月份返回该月 Bootstrap', async (t) => {
  const { db, del } = await setup(t);
  upsertDay(db, {
    date: '2026-09-15',
    inAt: '09:00',
    outAt: '20:00',
    outNextDay: 0,
    isRest: null,
  });

  const res = await del('/api/days/2026-09-15');

  assert.equal(res.status, 200);
  assert.equal(res.body.view.month, '2026-09');
  assert.equal(getDay(db, '2026-09-15'), null);
});

test('凌晨补下班：目标次日已有记录返回 409 next_day_conflict', async (t) => {
  const { db, post } = await setup(t, {
    // 上海 2026-10-30 01:30
    now: () => new Date('2026-10-29T17:30:00Z'),
  });
  upsertDay(db, {
    date: '2026-10-29',
    inAt: '09:00',
    outAt: null,
    outNextDay: 0,
    isRest: null,
  });
  upsertDay(db, {
    date: '2026-10-30',
    inAt: '00:10',
    outAt: '00:20',
    outNextDay: 0,
    isRest: null,
  });

  const res = await post('/api/punch', { type: 'out' });

  assert.equal(res.status, 409);
  assert.deepEqual(res.body, { error: 'next_day_conflict' });
  assert.equal(getDay(db, '2026-10-29').outAt, null);
});

test('删除：非法日期返回 400 invalid_date', async (t) => {
  const { del } = await setup(t);

  const future = await del('/api/days/2026-10-29');
  assert.equal(future.status, 400);
  assert.deepEqual(future.body, { error: 'invalid_date' });

  const malformed = await del('/api/days/2026-1-1');
  assert.equal(malformed.status, 400);
  assert.deepEqual(malformed.body, { error: 'invalid_date' });
});

test('打卡、补录、删除都需要登录', async (t) => {
  const db = openDb(':memory:');
  const server = await startServer({
    db,
    config: loadConfig({ INITIAL_PASSWORD: 'secret123' }),
    now: NOW,
  });
  t.after(() => server.close());

  const punch = await fetch(`${server.baseUrl}/api/punch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'in' }),
  });
  assert.equal(punch.status, 401);

  const save = await fetch(`${server.baseUrl}/api/days/2026-10-27`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ inAt: '09:00' }),
  });
  assert.equal(save.status, 401);

  const remove = await fetch(`${server.baseUrl}/api/days/2026-10-27`, {
    method: 'DELETE',
  });
  assert.equal(remove.status, 401);
});
