import { getDay, upsertDay, deleteDay } from './db.js';
import { addDays, monthOf, timeInTz, todayInTz } from './time.js';
import { hhmmToMinutes } from './overtime.js';
import { buildBootstrap } from './view.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DELAY_WINDOW_START = '06:00';

function fail(status, error) {
  return { status, error };
}

function has(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function ok(db, now, month) {
  return { status: 200, bootstrap: buildBootstrap({ db, now, month }) };
}

function isRealDate(date) {
  return DATE_RE.test(date) && addDays(date, 0) === date;
}

function isTime(value) {
  return value === null || (typeof value === 'string' && TIME_RE.test(value));
}

function isAfter(a, b) {
  return hhmmToMinutes(a) > hhmmToMinutes(b);
}

export function punch({ db, now, type }) {
  if (type !== 'in' && type !== 'out') {
    return fail(400, 'invalid_type');
  }

  const today = todayInTz(now);
  const currentTime = timeInTz(now);

  if (type === 'in') {
    const existing = getDay(db, today);
    if (existing?.inAt) {
      return fail(409, 'already_in');
    }

    upsertDay(db, {
      date: today,
      inAt: currentTime,
      outAt: existing?.outAt ?? null,
      outNextDay: existing?.outNextDay ?? 0,
      isRest: existing?.isRest ?? null,
    });
    return ok(db, now, monthOf(today));
  }

  const todayRecord = getDay(db, today);
  if (todayRecord?.inAt && !todayRecord.outAt) {
    upsertDay(db, {
      date: today,
      inAt: todayRecord.inAt,
      outAt: currentTime,
      outNextDay: 0,
      isRest: todayRecord.isRest,
    });
    return ok(db, now, monthOf(today));
  }

  if (currentTime < DELAY_WINDOW_START) {
    const date = addDays(today, -1);
    const record = getDay(db, date);
    if (record?.inAt && !record.outAt) {
      if (getDay(db, addDays(date, 1))) {
        return fail(409, 'next_day_conflict');
      }

      upsertDay(db, {
        date,
        inAt: record.inAt,
        outAt: currentTime,
        outNextDay: 1,
        isRest: record.isRest,
      });
      return ok(db, now, monthOf(date));
    }
  }

  return fail(409, 'not_clocked_in');
}

export function saveDay({ db, now, date, body }) {
  const today = todayInTz(now);
  if (typeof date !== 'string' || !isRealDate(date) || date > today) {
    return fail(400, 'invalid_date');
  }

  if (!isPlainObject(body)) {
    return fail(400, 'invalid_body');
  }

  const hasIn = has(body, 'inAt');
  const hasOut = has(body, 'outAt');
  const hasRest = has(body, 'isRest');
  if (!hasIn && !hasOut && !hasRest) {
    return fail(400, 'invalid_body');
  }

  const inAt = hasIn ? (body.inAt ?? null) : null;
  const outAt = hasOut ? (body.outAt ?? null) : null;
  const isRest = hasRest ? (body.isRest ?? null) : null;

  if (!isTime(inAt) || !isTime(outAt)) {
    return fail(400, 'invalid_time');
  }

  if (isRest !== null && isRest !== 0 && isRest !== 1) {
    return fail(400, 'invalid_rest');
  }

  const explicitDelete = hasIn && hasOut && hasRest
    && inAt === null && outAt === null && isRest === null;

  if (!explicitDelete && inAt === null && outAt === null && isRest === null) {
    return fail(400, 'invalid_body');
  }

  const equalTimes = inAt !== null && outAt !== null && inAt === outAt;
  let outNextDay = 0;
  if (outAt !== null && !equalTimes) {
    const overnight = (inAt !== null && hhmmToMinutes(outAt) < hhmmToMinutes(inAt))
      || outAt < DELAY_WINDOW_START;
    outNextDay = overnight ? 1 : 0;
  }

  const currentTime = timeInTz(now);
  if (date === today && inAt !== null && isAfter(inAt, currentTime)) {
    return fail(400, 'future_time');
  }

  if (outAt !== null) {
    const effectiveOutDate = outNextDay === 1 ? addDays(date, 1) : date;
    if (
      effectiveOutDate > today
      || (effectiveOutDate === today && isAfter(outAt, currentTime))
    ) {
      return fail(400, 'future_time');
    }
  }

  if (outNextDay === 1 && getDay(db, addDays(date, 1))) {
    return fail(409, 'next_day_conflict');
  }

  if (explicitDelete) {
    deleteDay(db, date);
    return ok(db, now, monthOf(date));
  }

  upsertDay(db, { date, inAt, outAt, outNextDay, isRest });
  return ok(db, now, monthOf(date));
}

export function removeDay({ db, now = new Date(), date }) {
  const today = todayInTz(now);
  if (typeof date !== 'string' || !isRealDate(date) || date > today) {
    return fail(400, 'invalid_date');
  }

  deleteDay(db, date);
  return ok(db, now, monthOf(date));
}
