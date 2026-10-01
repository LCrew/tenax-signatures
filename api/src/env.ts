import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// Repo root in dev (api/src → ..), image root in Docker (/app/api/dist → ..).
const repoRoot = path.resolve(here, '..', '..');

export interface Env {
  nodeEnv: string;
  isProduction: boolean;
  port: number;
  host: string;
  dataDir: string;
  configDir: string;
  templatesDir: string;
  assetsDir: string;
  fixturesPath: string;
  adminDistDir: string;
  addinDistDir: string;
  /** Forces the directory to fixtures regardless of what the setup wizard saved. */
  mockGraph: boolean;
  /** Dev-only X-Mock-User header. Never true in production (asserted at startup). */
  mockAuthHeader: boolean;
  setupToken?: string;
  appSecret?: string;
  publicUrl?: string;
  /** true = trust the proxy hop on loopback/private networks; or an explicit list like "10.0.0.0/8,loopback". */
  trustProxy: boolean | string;
  logLevel: string;
}

export function loadEnv(overrides: Partial<Env> = {}): Env {
  const e = process.env;
  const nodeEnv = e.NODE_ENV ?? 'development';
  const isProduction = nodeEnv === 'production';
  const mockGraph = e.MOCK_GRAPH === 'true';
  const env: Env = {
    nodeEnv,
    isProduction,
    port: Number(e.PORT ?? 8085),
    host: e.HOST ?? '0.0.0.0',
    dataDir: path.resolve(e.DATA_DIR ?? path.join(repoRoot, 'data')),
    configDir: path.resolve(e.CONFIG_DIR ?? path.join(repoRoot, 'config')),
    templatesDir: path.resolve(e.TEMPLATES_DIR ?? path.join(repoRoot, 'templates')),
    assetsDir: path.resolve(e.ASSETS_DIR ?? path.join(repoRoot, 'assets')),
    fixturesPath: path.resolve(e.FIXTURES_PATH ?? path.join(repoRoot, 'fixtures', 'users.json')),
    adminDistDir: path.resolve(e.ADMIN_DIST_DIR ?? path.join(repoRoot, 'admin', 'dist')),
    addinDistDir: path.resolve(e.ADDIN_DIST_DIR ?? path.join(repoRoot, 'addin', 'dist')),
    mockGraph,
    // The header is tied to mock mode AND a non-production build. There is no env var that turns it on by itself.
    mockAuthHeader: mockGraph && !isProduction,
    setupToken: e.SETUP_TOKEN || undefined,
    appSecret: e.APP_SECRET || undefined,
    publicUrl: e.PUBLIC_URL?.replace(/\/+$/, '') || undefined,
    trustProxy: e.TRUST_PROXY === 'true' ? true : e.TRUST_PROXY && e.TRUST_PROXY !== 'false' ? e.TRUST_PROXY : false,
    logLevel: e.LOG_LEVEL ?? 'info',
    ...overrides,
  };
  assertSafe(env);
  return env;
}

/** Startup assertion required by the brief: the mock auth header can never be live in production. */
export function assertSafe(env: Env): void {
  if (env.isProduction && env.mockAuthHeader) {
    throw new Error('FATAL: X-Mock-User auth cannot be enabled when NODE_ENV=production');
  }
  if (env.isProduction && env.setupToken && env.setupToken.replace(/[^A-Za-z0-9]/g, '').length < 16) {
    throw new Error('FATAL: SETUP_TOKEN must have at least 16 letters/digits (or leave it empty for a random one)');
  }
}
