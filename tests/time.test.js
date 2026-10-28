import test from 'node:test';
import assert from 'node:assert/strict';
import {
  todayInTz, timeInTz, addDays, eachDayInMonth, weekdayMon, monthOf, periodFor,
} from '../src/time.js';

test('按上海时区取日期和时间', () => {
  const d = new Date('2026-10-27T17:05:00Z'); // 上海 2026-10-28 01:05
  assert.equal(todayInTz(d), '2026-10-28');
  assert.equal(timeInTz(d), '01:05');
});

test('周期：26 日之后属于本月 26 日起的周期', () => {
  assert.deepEqual(periodFor('2026-10-28', 26), { start: '2026-10-26', end: '2026-11-25' });
});

test('周期：26 日之前属于上月 26 日起的周期', () => {
  assert.deepEqual(periodFor('2026-10-01', 26), { start: '2026-09-26', end: '2026-10-25' });
});

test('周期：起始日为 1 时等于自然月', () => {
  assert.deepEqual(periodFor('2026-02-15', 1), { start: '2026-02-01', end: '2026-02-28' });
});

test('周期：跨年与闰年 2 月', () => {
  assert.deepEqual(periodFor('2027-01-03', 26), { start: '2026-12-26', end: '2027-01-25' });
  assert.deepEqual(periodFor('2028-03-01', 28), { start: '2028-02-28', end: '2028-03-27' });
});

test('每月天数与星期', () => {
  assert.equal(eachDayInMonth('2026-02').length, 28);
  assert.equal(eachDayInMonth('2028-02').length, 29);
  assert.equal(eachDayInMonth('2026-10').at(-1), '2026-10-31');
  assert.equal(weekdayMon('2026-10-26'), 1);
  assert.equal(weekdayMon('2026-10-28'), 3);
  assert.equal(monthOf('2026-10-28'), '2026-10');
});

test('加减天数跨月跨年', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
});
