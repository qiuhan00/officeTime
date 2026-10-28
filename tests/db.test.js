import test from 'node:test';
import assert from 'node:assert/strict';
import {
  openDb, getSettings, updateSettings, getDay, listDays, upsertDay, deleteDay,
  getHolidayRow, saveHolidayRow, createSession, getSession, deleteSession,
  deleteExpiredSessions,
} from '../src/db.js';

test('默认设置', () => {
  const db = openDb(':memory:');
  const s = getSettings(db);
  assert.equal(s.periodStartDay, 26);
  assert.equal(s.overtimeStart, '19:00');
  assert.deepEqual(s.workdays, [1, 2, 3, 4, 5]);
  assert.equal(s.autoHoliday, true);
  assert.equal(s.passwordHash, null);
});

test('设置可更新并持久', () => {
  const db = openDb(':memory:');
  updateSettings(db, { periodStartDay: 1, workdays: [1, 2, 3, 4, 5, 6], autoHoliday: false });
  const s = getSettings(db);
  assert.equal(s.periodStartDay, 1);
  assert.deepEqual(s.workdays, [1, 2, 3, 4, 5, 6]);
  assert.equal(s.autoHoliday, false);
});

test('设置部分更新保留未提供字段', () => {
  const db = openDb(':memory:');
  updateSettings(db, { overtimeStart: '18:30' });
  const s = getSettings(db);
  assert.equal(s.overtimeStart, '18:30');
  assert.equal(s.periodStartDay, 26);
  assert.deepEqual(s.workdays, [1, 2, 3, 4, 5]);
  assert.equal(s.autoHoliday, true);
});

test('记录增删改查与区间查询', () => {
  const db = openDb(':memory:');
  upsertDay(db, { date: '2026-10-27', inAt: '09:00', outAt: '20:00', outNextDay: 0, isRest: null });
  upsertDay(db, { date: '2026-10-29', inAt: '09:00', outAt: null, outNextDay: 0, isRest: null });
  assert.equal(getDay(db, '2026-10-27').outAt, '20:00');
  assert.deepEqual(listDays(db, '2026-10-28', '2026-10-31').map((d) => d.date), ['2026-10-29']);
  upsertDay(db, { date: '2026-10-27', inAt: '09:00', outAt: '21:00', outNextDay: 0, isRest: 1 });
  assert.equal(getDay(db, '2026-10-27').isRest, 1);
  deleteDay(db, '2026-10-27');
  assert.equal(getDay(db, '2026-10-27'), null);
});

test('节假日行与会话', () => {
  const db = openDb(':memory:');
  saveHolidayRow(db, { json: '{}', coverageMin: '2004-01-01', coverageMax: '2026-12-31', fetchedAt: '2026-10-28T00:00:00.000Z' });
  assert.equal(getHolidayRow(db).coverageMax, '2026-12-31');
  createSession(db, 'tok', '2026-11-28T00:00:00.000Z');
  assert.equal(getSession(db, 'tok').token, 'tok');
  deleteSession(db, 'tok');
  assert.equal(getSession(db, 'tok'), null);
});

test('清理过期会话', () => {
  const db = openDb(':memory:');
  createSession(db, 'old', '2026-10-27T00:00:00.000Z');
  createSession(db, 'live', '2026-10-29T00:00:00.000Z');
  deleteExpiredSessions(db, '2026-10-28T00:00:00.000Z');
  assert.equal(getSession(db, 'old'), null);
  assert.equal(getSession(db, 'live').token, 'live');
});
