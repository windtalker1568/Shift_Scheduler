import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { ZodError } from 'zod';
import { config } from './config';
import { connectDb } from './db';
import { HttpError } from './lib/errors';
import { Person, Settings, getSettings } from './models';
import { router } from './routes';

async function main() {
  await connectDb();
  await getSettings();
  // self-heal the counter behind the 500-person cap
  await Settings.updateOne({ key: 'main' }, { $set: { activeCount: await Person.countDocuments({ active: true }) } });

  const app = express();
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '2mb' }));
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/api', router);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, details: err.details });
    if (err instanceof ZodError) return res.status(400).json({ error: err.issues.map((i) => i.message).join('; '), details: err.issues });
    if (err?.code === 11000) return res.status(409).json({ error: 'That value is already used (duplicate E-mail Address, team number or entry)' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server' });
  });
  app.listen(config.port, () => console.log(`API listening on http://localhost:${config.port}`));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
