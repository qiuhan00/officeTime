import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { seedHolidayIfEmpty, startHolidayScheduler } from './holiday-store.js';

const config = loadConfig();

if (config.dbPath !== ':memory:') {
  mkdirSync(dirname(resolve(config.dbPath)), { recursive: true });
}

const db = openDb(config.dbPath);
seedHolidayIfEmpty(db);
startHolidayScheduler({ db, fetchImpl: globalThis.fetch, url: config.holidayUrl });
const app = createApp({ db, config });

const server = app.listen(config.port, () => {
  console.log(`Listening on http://127.0.0.1:${server.address().port}`);
});
