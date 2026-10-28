export const HOLIDAY_URL = 'https://cdn.jsdelivr.net/npm/chinese-days/dist/chinese-days.json';

const DEFAULT_MAX_BYTES = 1_000_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function invalid(message) {
  const error = new Error(message);
  error.code = 'INVALID_HOLIDAY_DATA';
  return error;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isRealDate(date) {
  if (!DATE_PATTERN.test(date)) return false;
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y
    && dt.getUTCMonth() === m - 1
    && dt.getUTCDate() === d;
}

function chineseName(value) {
  return value.split(',')[1]?.trim() || value;
}

function assertEntries(source, label) {
  for (const [date, value] of Object.entries(source)) {
    if (!isRealDate(date)) {
      throw invalid(`${label} contains invalid date: ${date}`);
    }
    if (typeof value !== 'string') {
      throw invalid(`${label} value for ${date} must be a string`);
    }
  }
}

export function parseHolidayData(rawText, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
  if (typeof rawText !== 'string') {
    throw invalid('holiday data must be a string');
  }
  if (rawText.length > maxBytes) {
    throw invalid(`holiday data exceeds ${maxBytes} bytes`);
  }

  let data;
  try {
    data = JSON.parse(rawText);
  } catch (cause) {
    throw invalid(`holiday data is not valid JSON: ${cause.message}`);
  }

  if (!isPlainObject(data)) {
    throw invalid('holiday data must be an object');
  }
  if (!isPlainObject(data.holidays)) {
    throw invalid('holidays must be an object');
  }
  if (!isPlainObject(data.workdays)) {
    throw invalid('workdays must be an object');
  }

  assertEntries(data.holidays, 'holidays');
  assertEntries(data.workdays, 'workdays');

  const holidayKeys = Object.keys(data.holidays);
  if (holidayKeys.length === 0) {
    throw invalid('holidays must contain at least one entry');
  }

  const holidays = new Map(
    holidayKeys.map((date) => [date, chineseName(data.holidays[date])]),
  );
  const workdays = new Set(Object.keys(data.workdays));
  const allKeys = [...holidayKeys, ...workdays];
  const coverageMin = allKeys.reduce((min, date) => (date < min ? date : min));
  const coverageMax = allKeys.reduce((max, date) => (date > max ? date : max));

  return { holidays, workdays, coverageMin, coverageMax };
}

export async function fetchHolidayData(
  url,
  { fetchImpl = globalThis.fetch, timeoutMs = 10000, maxBytes = DEFAULT_MAX_BYTES } = {},
) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    throw new Error(`holiday fetch failed with status ${response.status}`);
  }
  const rawText = await response.text();
  return parseHolidayData(rawText, { maxBytes });
}

export function holidayLookup(parsed) {
  return {
    isWorkday(date) {
      if (parsed.workdays.has(date)) return true;
      if (parsed.holidays.has(date)) return false;
      return null;
    },
    nameOf(date) {
      return parsed.holidays.get(date) ?? null;
    },
  };
}
