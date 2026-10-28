import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hhmmToMinutes, resolveDayType, overtimeMinutes, isIncomplete, formatDuration, cellDuration,
} from '../src/overtime.js';

const work = { type: 'work' };

test('工作日：19:00 后按分钟精确', () => {
  assert.equal(overtimeMinutes({ inAt: '09:00', outAt: '20:23', outNextDay: 0, type: 'work', overtimeStart: '19:00' }), 83);
  assert.equal(overtimeMinutes({ inAt: '20:00', outAt: '22:00', outNextDay: 0, type: 'work', overtimeStart: '19:00' }), 120);
  assert.equal(overtimeMinutes({ inAt: '09:00', outAt: '18:30', outNextDay: 0, type: 'work', overtimeStart: '19:00' }), 0);
  assert.equal(overtimeMinutes({ inAt: '09:00', outAt: '19:00', outNextDay: 0, type: 'work', overtimeStart: '19:00' }), 0);
  assert.equal(overtimeMinutes({ inAt: '09:00', outAt: '19:01', outNextDay: 0, type: 'work', overtimeStart: '19:00' }), 1);
});

test('休息日：全天都算', () => {
  assert.equal(overtimeMinutes({ inAt: '10:00', outAt: '12:30', outNextDay: 0, type: 'rest', overtimeStart: '19:00' }), 150);
});

test('跨零点按次日计算', () => {
  assert.equal(overtimeMinutes({ inAt: '22:00', outAt: '01:00', outNextDay: 1, type: 'rest', overtimeStart: '19:00' }), 180);
  assert.equal(overtimeMinutes({ inAt: '09:00', outAt: '01:00', outNextDay: 1, type: 'work', overtimeStart: '19:00' }), 360);
});

test('缺任一边不计时长', () => {
  assert.equal(overtimeMinutes({ inAt: '09:00', outAt: null, outNextDay: 0, type: 'work', overtimeStart: '19:00' }), 0);
  assert.equal(overtimeMinutes({ inAt: null, outAt: '21:00', outNextDay: 0, type: 'rest', overtimeStart: '19:00' }), 0);
});

test('日期类型优先级：手动 > 节假日 > 工作日设置 > 兜底', () => {
  const base = { date: '2026-10-10', isRestOverride: null, autoHoliday: true, holidayIsWorkday: null, holidayName: null, workdays: [1, 2, 3, 4, 5] };
  assert.deepEqual(resolveDayType({ ...base, isRestOverride: 0, holidayIsWorkday: false }), { type: 'work', holidayName: null });
  assert.deepEqual(resolveDayType({ ...base, holidayIsWorkday: false, holidayName: '国庆节' }), { type: 'rest', holidayName: '国庆节' });
  assert.deepEqual(resolveDayType({ ...base, holidayIsWorkday: true, holidayName: '春节调休' }), { type: 'work', holidayName: '春节调休' });
  assert.deepEqual(resolveDayType({ ...base, date: '2026-10-10' }), { type: 'rest', holidayName: null });
  assert.deepEqual(resolveDayType({ ...base, autoHoliday: false, holidayIsWorkday: false }), { type: 'rest', holidayName: null });
  assert.deepEqual(resolveDayType({ ...base, date: '2026-10-12' }), { type: 'work', holidayName: null });
});

test('时长格式', () => {
  assert.equal(formatDuration(0), '0分');
  assert.equal(formatDuration(30), '30分');
  assert.equal(formatDuration(60), '1小时');
  assert.equal(formatDuration(83), '1小时23分');
  assert.equal(formatDuration(150), '2小时30分');
  assert.equal(cellDuration(83), '1:23');
  assert.equal(cellDuration(480), '8:00');
  assert.equal(cellDuration(30), '0:30');
});

test('不完整记录判定', () => {
  assert.equal(isIncomplete({ inAt: '09:00', outAt: null }), true);
  assert.equal(isIncomplete({ inAt: null, outAt: '19:00' }), true);
  assert.equal(isIncomplete({ inAt: '09:00', outAt: '19:00' }), false);
  assert.equal(hhmmToMinutes('19:01'), 1141);
});
