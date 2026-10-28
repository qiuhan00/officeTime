import Database from 'better-sqlite3';

export function openDb(path) {
  return new Database(path);
}
