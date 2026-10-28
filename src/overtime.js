import { weekdayMon } from './time.js';

export function hhmmToMinutes(hhmm) {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return hours * 60 + minutes;
}

export function resolveDayType({
  date, isRestOverride, autoHoliday, holidayIsWorkday, holidayName, workdays,
}) {
  if (isRestOverride != null) {
    return { type: isRestOverride ? 'rest' : 'work', holidayName: null };
  }
  if (autoHoliday && holidayIsWorkday != null) {
    return { type: holidayIsWorkday ? 'work' : 'rest', holidayName };
  }
  return {
    type: workdays.includes(weekdayMon(date)) ? 'work' : 'rest',
    holidayName: null,
  };
}

export function overtimeMinutes({
  inAt, outAt, outNextDay, type, overtimeStart,
}) {
  if (!inAt || !outAt) return 0;
  const end = hhmmToMinutes(outAt) + (outNextDay ? 1440 : 0);
  const start = hhmmToMinutes(inAt);
  const from = type === 'work' ? Math.max(start, hhmmToMinutes(overtimeStart)) : start;
  return Math.max(0, end - from);
}

export function isIncomplete(day) {
  return Boolean(day.inAt) !== Boolean(day.outAt);
}

export function formatDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours > 0 && rest > 0) return `${hours}小时${rest}分`;
  if (hours > 0) return `${hours}小时`;
  return `${rest}分`;
}

export function cellDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}:${String(rest).padStart(2, '0')}`;
}
