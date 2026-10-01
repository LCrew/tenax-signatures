import path from 'node:path';
import { buildApp } from './app.js';
import { AppContext } from './context.js';
import { SqliteRepository } from './db/sqlite.js';
import { loadEnv } from './env.js';
import { newSetupToken } from './auth/local.js';
import { seedIfEmpty } from './services/settings.js';
import { MockDirectory } from './services/directory.js';

const env = loadEnv();
const repo = new SqliteRepository(path.join(env.dataDir, 'signature.db'));
const ctx = new AppContext(env, repo);
const app = await buildApp(ctx);

seedIfEmpty(repo, env, ctx.settings, (m) => app.log.info(m));

// Mock mode: load the fixture overrides once (e.g. test.panel's corrected title).
if (ctx.settings.get().directoryMode === 'mock' && repo.listOverrides().length === 0) {
  const dir = ctx.directory();
  if (dir instanceof MockDirectory) {
    for (const o of dir.fixtureOverrides) repo.saveOverrides({ ...o, updatedBy: 'fixtures' });
  }
}

if (repo.countAdmins() === 0) {
  ctx.setupToken = env.setupToken?.toUpperCase() ?? newSetupToken();
  const url = ctx.settings.get().publicUrl;
  const banner = [
    '',
    '╔══════════════════════════════════════════════════════════════╗',
    '║  First launch: open the admin console and enter this code    ║',
    `║  Setup code:  ${ctx.setupToken.padEnd(47)}║`,
    `║  Local:       http://localhost:${String(env.port).padEnd(30)}║`,
    `║  Public:      ${url.slice(0, 47).padEnd(47)}║`,
    '╚══════════════════════════════════════════════════════════════╝',
    '',
  ].join('\n');
  // Plain stdout so it's readable in `docker logs` regardless of log format.
  process.stdout.write(banner + '\n');
}

if (env.mockAuthHeader) app.log.warn('Mock mode: X-Mock-User header authentication is ENABLED (development only)');

const shutdown = async () => {
  await app.close();
  repo.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: env.port, host: env.host });
