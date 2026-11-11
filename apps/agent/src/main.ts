import express from 'express';
import helmet from 'helmet';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import * as sites from './sites';
const app = express();
app.use(helmet());
app.use(express.json({ limit: '2mb' }));
const secret = process.env.AGENT_TOKEN;
if (!secret || secret.length < 64) throw new Error('AGENT_TOKEN must be at least 64 characters');
app.use((req, res, next) => {
  const a = Buffer.from(req.get('authorization') || '');
  const b = Buffer.from(`Bearer ${secret}`);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    return res.status(401).json({ error: 'Invalid agent credentials' });
  next();
});
app.get('/v1/health', async (_req, res) => res.json(await sites.health()));
app.put('/v1/sites/:id', async (req, res) =>
  res.json(await sites.provision(req.params.id, req.body)),
);
app.get('/v1/sites/:id', async (req, res) => res.json(await sites.inspect(req.params.id)));
app.get('/v1/sites/:id/backups', async (req, res) => res.json(await sites.backups(req.params.id)));
app.get('/v1/sites/:id/files', async (req, res) =>
  res.json(
    await sites.files(
      req.params.id,
      'list',
      z
        .string()
        .max(2000)
        .parse(req.query.path || '/'),
    ),
  ),
);
app.get('/v1/sites/:id/file', async (req, res) =>
  res.json(await sites.files(req.params.id, 'read', z.string().max(2000).parse(req.query.path))),
);
app.put('/v1/sites/:id/file', async (req, res) => {
  const d = z
    .object({ path: z.string().max(2000), content: z.string().max(1048576) })
    .parse(req.body);
  res.json(await sites.files(req.params.id, 'write', d.path, d.content));
});
app.post('/v1/sites/:id/database', async (req, res) =>
  res.json(await sites.database(req.params.id)),
);
app.post('/v1/sites/:id/certificate', async (req, res) =>
  res.json(await sites.certificate(req.params.id, z.email().parse(req.body.email))),
);
app.post('/v1/sites/:id/actions', async (req, res) => {
  const d = z
    .object({ action: z.enum(['suspend', 'unsuspend', 'backup', 'restore', 'terminate']) })
    .passthrough()
    .parse(req.body);
  res.json(await sites.action(req.params.id, d.action, d));
});
app.use(
  (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(400).json({
      error: { message: error instanceof Error ? error.message : 'Agent operation failed' },
    });
  },
);
app.listen(Number(process.env.AGENT_PORT || 8085), process.env.AGENT_HOST || '127.0.0.1', () =>
  console.log('Harbor web agent listening'),
);
