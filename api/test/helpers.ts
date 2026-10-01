import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { buildApp } from '../src/app.js';
import { AppContext } from '../src/context.js';
import { SqliteRepository } from '../src/db/sqlite.js';
import { loadEnv, type Env } from '../src/env.js';
import { MockDirectory } from '../src/services/directory.js';
import { seedIfEmpty } from '../src/services/settings.js';

export const TENANT = '11111111-2222-3333-4444-555555555555';
export const CLIENT = '66666666-7777-8888-9999-000000000000';
export const APP_ID_URI = `api://sig.tenax.lv/${CLIENT}`;

const root = path.resolve(import.meta.dirname, '..', '..');

export async function makeKeys() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
  return { privateKey, jwks: createLocalJWKSet({ keys: [jwk] }) };
}

export async function signToken(
  privateKey: CryptoKey,
  claims: Record<string, unknown>,
  opts: { aud?: string; iss?: string; exp?: string | number } = {},
) {
  return new SignJWT({ tid: TENANT, scp: 'Signature.Read', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(opts.iss ?? `https://login.microsoftonline.com/${TENANT}/v2.0`)
    .setAudience(opts.aud ?? APP_ID_URI)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '10m')
    .sign(privateKey);
}

/** A fully seeded app on a temp data dir, backed by fixtures/users.json. */
export async function makeApp(envOverrides: Partial<Env> = {}, opts: { withKeys?: boolean } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-test-'));
  const env = loadEnv({
    nodeEnv: 'test',
    isProduction: false,
    dataDir,
    configDir: path.join(root, 'config'),
    templatesDir: path.join(root, 'templates'),
    assetsDir: path.join(root, 'assets'),
    fixturesPath: path.join(root, 'fixtures', 'users.json'),
    adminDistDir: path.join(dataDir, 'no-admin'),
    addinDistDir: path.join(root, 'addin', 'dist'),
    mockGraph: true,
    mockAuthHeader: true,
    appSecret: 'test-secret',
    ...envOverrides,
  });
  const repo = new SqliteRepository(':memory:');
  const keys = opts.withKeys ? await makeKeys() : undefined;
  const directory = new MockDirectory(env.fixturesPath);
  const ctx = new AppContext(env, repo, keys?.jwks, directory);
  seedIfEmpty(repo, env, ctx.settings, () => {});
  for (const o of directory.fixtureOverrides) repo.saveOverrides({ ...o, updatedBy: 'fixtures' });
  ctx.settings.update({ tenantId: TENANT, clientId: CLIENT, appIdUri: APP_ID_URI, publicUrl: 'https://sig.tenax.lv' });
  const app = await buildApp(ctx, { logger: false });
  return { app, ctx, repo, keys, env };
}

export const mock = (upn: string) => ({ 'x-mock-user': upn });
