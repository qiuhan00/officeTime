export function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT || 3000),
    dbPath: env.DB_PATH || 'data/overtime.db',
    initialPassword: env.INITIAL_PASSWORD || '',
    holidayUrl: 'https://cdn.jsdelivr.net/npm/chinese-days/dist/chinese-days.json',
  };
}
