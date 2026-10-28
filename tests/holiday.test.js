import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHolidayData, fetchHolidayData, holidayLookup } from '../src/holiday.js';

const sample = JSON.stringify({
  holidays: { '2026-10-01': "National Day,国庆节,7", '2026-10-02': "National Day,国庆节,7" },
  workdays: { '2026-10-10': "National Day,国庆节,7" },
  inLieuDays: {},
});

test('解析出节假日、调休日与覆盖范围', () => {
  const p = parseHolidayData(sample);
  assert.equal(p.holidays.get('2026-10-01'), '国庆节');
  assert.equal(p.workdays.has('2026-10-10'), true);
  assert.equal(p.coverageMin, '2026-10-01');
  assert.equal(p.coverageMax, '2026-10-10');
});

test('查询：调休工作日 true、节假日 false、未知 null', () => {
  const l = holidayLookup(parseHolidayData(sample));
  assert.equal(l.isWorkday('2026-10-10'), true);
  assert.equal(l.isWorkday('2026-10-01'), false);
  assert.equal(l.isWorkday('2026-10-12'), null);
  assert.equal(l.nameOf('2026-10-01'), '国庆节');
  assert.equal(l.nameOf('2026-10-10'), '国庆节');
  assert.equal(l.nameOf('2026-10-12'), null);
});

test('覆盖年份需在 2004–2100 之间', () => {
  const valid = JSON.stringify({
    holidays: { '2004-01-01': 'x,元旦' },
    workdays: { '2100-12-31': 'x,调休' },
  });
  assert.doesNotThrow(() => parseHolidayData(valid));

  for (const date of ['2003-12-31', '2101-01-01']) {
    const raw = JSON.stringify({ holidays: { [date]: 'x,元旦' }, workdays: {} });
    assert.throws(() => parseHolidayData(raw), (error) => error.code === 'INVALID_HOLIDAY_DATA');
  }

  const workdayRaw = JSON.stringify({
    holidays: { '2026-10-01': 'x,国庆节' },
    workdays: { '2003-12-31': 'x,调休' },
  });
  assert.throws(() => parseHolidayData(workdayRaw), (error) => error.code === 'INVALID_HOLIDAY_DATA');
});

test('非法数据被拒绝', () => {
  assert.throws(() => parseHolidayData('not json'), /INVALID_HOLIDAY_DATA|Unexpected/);
  assert.throws(() => parseHolidayData(JSON.stringify({ holidays: {} })), (e) => e.code === 'INVALID_HOLIDAY_DATA');
  assert.throws(() => parseHolidayData(JSON.stringify({ holidays: { '2026-13-01': 'x' }, workdays: {} })), (e) => e.code === 'INVALID_HOLIDAY_DATA');
  assert.throws(() => parseHolidayData('x'.repeat(1_000_001)), (e) => e.code === 'INVALID_HOLIDAY_DATA');
});

test('拉取：超时/非 2xx/超大响应都失败', async () => {
  const ok = async () => new Response(sample, { status: 200 });
  assert.equal((await fetchHolidayData('http://x', { fetchImpl: ok })).coverageMin, '2026-10-01');
  const bad = async () => new Response('err', { status: 500 });
  await assert.rejects(fetchHolidayData('http://x', { fetchImpl: bad }));
  const huge = async () => new Response('x'.repeat(1_000_001), { status: 200 });
  await assert.rejects(fetchHolidayData('http://x', { fetchImpl: huge }));
});
