import { readFileSync } from 'node:fs';
import { HOLIDAY_URL, parseHolidayData } from './holiday.js';
import { getHolidayRow, saveHolidayRow } from './db.js';

const BUNDLED_FETCHED_AT = new Date(0).toISOString();
const FETCH_TIMEOUT_MS = 10_000;

function fetchParsed(rawText) {
  const parsed = parseHolidayData(rawText);
  return { parsed, json: rawText };
}

export function seedHolidayIfEmpty(db, { bundledPath = 'data/chinese-days.json' } = {}) {
  if (getHolidayRow(db) !== null) {
    return { seeded: false };
  }

  const rawText = readFileSync(bundledPath, 'utf8');
  const { parsed } = fetchParsed(rawText);

  saveHolidayRow(db, {
    json: rawText,
    coverageMin: parsed.coverageMin,
    coverageMax: parsed.coverageMax,
    fetchedAt: BUNDLED_FETCHED_AT,
  });

  return { seeded: true };
}

export async function refreshHoliday({ db, fetchImpl = globalThis.fetch, url = HOLIDAY_URL } = {}) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`holiday fetch failed with status ${response.status}`);
  }

  const { parsed, json } = fetchParsed(await response.text());
  const updatedAt = new Date().toISOString();

  saveHolidayRow(db, {
    json,
    coverageMin: parsed.coverageMin,
    coverageMax: parsed.coverageMax,
    fetchedAt: updatedAt,
  });

  return {
    coverageMin: parsed.coverageMin,
    coverageMax: parsed.coverageMax,
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
  const run = () => {
    Promise.resolve()
      .then(() => refreshHoliday({ db, fetchImpl, url }))
      .catch((error) => {
        logger.warn?.(`holiday refresh failed: ${error.message}`);
      });
  };

  run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();

  return () => clearInterval(timer);
}
