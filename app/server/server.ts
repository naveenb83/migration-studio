import { createApp, genie, server, serving } from '@databricks/appkit';
import express from 'express';
import { assertConfigured, cfg } from './lib/config';
import { loadPack } from './lib/pack';
import { registerCore } from './routes/core';
import { registerFac } from './routes/fac';
import { registerRuns } from './routes/runs';
import { registerAnalyse } from './routes/analyse';
import { registerGenieCode } from './routes/geniecode';
import { registerUploads } from './routes/uploads';
import { registerWork } from './routes/work';

/*
 * Migration Studio server.
 * - No jobs/files/analytics plugins: their generic HTTP routes would let a client pick any job parameter, path or
 *   query. Every read and write goes through the routes below, scoped to the caller's roster team on the server.
 * - Genie runs on behalf of the user (OBO); the serving plugin's own routes are OBO too.
 * - Caching is off: partners must see each other's edits at once and run status must never freeze.
 */
const spaces = Object.fromEntries(Object.entries(cfg.genieSpaces).filter(([, id]) => Boolean(id)));

createApp({
  plugins: [genie(Object.keys(spaces).length ? { spaces } : {}), server(), serving()],
  cache: { enabled: false },
  async onPluginsReady(appkit) {
    assertConfigured();
    const p = await loadPack();
    console.log(`[studio] pack '${p.engagement.title}' loaded: ${p.teams.length} teams + demo; build ${cfg.buildVersion}`);
    appkit.server.extend((app) => {
      app.use('/api/uploads', express.json({ limit: '12mb' }));
      app.use('/api/genie-analyse/upload', express.json({ limit: '30mb' }));
      app.use('/api', express.json({ limit: '2mb' }));
      registerCore(app);
      registerWork(app);
      registerRuns(app);
      registerUploads(app);
      registerGenieCode(app);
      registerAnalyse(app);
      registerFac(app);
    });
  },
}).catch((e: unknown) => {
  console.error('[studio] failed to start:', e);
  process.exit(1);
});
