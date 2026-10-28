# 加班记录应用 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一个部署在个人服务器上的单用户网页应用：手机主屏图标打开，一键上下班打卡，按 26 号起算的周期统计加班时长，支持补录与自动识别中国节假日。

**Architecture:** 单进程 Node.js 服务，Express 同时托管静态前端（原生 HTML/CSS/JS，无构建）与 JSON API；数据存 SQLite；节假日数据从 jsDelivr 拉取后存库，并内置快照兜底；所有时间以服务器 Asia/Shanghai 时区为准。

**Tech Stack:** Node.js 24、Express 4、better-sqlite3、node:test、Docker。

**Spec:** `docs/superpowers/specs/2026-10-28-overtime-tracker-design.md`

## Global Constraints

- Node.js >= 24（`node:test`、原生 `fetch`）；ESM（`"type": "module"`）
- 时区固定 `Asia/Shanghai`，所有“今天/现在”由服务端时钟产生，前端不得自行判断日期
- 打卡与补录时间精度到分钟，`HH:mm`；日期 `YYYY-MM-DD`
- 界面全中文；金额无关，时长显示为“X小时Y分”，日历格子为 `H:MM`
- 单用户、单密码；密码 scrypt 哈希；会话 Cookie 名 `sid`，HttpOnly + SameSite=Lax，30 天
- SQL 全部参数化；前端渲染用户数据只用 `textContent`
- 唯一的外网请求：`https://cdn.jsdelivr.net/npm/chinese-days/dist/chinese-days.json`（超时 10s，响应 < 1 MB），失败不得影响其它功能
- 节假日数据每 7 天刷新一次；每次刷新成功必须整体替换旧数据，失败保留旧数据
- 不允许出现负加班时长；缺上班或缺下班的记录不计入合计

## Review Focus

- 跨零点：00:00–06:00 打卡归属、下班早于上班、06:00 整的边界——任何一天都不能出现负时长或重复计入两个周期
- 周期边界：起始日 26、起始日 1、起始日 28 在 2 月/闰年/跨年时的区间与合计
- 节假日数据：缺失年份、字段异常、超大响应、断网、刷新失败后旧数据仍可用
- 重复提交：快速双击“上班”或“下班”不能产生两条记录或覆盖已打卡时间
- 越权与时间作弊：未登录访问 API、补录未来日期、补录今天晚于当前时刻的时间，都必须被服务端拒绝

---

### Task 1: 脚手架、健康检查与测试基础设施

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `src/config.js`
- Create: `src/app.js`
- Create: `src/server.js`
- Create: `tests/helpers.js`
- Test: `tests/health.test.js`

**Interfaces:**
- Consumes: 无
- Produces:
  - `loadConfig(env = process.env): { port: number, dbPath: string, initialPassword: string, holidayUrl: string }`
  - `createApp({ db, config, fetchImpl = globalThis.fetch, now = () => new Date() }): express.Express`
  - `startServer({ db, config }): { baseUrl: string, close(): Promise<void> }` (测试用，监听 127.0.0.1:0)

- [ ] **Step 1: 初始化项目文件**

`package.json`：

```json
{
  "name": "overtime-tracker",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "scripts": {
    "start": "node src/server.js",
    "test": "node --test"
  },
  "dependencies": {
    "express": "^4.21.2",
    "better-sqlite3": "^12.4.1"
  }
}
```

`.gitignore`：

```
node_modules/
data/
.superpowers/
.playwright-mcp/
*.log
.env
```

- [ ] **Step 2: 安装依赖并生成 lockfile**

Run: `npm install`
Expected: 生成 `package-lock.json`，无报错

- [ ] **Step 3: 写失败测试**

`tests/health.test.js`：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { loadConfig } from '../src/config.js';
import { startServer } from './helpers.js';

test('GET /api/health 返回 ok', async () => {
  const db = openDb(':memory:');
  const server = await startServer({ db, config: loadConfig({}) });
  const res = await fetch(`${server.baseUrl}/api/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  await server.close();
});
```

`tests/helpers.js`：

```js
import { createApp } from '../src/app.js';

export async function startServer({ db, config, fetchImpl, now }) {
  const app = createApp({ db, config, fetchImpl, now });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
```

- [ ] **Step 4: 运行测试确认失败**

Run: `node --test tests/health.test.js`
Expected: FAIL，报找不到模块 `../src/db.js` 或未定义函数

- [ ] **Step 5: 实现最小代码**

`src/config.js`：

```js
export function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT || 3000),
    dbPath: env.DB_PATH || 'data/overtime.db',
    initialPassword: env.INITIAL_PASSWORD || '',
    holidayUrl: 'https://cdn.jsdelivr.net/npm/chinese-days/dist/chinese-days.json',
  };
}
```

`src/app.js`：导出 `createApp({ db, config, fetchImpl, now })`，创建 express app，`app.use(express.json({ limit: '10kb' }))`，注册 `GET /api/health` 返回 `{ ok: true }`，未匹配的 `/api/*` 返回 404 JSON。

`src/server.js`：加载配置、`openDb(config.dbPath)`、`app.listen(config.port)`，打印监听地址。

`src/db.js`：本任务只导出 `openDb(path)`，返回 `new DatabaseSync` 的 better-sqlite3 实例（`import Database from 'better-sqlite3'`），`:memory:` 可用；建表在 Task 5 完成。

- [ ] **Step 6: 运行测试确认通过**

Run: `node --test tests/health.test.js`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add package.json package-lock.json .gitignore src tests
git commit -m "chore: scaffold node service with health endpoint"
```

---

### Task 2: 日期与周期工具

**Files:**
- Create: `src/time.js`
- Test: `tests/time.test.js`

**Interfaces:**
- Consumes: 无
- Produces:
  - `todayInTz(now = new Date()): string` — `YYYY-MM-DD`（Asia/Shanghai）
  - `timeInTz(now = new Date()): string` — `HH:mm`
  - `addDays(date: string, n: number): string`
  - `eachDayInMonth(month: string): string[]` — `month` 为 `YYYY-MM`
  - `weekdayMon(date: string): number` — 1=周一 … 7=周日
  - `monthOf(date: string): string`
  - `periodFor(date: string, startDay: number): { start: string, end: string }`

- [ ] **Step 1: 写失败测试**

`tests/time.test.js` 覆盖：

```js
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
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/time.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `src/time.js`**

所有日期用 UTC 正午构造 `Date.UTC(y, m-1, d, 12)` 做纯日期运算，避免时区漂移；`todayInTz/timeInTz` 用 `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', ... })` 取分量。`periodFor`：`day >= startDay` 时取本月 `startDay` 到次月 `startDay - 1`，否则取上月。`startDay` 仅接受 1–28（由调用方校验）。

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/time.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/time.js tests/time.test.js
git commit -m "feat: add date and payroll period helpers"
```

---

### Task 3: 加班计算与日期类型

**Files:**
- Create: `src/overtime.js`
- Test: `tests/overtime.test.js`

**Interfaces:**
- Consumes: `weekdayMon` from `src/time.js`
- Produces:
  - `hhmmToMinutes(hhmm: string): number`
  - `resolveDayType({ date, isRestOverride, autoHoliday, holidayIsWorkday, holidayName, workdays }): { type: 'work' | 'rest', holidayName: string | null }`
    - `isRestOverride`: `null | 0 | 1`；`holidayIsWorkday`: `null | boolean`（`null` 表示数据未覆盖该日期）；`workdays`: `number[]`（1=周一）
  - `overtimeMinutes({ inAt, outAt, outNextDay, type, overtimeStart }): number`
  - `isIncomplete(day): boolean` — 上班/下班恰好缺一个
  - `formatDuration(minutes: number): string` — `"1小时23分"` / `"1小时"` / `"30分"` / `"0分"`
  - `cellDuration(minutes: number): string` — `"1:23"` / `"8:00"` / `"0:30"`

- [ ] **Step 1: 写失败测试**

`tests/overtime.test.js` 覆盖：

```js
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
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/overtime.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `src/overtime.js`**

- `overtimeMinutes`：缺任一边返回 0；`end = hhmmToMinutes(outAt) + (outNextDay ? 1440 : 0)`；工作日 `from = Math.max(startOfIn, hhmmToMinutes(overtimeStart))`，休息日 `from = startOfIn`；返回 `Math.max(0, end - from)`。
- `resolveDayType`：`isRestOverride` 非 null 优先；否则 `autoHoliday && holidayIsWorkday !== null`；否则 `workdays.includes(weekdayMon(date))`。
- 判断 2026-10-10 为周六、2026-10-12 为周一（用于上面的测试）。

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/overtime.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/overtime.js tests/overtime.test.js
git commit -m "feat: add overtime calculation and day type resolution"
```

---

### Task 4: 节假日数据解析、校验与拉取

**Files:**
- Create: `src/holiday.js`
- Test: `tests/holiday.test.js`

**Interfaces:**
- Consumes: 无
- Produces:
  - `HOLIDAY_URL`（常量，同 Global Constraints）
  - `parseHolidayData(rawText: string): { holidays: Map<string,string>, workdays: Set<string>, coverageMin: string, coverageMax: string }`，格式非法时抛 `Error`（`error.code = 'INVALID_HOLIDAY_DATA'`）
  - `fetchHolidayData(url: string, { fetchImpl = globalThis.fetch, timeoutMs = 10000, maxBytes = 1_000_000 }): Promise<返回同 parseHolidayData>`
  - `holidayLookup(parsed): { isWorkday(date: string): boolean | null, nameOf(date: string): string | null }`

- [ ] **Step 1: 写失败测试**

`tests/holiday.test.js` 覆盖：

```js
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
  assert.equal(l.nameOf('2026-10-12'), null);
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
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/holiday.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `src/holiday.js`**

- 解析前先检查 `rawText.length > maxBytes`（1MB）→ 抛 `INVALID_HOLIDAY_DATA`。
- 校验 `holidays`、`workdays` 均为对象；键匹配 `^\d{4}-\d{2}-\d{2}$` 且是真实日期（用 `Date.UTC` 回读校验）；`holidays` 至少 1 条；值必须是字符串。
- 中文名取 `value.split(',')[1]?.trim()`，没有则用整个 value。
- `coverageMin/Max` 取 `holidays` 全部键的最小/最大值（字符串比较即可）。
- `fetchHolidayData`：`AbortSignal.timeout(timeoutMs)`；非 2xx 抛错；读文本后再做长度与解析校验。

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/holiday.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/holiday.js tests/holiday.test.js
git commit -m "feat: parse, validate and fetch chinese holiday data"
```

---

### Task 5: SQLite 持久化层

**Files:**
- Modify: `src/db.js`
- Test: `tests/db.test.js`

**Interfaces:**
- Consumes: 无
- Produces（全部同步，better-sqlite3）:
  - `openDb(path: string): Database` — 建表、播默认设置
  - `getSettings(db): { periodStartDay, overtimeStart, workdays: number[], autoHoliday: boolean, passwordHash: string | null }`
  - `updateSettings(db, patch): 同 getSettings`
  - `getDay(db, date): Day | null`，`Day = { date, inAt, outAt, outNextDay, isRest }`（`inAt/outAt/isRest` 可为 `null`，`outNextDay` 为 0/1）
  - `listDays(db, from: string, to: string): Day[]`（闭区间，按日期升序）
  - `upsertDay(db, day: Day): void`
  - `deleteDay(db, date: string): void`
  - `getHolidayRow(db): { json, coverageMin, coverageMax, fetchedAt } | null`
  - `saveHolidayRow(db, { json, coverageMin, coverageMax, fetchedAt }): void`
  - `createSession(db, token: string, expiresAt: string): void`
  - `getSession(db, token: string): { token, expiresAt } | null`
  - `deleteSession(db, token: string): void`
  - `deleteExpiredSessions(db, nowIso: string): void`

- [ ] **Step 1: 写失败测试**

`tests/db.test.js` 覆盖：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  openDb, getSettings, updateSettings, getDay, listDays, upsertDay, deleteDay,
  getHolidayRow, saveHolidayRow, createSession, getSession, deleteSession,
} from '../src/db.js';

test('默认设置', () => {
  const db = openDb(':memory:');
  const s = getSettings(db);
  assert.equal(s.periodStartDay, 26);
  assert.equal(s.overtimeStart, '19:00');
  assert.deepEqual(s.workdays, [1, 2, 3, 4, 5]);
  assert.equal(s.autoHoliday, true);
  assert.equal(s.passwordHash, null);
});

test('设置可更新并持久', () => {
  const db = openDb(':memory:');
  updateSettings(db, { periodStartDay: 1, workdays: [1, 2, 3, 4, 5, 6], autoHoliday: false });
  const s = getSettings(db);
  assert.equal(s.periodStartDay, 1);
  assert.deepEqual(s.workdays, [1, 2, 3, 4, 5, 6]);
  assert.equal(s.autoHoliday, false);
});

test('记录增删改查与区间查询', () => {
  const db = openDb(':memory:');
  upsertDay(db, { date: '2026-10-27', inAt: '09:00', outAt: '20:00', outNextDay: 0, isRest: null });
  upsertDay(db, { date: '2026-10-29', inAt: '09:00', outAt: null, outNextDay: 0, isRest: null });
  assert.equal(getDay(db, '2026-10-27').outAt, '20:00');
  assert.deepEqual(listDays(db, '2026-10-28', '2026-10-31').map((d) => d.date), ['2026-10-29']);
  upsertDay(db, { date: '2026-10-27', inAt: '09:00', outAt: '21:00', outNextDay: 0, isRest: 1 });
  assert.equal(getDay(db, '2026-10-27').isRest, 1);
  deleteDay(db, '2026-10-27');
  assert.equal(getDay(db, '2026-10-27'), null);
});

test('节假日行与会话', () => {
  const db = openDb(':memory:');
  saveHolidayRow(db, { json: '{}', coverageMin: '2004-01-01', coverageMax: '2026-12-31', fetchedAt: '2026-10-28T00:00:00.000Z' });
  assert.equal(getHolidayRow(db).coverageMax, '2026-12-31');
  createSession(db, 'tok', '2026-11-28T00:00:00.000Z');
  assert.equal(getSession(db, 'tok').token, 'tok');
  deleteSession(db, 'tok');
  assert.equal(getSession(db, 'tok'), null);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/db.test.js`
Expected: FAIL（导出不存在）

- [ ] **Step 3: 实现 `src/db.js`**

建表 SQL（与 spec 7.2 一致，`settings` 单行 id=1，`holiday_data` 单行 id=1）；`openDb` 设置 `journal_mode = WAL`（`:memory:` 时跳过 WAL）；`workdays` 以逗号字符串存，读取时转数字数组；`autoHoliday` 以 0/1 存。所有语句用 `prepare` + 参数绑定。

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/db.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/db.js tests/db.test.js
git commit -m "feat: add sqlite persistence layer"
```

---

### Task 6: 认证与会话

**Files:**
- Create: `src/auth.js`
- Modify: `src/app.js`
- Test: `tests/auth.test.js`

**Interfaces:**
- Consumes: `getSettings`, `updateSettings`, `createSession`, `getSession`, `deleteSession`, `deleteExpiredSessions` from `src/db.js`
- Produces:
  - `hashPassword(pw: string): string` — `scrypt$<saltHex>$<hashHex>`
  - `verifyPassword(pw: string, stored: string | null): boolean`
  - `createRateLimiter({ limit = 5, windowMs = 60000 })` → `{ check(key): boolean, reset(key): void }`
  - `parseCookies(header: string | undefined): Record<string, string>`
  - `sessionCookie(token: string): string` — 60 位十六进制令牌，`Max-Age=2592000; HttpOnly; SameSite=Lax; Path=/`
  - `requireAuth(db)` — Express 中间件，未登录返回 401 `{ error: 'unauthorized' }`
  - 路由：`POST /api/login`、`POST /api/logout`、`POST /api/password`
- 首次启动：库中无 `passwordHash` 且 `config.initialPassword` 非空时，用其哈希初始化；两者都为空时登录接口返回 503 `{ error: 'not_configured' }`

- [ ] **Step 1: 写失败测试**

`tests/auth.test.js` 覆盖：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, createRateLimiter, parseCookies } from '../src/auth.js';
import { openDb, getSettings } from '../src/db.js';
import { loadConfig } from '../src/config.js';
import { startServer } from './helpers.js';

test('scrypt 哈希与校验', () => {
  const h = hashPassword('secret123');
  assert.equal(verifyPassword('secret123', h), true);
  assert.equal(verifyPassword('wrong', h), false);
  assert.equal(verifyPassword('x', null), false);
  assert.equal(verifyPassword('x', 'garbage'), false);
});

test('限流 5 次后拒绝', () => {
  const rl = createRateLimiter({ limit: 5, windowMs: 60_000 });
  for (let i = 0; i < 5; i++) assert.equal(rl.check('1.1.1.1'), true);
  assert.equal(rl.check('1.1.1.1'), false);
  assert.equal(rl.check('2.2.2.2'), true);
});

test('Cookie 解析', () => {
  assert.deepEqual(parseCookies('a=1; sid=abc'), { a: '1', sid: 'abc' });
  assert.deepEqual(parseCookies(undefined), {});
});

test('登录/登出/改密码流程', async () => {
  const db = openDb(':memory:');
  const server = await startServer({ db, config: loadConfig({ INITIAL_PASSWORD: 'secret123' }) });
  const login = await fetch(`${server.baseUrl}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'secret123' }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /sid=/);
  assert.match(cookie, /HttpOnly/);

  const me = await fetch(`${server.baseUrl}/api/session`, { headers: { cookie } });
  assert.equal(me.status, 200);

  const bad = await fetch(`${server.baseUrl}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'nope' }),
  });
  assert.equal(bad.status, 401);
  await server.close();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/auth.test.js`
Expected: FAIL

- [ ] **Step 3: 实现 `src/auth.js` 与路由**

- `hashPassword` 用 `crypto.scryptSync(pw, salt, 64)`，salt 16 字节随机；`verifyPassword` 解析失败返回 false，比较用 `crypto.timingSafeEqual`。
- 初始化密码：`createApp` 内若 `getSettings(db).passwordHash` 为 null 且 `config.initialPassword` 非空，写入哈希。
- 登录：参数缺失 400；限流用 `req.ip`（`app.set('trust proxy', true)` 关闭，保持直连）；失败 401，成功创建 30 天会话并 `Set-Cookie`。
- `GET /api/session` 返回 `{ ok: true }`（受 `requireAuth` 保护），供测试与前端探活。
- 改密码：`{ oldPassword, newPassword }`，新密码至少 8 位，旧密码错 401；成功后删除该用户所有会话并重发新 Cookie。
- 登出删除会话并清 Cookie（`Max-Age=0`）。
- 登录失败计数按 IP，60 秒窗口，第 6 次返回 429 `{ error: 'too_many_attempts' }`。

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/auth.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/auth.js src/app.js tests/auth.test.js
git commit -m "feat: add password auth with sessions and rate limiting"
```

---

### Task 7: 只读视图（bootstrap）与设置接口

**Files:**
- Create: `src/view.js`
- Modify: `src/app.js`
- Test: `tests/bootstrap.test.js`

**Interfaces:**
- Consumes: `openDb` 系列、`todayInTz`/`timeInTz`/`monthOf`/`periodFor`/`eachDayInMonth`、`resolveDayType`/`overtimeMinutes`/`isIncomplete`/`formatDuration`、`parseHolidayData`/`holidayLookup`、`requireAuth`
- Produces:
  - `buildBootstrap({ db, now = new Date(), month }): Bootstrap`，字段严格如下：

```json
{
  "settings": { "periodStartDay": 26, "overtimeStart": "19:00", "workdays": [1,2,3,4,5], "autoHoliday": true },
  "holiday": { "coverageMin": "2004-01-01", "coverageMax": "2026-12-31", "updatedAt": "2026-10-28T00:00:00.000Z", "auto": true },
  "now": { "date": "2026-10-28", "time": "09:41" },
  "today": null,
  "punch": { "canIn": true, "canOut": false, "delayedOutDate": null },
  "view": {
    "month": "2026-10",
    "period": { "start": "2026-09-26", "end": "2026-10-25", "totalMinutes": 0 },
    "days": [
      { "date": "2026-10-01", "inAt": null, "outAt": null, "outNextDay": 0, "isRest": null,
        "type": "rest", "holidayName": "国庆节", "overtimeMinutes": 0, "incomplete": false }
    ]
  }
}
```

  - `view.month` 缺省为当前月；`view.period` 的锚点：当前月用“今天”，其它月用该月 1 号
  - `view.days` 覆盖该自然月每一天；`today` 与 `view.days` 中同一天的对象同结构
  - `PUT /api/settings`（`?month=YYYY-MM`）返回同一 Bootstrap
- 路由：`GET /api/bootstrap?month=YYYY-MM`、`PUT /api/settings`，均受 `requireAuth` 保护

- [ ] **Step 1: 写失败测试**

`tests/bootstrap.test.js` 覆盖：

```js
// 固定 now = 2026-10-28T01:41:00Z（上海 09:41）
test('未登录返回 401', ...);
test('结构完整、today 为空、可上班不可下班', ...);
test('周期锚点：当前月用今天，其它月用 1 号', ...);
test('合计只统计区间内完整记录，并按分钟累加', ...);   // 10-27 → 20:23 计 83；10-29 只有上班不计
test('日历每天都有，节假日带名称且类型为 rest', ...); // 写入 holiday 行后
test('设置修改后立即重算', ...);                      // periodStartDay 26 → 1
```

登录辅助：用 `POST /api/login` 拿 Cookie 后带 `cookie` 头请求。`startServer` 传入 `now: () => new Date('2026-10-28T01:41:00Z')`。

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/bootstrap.test.js`
Expected: FAIL

- [ ] **Step 3: 实现 `src/view.js` 与路由**

- 读设置与 holiday 行（无数据时 `holiday` 字段为 `{ coverageMin: null, coverageMax: null, updatedAt: null, auto }`）。
- `punch` 计算：`canIn = !today?.inAt`；`canOut = Boolean(today?.inAt && !today?.outAt)`；`delayedOutDate`：当 `now.time` 在 `00:00–05:59` 时，取最近 7 天内“有上班无下班”的最近一天（不含今天）；否则 `null`。若 `delayedOutDate` 存在，`canOut` 也视为可用（响应中 `canOut: true`）。
- `days` 用 `listDays` 取 `min(period.start, month 第一天) .. max(period.end, month 最后一天)` 的记录，再逐日映射；无记录的天补空对象。
- 合计只加 `[period.start, period.end]` 内、`inAt/outAt` 齐全的记录。

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/bootstrap.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/view.js src/app.js tests/bootstrap.test.js
git commit -m "feat: add bootstrap view and settings endpoint"
```

---

### Task 8: 打卡、补录、删除接口

**Files:**
- Create: `src/mutations.js`
- Modify: `src/app.js`
- Test: `tests/mutations.test.js`

**Interfaces:**
- Consumes: `buildBootstrap`、`getDay`/`upsertDay`/`deleteDay`、`todayInTz`/`timeInTz`、`hhmmToMinutes`
- Produces:
  - `punch({ db, now, type }): { status: 200, bootstrap } | { status: 409, error: string }`
  - `saveDay({ db, now, date, body }): { status: 200, bootstrap } | { status: 400|409, error: string }`
  - `removeDay({ db, date }): { status: 200, bootstrap }`
  - 路由：`POST /api/punch`、`PUT /api/days/:date`、`DELETE /api/days/:date`

错误码约定（前端按此显示中文文案）：

| error | 含义 |
| --- | --- |
| `already_in` | 今天已上班 |
| `not_clocked_in` | 当前不可下班，且不在凌晨延迟下班窗口 |
| `invalid_date` | 日期格式错误或晚于今天 |
| `future_time` | 今天的时间晚于当前时刻 |
| `invalid_time` | 时间不是 HH:mm |
| `next_day_conflict` | 跨零点下班的目标次日已有记录 |

- [ ] **Step 1: 写失败测试**

`tests/mutations.test.js` 覆盖（`now` 固定为 `2026-10-28T01:41:00Z`）：

```js
test('上班打卡写入服务器时间', ...);            // → 09:41，canIn=false，canOut=true
test('重复上班返回 409 already_in', ...);
test('下班打卡补全当天', ...);
test('未上班点下班返回 409 not_clocked_in', ...);
test('凌晨 00:00–06:00 可给昨天补下班', ...);   // now=2026-10-29T17:30:00Z（上海 01:30）
test('06:00 起不再提供延迟下班', ...);          // now=2026-10-29T22:00:00Z（上海 06:00）
test('补录：只填上班允许，且不计合计', ...);
test('补录：下班早于上班 → 次日，时长正确', ...); // 09:00→01:00 工作日 6 小时
test('补录：今天晚于当前时间返回 400 future_time', ...); // 10:00 > 09:41
test('补录：未来日期返回 400 invalid_date', ...);
test('补录：非法时间返回 400 invalid_time', ...);
test('补录：跨零点且次日已有记录返回 409 next_day_conflict', ...);
test('删除当天记录后合计归零', ...);
test('isRest=null 恢复默认', ...);
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/mutations.test.js`
Expected: FAIL

- [ ] **Step 3: 实现 `src/mutations.js` 与路由**

打卡：

- `in`：若今天已有 `inAt` → 409；否则 upsert（保留已有 `outAt`/`isRest`），`inAt = timeInTz(now)`。
- `out`：优先补今天的未闭合记录（`outNextDay = 0`）；否则若 `now.time < '06:00'`，取最近 7 天内最近一条“有上班无下班”的日期作为目标（`outNextDay = 1`），若其次日存在任何记录 → 409 `next_day_conflict`；再否则 409。
- 返回该记录所属月份的 Bootstrap。

补录（`PUT /api/days/:date`）：

- `date` 格式合法且 `date <= todayInTz(now)`，否则 400。
- `inAt/outAt` 为 `null` 或 `HH:mm`；若 `date === today` 且时间 `>` `timeInTz(now)` → 400 `future_time`。
- `outNextDay` 推导：`outAt` 存在且（`outAt < inAt` 或 `outAt` 在 `00:00–05:59`）→ 1，否则 0；`outNextDay=1` 且 `addDays(date,1)` 已有记录 → 409。
- `isRest` 只接受 `null | 0 | 1`；三字段全空且 `isRest === null` → 等价删除。
- 返回该日期所在月份的 Bootstrap。

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/mutations.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/mutations.js src/app.js tests/mutations.test.js
git commit -m "feat: add punch, backfill and delete endpoints"
```

---

### Task 9: 节假日数据入库、刷新与定时器

**Files:**
- Create: `src/holiday-store.js`
- Create: `data/chinese-days.json`
- Modify: `src/app.js`
- Modify: `src/server.js`
- Test: `tests/holiday-store.test.js`

**Interfaces:**
- Consumes: `fetchHolidayData`、`parseHolidayData`、`holidayLookup`、`getHolidayRow`/`saveHolidayRow`
- Produces:
  - `seedHolidayIfEmpty(db, { bundledPath = 'data/chinese-days.json' }): { seeded: boolean }`
  - `refreshHoliday({ db, fetchImpl, url }): Promise<{ coverageMin, coverageMax, updatedAt }>` — 失败抛错且不修改库
  - `startHolidayScheduler({ db, fetchImpl, url, intervalMs = 7*24*60*60*1000 }): () => void` — 启动后立即尝试一次（失败吞掉并记录），之后按间隔执行
  - 路由：`POST /api/holidays/refresh`（受保护）→ 成功 `{ holiday: {...} }`，失败 502 `{ error: 'refresh_failed' }`

- [ ] **Step 1: 准备内置快照**

Run: `node -e "fetch('https://cdn.jsdelivr.net/npm/chinese-days/dist/chinese-days.json').then(r=>r.text()).then(t=>require('fs').writeFileSync('data/chinese-days.json', t))"`（在项目根执行）
Expected: `data/chinese-days.json` 大小约 37 KB，能被 `parseHolidayData` 解析；若网络不可用，用前面 npm 包里的 `dist/chinese-days.json` 复制过来

- [ ] **Step 2: 写失败测试**

`tests/holiday-store.test.js` 覆盖：

```js
test('空库时用内置快照播种', ...);            // seeded=true, coverageMax 非空
test('已存在数据时不重复播种', ...);          // seeded=false
test('刷新成功覆盖旧数据', ...);              // 用假 fetchImpl
test('刷新失败保留旧数据并抛错', ...);
test('POST /api/holidays/refresh 成功返回覆盖范围', ...);
test('调度器启动立即执行一次，可停止', ...);   // intervalMs 设大，调用返回的 stop 后不再增加调用次数
```

- [ ] **Step 3: 运行确认失败**

Run: `node --test tests/holiday-store.test.js`
Expected: FAIL

- [ ] **Step 4: 实现 `src/holiday-store.js`**

- 播种：`getHolidayRow` 为空时读内置文件、`parseHolidayData`、`saveHolidayRow`（`fetchedAt = new Date(0).toISOString()` 表示“内置”）。
- 刷新：拉取 → 解析 → `saveHolidayRow`（`fetchedAt = new Date().toISOString()`），返回 meta；任何错误向上抛，库不变。
- 调度器：`setTimeout` 链或 `setInterval`，`unref()`，返回 `stop()`。
- `server.js`：`openDb` 后 `seedHolidayIfEmpty`，再 `startHolidayScheduler`。
- `bootstrap` 的 `holiday` 字段在 Task 7 已从 `getHolidayRow` 读取，本任务只确保数据存在。

- [ ] **Step 5: 运行确认通过**

Run: `node --test tests/holiday-store.test.js`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/holiday-store.js src/app.js src/server.js data/chinese-days.json tests/holiday-store.test.js
git commit -m "feat: seed and refresh holiday data with weekly scheduler"
```

---

### Task 10: 前端外壳、登录与主界面

**Files:**
- Create: `public/index.html`
- Create: `public/styles.css`
- Create: `public/app.js`
- Modify: `src/app.js`（静态托管）
- Test: 手动（Playwright）

**Interfaces:**
- Consumes: 全部 API
- Produces: DOM 契约（Task 11 依赖）：

| 选择器 | 用途 |
| --- | --- |
| `#login-view` / `#login-form` / `#login-password` / `#login-error` | 登录 |
| `#main-view` | 主界面容器 |
| `#period-range` / `#period-total` / `#today-ot` | 统计卡 |
| `#btn-in` / `#btn-out` | 打卡按钮（文案含时间） |
| `#cal-title` / `#cal-prev` / `#cal-next` / `#cal-grid` | 日历 |
| `#settings-btn` | 打开设置 |
| `#toast` | 顶部错误/成功提示 |

- [ ] **Step 1: 实现 `public/index.html` 与 `public/styles.css`**

结构按设计文档 5.1（布局 A）：统计卡 → 并排打卡按钮 → 日历 → （设置入口放统计卡右上角齿轮）。手机竖屏优先，`max-width: 480px` 居中。颜色沿用草图：主色 `#2f45d0`，加班日底 `#e9ecff`，休息日文字 `#b3b8c2`，加班格子小字。

- [ ] **Step 2: 实现 `public/app.js` 的加载与渲染**

```js
const state = { data: null, month: null, editingDate: null };

async function api(path, options = {}) { /* fetch + credentials: 'same-origin'，401 → 显示登录页，非 2xx 抛 {error} */ }
async function load(month = state.month) { state.data = await api(`/api/bootstrap${month ? `?month=${month}` : ''}`); state.month = state.data.view.month; render(); }
function render() { /* 填统计卡、按钮、日历；用 textContent */ }
```

- 登录成功 → `load()`；失败显示 `#login-error`。
- 日历：周一开头；`view.days` 中 `date < period.start || date > period.end` 加 `dim` 类；今天加 `today`；有加班显示 `cellDuration`；`incomplete` 加小圆点。
- 打卡按钮：`punch.canIn/canOut` 控制 disabled；若 `punch.delayedOutDate` 存在，下班按钮文案为“昨天 下班”。
- 点“上班/下班”→ `POST /api/punch` → 用响应 Bootstrap 重绘；409 用中文气泡提示。
- 切月：`month` 用 `addDays` 的等价前端实现（`YYYY-MM` 加减），调用 `load(month)`；今天所在月切回时用包含今天的周期（由服务端按接口规则返回，前端不做判断）。

- [ ] **Step 3: 静态托管**

`src/app.js` 末尾：`app.use(express.static('public', { index: 'index.html' }))`；`app.get('/', ...)` 返回 `public/index.html`；保证 `/api/*` 404 在静态之前注册。

- [ ] **Step 4: 手动验证**

Run: `TZ=Asia/Shanghai INITIAL_PASSWORD=secret123 DB_PATH=data/dev.db npm start`（PowerShell：`$env:TZ='Asia/Shanghai'; $env:INITIAL_PASSWORD='secret123'; $env:DB_PATH='data/dev.db'; npm start`）
Expected（用 Playwright 打开 `http://127.0.0.1:3000`）：
- 未登录时只显示登录页
- 登录后统计卡显示周期范围与“0分”，日历显示当月，今天高亮
- 点“上班”后按钮变为已打卡并显示时间，`#btn-out` 可用

- [ ] **Step 5: 提交**

```bash
git add public src/app.js
git commit -m "feat: add login and main screen frontend"
```

---

### Task 11: 当天记录面板与设置页

**Files:**
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Modify: `public/app.js`
- Test: 手动（Playwright）

**Interfaces:**
- Consumes: `PUT /api/days/:date`、`DELETE /api/days/:date`、`PUT /api/settings`、`POST /api/holidays/refresh`、Task 10 的 DOM 契约
- Produces: 选择器 `#day-sheet`、`#sheet-title`、`#sheet-sub`、`#row-in`、`#row-out`、`#sheet-rest`、`#sheet-reset-rest`、`#sheet-save`、`#sheet-close`、`#sheet-delete`；设置面板 `#settings-panel`、`#set-period-start`、`#set-overtime-start`、`#set-workdays`、`#set-auto-holiday`、`#holiday-meta`、`#holiday-refresh`、`#set-password-old`、`#set-password-new`、`#set-password-save`、`#logout`

- [ ] **Step 1: 实现当天记录面板**

- 点日历任意格 → 用该天数据填面板（标题“10月13日 周二”，副标题“工作日 · 19:00 后算加班 / 休息日 · 全天算加班 / 国庆节 · 全天算加班”）。
- 上班/下班行点击后用 `<input type="time">` 编辑；空值显示“未打卡”。
- “设为休息日/设为工作日”按钮：在 `null → 1 → 0 → null` 之间循环，`null` 时显示“按设置（工作日/休息日）”。
- 保存：`PUT /api/days/:date`，body `{ inAt, outAt, isRest }`，空字符串转 `null`；用响应重绘并关闭；错误按错误码给中文提示（`future_time` → “不能填晚于现在的时间”等）。
- 删除：二次确认（`confirm`）后 `DELETE`。
- 今天与未来日期：未来格点击提示“不能修改未来日期”，不打开面板。

- [ ] **Step 2: 实现设置页**

- 显示数据覆盖范围与最后更新时间（`holiday.coverageMin/Max/updatedAt` 格式化为“2026年10月28日”），`#holiday-refresh` 调用刷新接口，进行中禁用按钮，失败提示“更新失败，继续使用现有数据”。
- 周期起始日（1–28 数字输入）、加班起算时间（`type="time"`）、工作日（7 个复选）、自动识别开关；保存后 `PUT /api/settings?month=...` → 用响应重绘。
- 改密码与退出登录。

- [ ] **Step 3: 手动验证**

Run: 同 Task 10 启动
Expected（Playwright）：
- 点昨天 → 填 09:00/20:23 → 保存 → 日历格子显示 `1:23`，统计卡增加“1小时23分”
- 把该天设为休息日 → 合计变为 11小时23分
- 点今天 → 时间填 23:00 → 提示“不能填晚于现在的时间”
- 改周期起始日为 1 → 统计卡范围变为自然月
- “立即更新”在断网/正常网络下均不破坏已有数据

- [ ] **Step 4: 提交**

```bash
git add public
git commit -m "feat: add day editor sheet and settings panel"
```

---

### Task 12: Docker 打包与部署说明

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.dockerignore`
- Create: `README.md`

**Interfaces:**
- Consumes: 全部
- Produces: 可在服务器上用 `docker compose up -d` 启动的服务；数据卷 `./data`；`/api/health` 健康检查

- [ ] **Step 1: 编写 Docker 文件**

`Dockerfile`：两阶段（builder 装 `python3 make g++` 后 `npm ci --omit=dev`；运行阶段 `node:24-slim`，复制 `src public data package*.json node_modules`，`ENV TZ=Asia/Shanghai NODE_ENV=production`，`EXPOSE 3000`，`RUN mkdir -p /app/data`，`CMD ["node","src/server.js"]`）。容器以 root 运行，保证绑定挂载的 `./data` 在 Linux 服务器上可写。

`docker-compose.yml`：

```yaml
services:
  app:
    build: .
    restart: unless-stopped
    ports:
      - "8080:3000"
    environment:
      TZ: Asia/Shanghai
      DB_PATH: /app/data/overtime.db
      INITIAL_PASSWORD: ${INITIAL_PASSWORD:?set INITIAL_PASSWORD}
    volumes:
      - ./data:/app/data
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
```

`.dockerignore`：`node_modules`、`data`、`.git`、`.superpowers`、`.playwright-mcp`、`docs`。

- [ ] **Step 2: 构建并冒烟测试**

```bash
docker build -t overtime-tracker .
docker run --rm -e INITIAL_PASSWORD=secret123 -e TZ=Asia/Shanghai -p 18080:3000 overtime-tracker
```

Expected：容器启动无报错；`curl http://127.0.0.1:18080/api/health` 返回 `{"ok":true}`；用浏览器登录后打卡可用

- [ ] **Step 3: 验证数据持久化**

停止容器后用同一 `-v "$PWD/data:/app/data"` 重新启动，登录后此前的记录仍在。

- [ ] **Step 4: 写 README**

包含：功能一句话、启动命令、环境变量（`INITIAL_PASSWORD` 必填、`DB_PATH`、`PORT`）、首次登录、数据备份（拷贝 `data/overtime.db`）、节假日数据自动更新与手动刷新、无 HTTPS 的说明（HTTP 仅个人使用）。

- [ ] **Step 5: 提交**

```bash
git add Dockerfile docker-compose.yml .dockerignore README.md
git commit -m "chore: add docker packaging and deployment readme"
```

---

### Task 13: 全流程验收

**Files:**
- Test: 手动（Playwright + 浏览器）

**Interfaces:**
- Consumes: 已部署的本地实例
- Produces: 验收记录（写在提交信息或 PR 描述里，不新增文档文件）

- [ ] **Step 1: 起一个干净的实例**

Run: `docker run --rm -e INITIAL_PASSWORD=secret123 -e TZ=Asia/Shanghai -p 18081:3000 -v "$PWD/acceptance-data:/app/data" overtime-tracker`
Expected: 健康检查通过

- [ ] **Step 2: 按设计文档第 10 节逐条验收**

逐条操作并记录结果：

1. 打开即登录页；登录后看到本周期合计与当月日历
2. 上班打卡 → 按钮状态切换，时间正确
3. 补录昨天 09:00–01:00（次日）→ 工作日时长为 6 小时，不出现负数
4. 点任意一天补录/修改 → 合计与格子立即更新
5. 设为休息日 → 按“下班 − 上班”重算
6. 周期起始日 26 → 1 后，范围与合计按自然月重算
7. 节假日（如 2026-10-01）整天算加班；调休上班日按 19:00 规则
8. 关闭自动识别 → 同一天回到按工作日设置判断
9. “立即更新”在联网时成功、断网时提示失败且旧数据仍可用
10. 重启容器后数据仍在

- [ ] **Step 3: 修复发现的问题并按任务提交**

每个缺陷单独一个 `fix:` 提交，附一句现象与原因。

---

## Self-Review

- **Spec coverage:** 5.1/5.2/5.3 界面 → Task 10/11；6.1 时间 → Task 2/8；6.2 单条记录 → Task 5；6.3 计算与优先级 → Task 3；6.4 跨零点 → Task 3/8；6.5 打卡状态 → Task 7/8；6.6 校验 → Task 8；7.1 架构 → Task 1/12；7.2 数据模型 → Task 5；7.3 API → Task 6/7/8/9；7.4 认证 → Task 6；7.5 测试 → 各任务；节假日拉取 → Task 4/9；第 10 节验收 → Task 13。
- **Step scan:** 每个测试步骤给出名字与断言；代码步骤只给签名、文件与由 spec 固定的值；算法（加班、周期、跨零点判定）在测试里已确定。
- **Type consistency:** `Day`/`Bootstrap` 字段在 Task 5/7/10/11 一致；`outNextDay` 全程为 0/1；`holidayIsWorkday` 为 `null | boolean`；错误码表在 Task 8 定义并在 Task 11 复用。
- **Review Focus:** 跨零点 → Task 3/8 测试；周期边界 → Task 2；节假日异常 → Task 4/9；重复提交 → Task 8 `already_in`；越权与时间作弊 → Task 6/8。
