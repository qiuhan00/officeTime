const TZ = 'Asia/Shanghai';

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function pad(n) {
  return String(n).padStart(2, '0');
}

function partsOf(formatter, now) {
  return Object.fromEntries(
    formatter.formatToParts(now).map((part) => [part.type, part.value]),
  );
}

function parseDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  return { y, m, d };
}

function makeDate(y, m, d) {
  return new Date(Date.UTC(y, m - 1, d, 12));
}

function formatDate(dt) {
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function todayInTz(now = new Date()) {
  const parts = partsOf(dateFormatter, now);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function timeInTz(now = new Date()) {
  const parts = partsOf(timeFormatter, now);
  return `${parts.hour}:${parts.minute}`;
}

export function addDays(date, n) {
  const { y, m, d } = parseDate(date);
  return formatDate(makeDate(y, m, d + n));
}

export function eachDayInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const days = makeDate(y, m + 1, 0).getUTCDate();
  return Array.from({ length: days }, (_, i) => `${month}-${pad(i + 1)}`);
}

export function weekdayMon(date) {
  const { y, m, d } = parseDate(date);
  const weekday = makeDate(y, m, d).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

export function monthOf(date) {
  return date.slice(0, 7);
}

export function periodFor(date, startDay) {
  const { y, m, d } = parseDate(date);

  let startYear = y;
  let startMonth = m;
  if (d < startDay) {
    startMonth -= 1;
    if (startMonth === 0) {
      startMonth = 12;
      startYear -= 1;
    }
  }

  let endYear = startYear;
  let endMonth = startMonth + 1;
  if (endMonth === 13) {
    endMonth = 1;
    endYear += 1;
  }

  return {
    start: formatDate(makeDate(startYear, startMonth, startDay)),
    end: formatDate(makeDate(endYear, endMonth, startDay - 1)),
  };
}
