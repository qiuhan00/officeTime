import express from 'express';

export function createApp({ db, config, fetchImpl = globalThis.fetch, now = () => new Date() }) {
  const app = express();
  app.use(express.json({ limit: '10kb' }));

  app.get('/api/health', (req, res) => {
    res.json({ ok: true });
  });

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  return app;
}
