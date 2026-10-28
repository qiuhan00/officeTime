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
