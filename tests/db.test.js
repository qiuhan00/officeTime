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
  assert.equal(s.loginRequired, true);
  assert.equal(s.passwordHash, null);
});

test('登录开关可更新', () => {
  const db = openDb(':memory:');
  updateSettings(db, { loginRequired: false });
  assert.equal(getSettings(db).loginRequired, false);
  updateSettings(db, { loginRequired: true });
  assert.equal(getSettings(db).loginRequired, true);
});

test('旧库缺少 login_required 列时自动补齐', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const Database = (await import('better-sqlite3')).default;

  const dir = await mkdtemp(join(tmpdir(), 'overtime-migrate-'));
  const file = join(dir, 'old.db');
  const legacy = new Database(file);
  legacy.exec(`
    CREATE TABLE settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      period_start_day INTEGER NOT NULL DEFAULT 26,
      overtime_start TEXT NOT NULL DEFAULT '19:00',
      workdays TEXT NOT NULL DEFAULT '1,2,3,4,5',
      auto_holiday INTEGER NOT NULL DEFAULT 1,
      password_hash TEXT,
      updated_at TEXT
    );
    INSERT INTO settings (id) VALUES (1);
  `);
  legacy.close();

  const db = openDb(file);
  assert.equal(getSettings(db).loginRequired, true);
  db.close();
  await rm(dir, { recursive: true, force: true });
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
