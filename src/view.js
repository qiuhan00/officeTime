import {
  getSettings,
  getDay,
  getHolidayRow,
  listDays,
} from './db.js';
import {
  addDays,
  eachDayInMonth,
  monthOf,
  periodFor,
  timeInTz,
  todayInTz,
} from './time.js';
import {
  isIncomplete,
  overtimeMinutes,
  resolveDayType,
} from './overtime.js';
import { holidayLookup, parseHolidayData } from './holiday.js';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function has(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function parseMonthParam(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !MONTH_RE.test(value)) {
    const error = new Error('invalid_month');
    error.code = 'invalid_month';
    throw error;
  }
  return value;
}

export function validateSettingsPatch(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return null;
  }

  const patch = {};

  if (has(body, 'periodStartDay')) {
    const value = body.periodStartDay;
    if (!Number.isInteger(value) || value < 1 || value > 28) return null;
    patch.periodStartDay = value;
  }

  if (has(body, 'overtimeStart')) {
    const value = body.overtimeStart;
    if (typeof value !== 'string' || !TIME_RE.test(value)) return null;
    patch.overtimeStart = value;
  }

  if (has(body, 'workdays')) {
    const value = body.workdays;
    if (!Array.isArray(value) || value.length === 0) return null;
    if (!value.every((day) => Number.isInteger(day) && day >= 1 && day <= 7)) {
      return null;
    }
    if (new Set(value).size !== value.length) return null;
    patch.workdays = value;
  }

  if (has(body, 'autoHoliday')) {
    if (typeof body.autoHoliday !== 'boolean') return null;
    patch.autoHoliday = body.autoHoliday;
  }

  return patch;
}

function holidayLookupFrom(row) {
  if (!row) return null;
  try {
    return holidayLookup(parseHolidayData(row.json));
  } catch {
    return null;
  }
}

function makeDayResolver({ settings, lookup }) {
  return function resolveDay(date, record) {
    const inAt = record?.inAt ?? null;
    const outAt = record?.outAt ?? null;
    const outNextDay = record?.outNextDay ?? 0;
    const isRest = record?.isRest ?? null;
    const holidayIsWorkday = lookup ? lookup.isWorkday(date) : null;
    const holiday = lookup ? lookup.nameOf(date) : null;

    const { type, holidayName } = resolveDayType({
      date,
      isRestOverride: isRest,
      autoHoliday: settings.autoHoliday,
      holidayIsWorkday,
      holidayName: holiday,
      workdays: settings.workdays,
    });

    return {
      date,
      inAt,
      outAt,
      outNextDay,
      isRest,
      type,
      holidayName,
      overtimeMinutes: overtimeMinutes({
        inAt,
        outAt,
        outNextDay,
        type,
        overtimeStart: settings.overtimeStart,
      }),
      incomplete: isIncomplete({ inAt, outAt }),
    };
  };
}

export function buildBootstrap({ db, now = new Date(), month } = {}) {
  const todayDate = todayInTz(now);
  const currentTime = timeInTz(now);
  const viewMonth = parseMonthParam(month) ?? monthOf(todayDate);

  const settings = getSettings(db);
  const row = getHolidayRow(db);
  const lookup = holidayLookupFrom(row);

  const { passwordHash: _passwordHash, ...publicSettings } = settings;

  const holiday = {
    coverageMin: row?.coverageMin ?? null,
    coverageMax: row?.coverageMax ?? null,
    updatedAt: row?.fetchedAt ?? null,
    auto: settings.autoHoliday,
  };

  const anchor = viewMonth === monthOf(todayDate) ? todayDate : `${viewMonth}-01`;
  const period = periodFor(anchor, settings.periodStartDay);

  const monthDays = eachDayInMonth(viewMonth);
  const monthFirst = monthDays[0];
  const monthLast = monthDays[monthDays.length - 1];
  const from = period.start < monthFirst ? period.start : monthFirst;
  const to = period.end > monthLast ? period.end : monthLast;

  const records = new Map(listDays(db, from, to).map((record) => [record.date, record]));
  const resolveDay = makeDayResolver({ settings, lookup });

  let totalMinutes = 0;
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const day = resolveDay(date, records.get(date));
    if (date >= period.start && date <= period.end && day.inAt && day.outAt) {
      totalMinutes += day.overtimeMinutes;
    }
  }

  const days = monthDays.map((date) => resolveDay(date, records.get(date)));

  const todayRecord = records.has(todayDate) ? records.get(todayDate) : getDay(db, todayDate);
  const today = todayRecord ? resolveDay(todayDate, todayRecord) : null;

  let delayedOutDate = null;
  if (currentTime < '06:00') {
    for (let offset = 1; offset <= 7; offset += 1) {
      const date = addDays(todayDate, -offset);
      const record = getDay(db, date);
      if (record && record.inAt && !record.outAt) {
        delayedOutDate = date;
        break;
      }
    }
  }

  return {
    settings: publicSettings,
    holiday,
    now: { date: todayDate, time: currentTime },
    today,
    punch: {
      canIn: !today?.inAt,
      canOut: Boolean(today?.inAt && !today?.outAt) || delayedOutDate !== null,
      delayedOutDate,
    },
    view: {
      month: viewMonth,
      period: { start: period.start, end: period.end, totalMinutes },
      days,
    },
  };
}
