import Database from 'better-sqlite3';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  period_start_day INTEGER NOT NULL DEFAULT 26,
  overtime_start TEXT NOT NULL DEFAULT '19:00',
  workdays TEXT NOT NULL DEFAULT '1,2,3,4,5',
  auto_holiday INTEGER NOT NULL DEFAULT 1,
  login_required INTEGER NOT NULL DEFAULT 1,
  password_hash TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS days (
  date TEXT PRIMARY KEY,
  in_at TEXT,
  out_at TEXT,
  out_next_day INTEGER NOT NULL DEFAULT 0,
  is_rest INTEGER,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS holiday_data (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT NOT NULL,
  coverage_min TEXT NOT NULL,
  coverage_max TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
`;

function toSettings(row) {
  return {
    periodStartDay: row.period_start_day,
    overtimeStart: row.overtime_start,
    workdays: row.workdays === '' ? [] : row.workdays.split(',').map(Number),
    autoHoliday: row.auto_holiday === 1,
    loginRequired: row.login_required === 1,
    passwordHash: row.password_hash ?? null,
  };
}

function toDay(row) {
  return {
    date: row.date,
    inAt: row.in_at,
    outAt: row.out_at,
    outNextDay: row.out_next_day,
    isRest: row.is_rest,
  };
}

export function openDb(path) {
  const db = new Database(path);
  if (path !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }
  db.exec(SCHEMA);
  migrate(db);
  db.prepare('INSERT OR IGNORE INTO settings (id) VALUES (1)').run();
  return db;
}

function migrate(db) {
  const columns = new Set(
    db.prepare('PRAGMA table_info(settings)').all().map((column) => column.name),
  );
  if (!columns.has('login_required')) {
    db.exec('ALTER TABLE settings ADD COLUMN login_required INTEGER NOT NULL DEFAULT 1');
  }
}

export function getSettings(db) {
  const row = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  return toSettings(row);
}

export function updateSettings(db, patch) {
  const row = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  const has = (key) => Object.prototype.hasOwnProperty.call(patch, key);
  const periodStartDay = has('periodStartDay') ? patch.periodStartDay : row.period_start_day;
  const overtimeStart = has('overtimeStart') ? patch.overtimeStart : row.overtime_start;
  const workdays = has('workdays') ? patch.workdays.join(',') : row.workdays;
  const autoHoliday = has('autoHoliday') ? (patch.autoHoliday ? 1 : 0) : row.auto_holiday;
  const loginRequired = has('loginRequired') ? (patch.loginRequired ? 1 : 0) : row.login_required;
  const passwordHash = has('passwordHash') ? patch.passwordHash : row.password_hash;

  db.prepare(`
    UPDATE settings
    SET period_start_day = ?, overtime_start = ?, workdays = ?, auto_holiday = ?,
        login_required = ?, password_hash = ?, updated_at = ?
    WHERE id = 1
  `).run(periodStartDay, overtimeStart, workdays, autoHoliday, loginRequired, passwordHash, new Date().toISOString());

  return getSettings(db);
}

export function getDay(db, date) {
  const row = db.prepare('SELECT * FROM days WHERE date = ?').get(date);
  return row ? toDay(row) : null;
}

export function listDays(db, from, to) {
  return db
    .prepare('SELECT * FROM days WHERE date >= ? AND date <= ? ORDER BY date ASC')
    .all(from, to)
    .map(toDay);
}

export function upsertDay(db, day) {
  db.prepare(`
    INSERT INTO days (date, in_at, out_at, out_next_day, is_rest, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      in_at = excluded.in_at,
      out_at = excluded.out_at,
      out_next_day = excluded.out_next_day,
      is_rest = excluded.is_rest,
      updated_at = excluded.updated_at
  `).run(
    day.date,
    day.inAt ?? null,
    day.outAt ?? null,
    day.outNextDay ? 1 : 0,
    day.isRest ?? null,
    new Date().toISOString(),
  );
}

export function deleteDay(db, date) {
  db.prepare('DELETE FROM days WHERE date = ?').run(date);
}

export function getHolidayRow(db) {
  const row = db.prepare('SELECT * FROM holiday_data WHERE id = 1').get();
  if (!row) return null;
  return {
    json: row.json,
    coverageMin: row.coverage_min,
    coverageMax: row.coverage_max,
    fetchedAt: row.fetched_at,
  };
}

export function saveHolidayRow(db, { json, coverageMin, coverageMax, fetchedAt }) {
  db.prepare(`
    INSERT INTO holiday_data (id, json, coverage_min, coverage_max, fetched_at)
    VALUES (1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      json = excluded.json,
      coverage_min = excluded.coverage_min,
      coverage_max = excluded.coverage_max,
      fetched_at = excluded.fetched_at
  `).run(json, coverageMin, coverageMax, fetchedAt);
}

export function createSession(db, token, expiresAt) {
  db.prepare('INSERT INTO sessions (token, created_at, expires_at) VALUES (?, ?, ?)')
    .run(token, new Date().toISOString(), expiresAt);
}

export function getSession(db, token) {
  const row = db.prepare('SELECT token, expires_at FROM sessions WHERE token = ?').get(token);
  return row ? { token: row.token, expiresAt: row.expires_at } : null;
}

export function deleteSession(db, token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function deleteExpiredSessions(db, nowIso) {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso);
}
