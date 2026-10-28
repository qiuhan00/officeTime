import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HOLIDAY_URL, fetchHolidayData, parseHolidayData } from './holiday.js';
import { getHolidayRow, saveHolidayRow } from './db.js';

const BUNDLED_FETCHED_AT = new Date(0).toISOString();
const DEFAULT_BUNDLED_PATH = join(import.meta.dirname, '..', 'assets', 'chinese-days.json');

export function seedHolidayIfEmpty(db, { bundledPath = DEFAULT_BUNDLED_PATH } = {}) {
  if (getHolidayRow(db) !== null) {
    return { seeded: false };
  }

  const rawText = readFileSync(bundledPath, 'utf8');
  const parsed = parseHolidayData(rawText);

  saveHolidayRow(db, {
    json: rawText,
    coverageMin: parsed.coverageMin,
    coverageMax: parsed.coverageMax,
    fetchedAt: BUNDLED_FETCHED_AT,
  });

  return { seeded: true };
}

export async function refreshHoliday({ db, fetchImpl = globalThis.fetch, url = HOLIDAY_URL } = {}) {
  const fetched = await fetchHolidayData(url, { fetchImpl });
  const updatedAt = new Date().toISOString();

  saveHolidayRow(db, {
    json: fetched.rawText,
    coverageMin: fetched.coverageMin,
    coverageMax: fetched.coverageMax,
    fetchedAt: updatedAt,
  });

  return {
    coverageMin: fetched.coverageMin,
    coverageMax: fetched.coverageMax,
    updatedAt,
  };
}

export function startHolidayScheduler({
  db,
  fetchImpl = globalThis.fetch,
  url = HOLIDAY_URL,
  intervalMs = 7 * 24 * 60 * 60 * 1000,
  logger = console,
} = {}) {
  let stopped = false;
  const run = () => {
    Promise.resolve()
      .then(() => {
        if (stopped) return;
        return refreshHoliday({ db, fetchImpl, url });
      })
      .catch((error) => {
        logger.warn?.(`holiday refresh failed: ${error.message}`);
      });
  };

  run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
