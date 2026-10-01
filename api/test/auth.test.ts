import { describe, expect, it } from 'vitest';
import { generateKeyPair } from 'jose';
import { assertSafe, loadEnv } from '../src/env.js';
import { makeApp, mock, signToken, APP_ID_URI, CLIENT } from './helpers.js';

const TENAX_OID = '11111111-0000-0000-0000-000000000001';
const VARENO_OID = '11111111-0000-0000-0000-000000000004';
const claimsFor = (oid: string, upn: string) => ({ oid, preferred_username: upn });

describe('token validation', async () => {
  const { app, keys } = await makeApp({ mockAuthHeader: false }, { withKeys: true });
  const call = (token: string) => app.inject({ url: '/api/signature?type=newMail', headers: { authorization: `Bearer ${token}` } });

  it('accepts a valid token (App ID URI audience)', async () => {
    const res = await call(await signToken(keys!.privateKey, claimsFor(TENAX_OID, 'test.tenax@tenaxgrupa.lv')));
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Jānis Testeris');
  });
  it('accepts the client ID as audience and the v1 issuer', async () => {
    const t = await signToken(keys!.privateKey, claimsFor(TENAX_OID, 'test.tenax@tenaxgrupa.lv'), {
      aud: CLIENT,
      iss: 'https://sts.windows.net/11111111-2222-3333-4444-555555555555/',
    });
    expect((await call(t)).statusCode).toBe(200);
  });
  it('rejects the wrong audience', async () => {
    const t = await signToken(keys!.privateKey, claimsFor(TENAX_OID, 'test.tenax@tenaxgrupa.lv'), { aud: 'api://someone-else' });
    expect((await call(t)).statusCode).toBe(401);
  });
  it('rejects the wrong tenant (issuer)', async () => {
    const t = await signToken(keys!.privateKey, claimsFor(TENAX_OID, 'test.tenax@tenaxgrupa.lv'), {
      iss: 'https://login.microsoftonline.com/99999999-9999-9999-9999-999999999999/v2.0',
    });
    expect((await call(t)).statusCode).toBe(401);
  });
  it('rejects a mismatched tid claim', async () => {
    const t = await signToken(keys!.privateKey, { ...claimsFor(TENAX_OID, 'test.tenax@tenaxgrupa.lv'), tid: '99999999-9999-9999-9999-999999999999' });
    expect((await call(t)).statusCode).toBe(401);
  });
  it('rejects an expired token', async () => {
    const t = await signToken(keys!.privateKey, claimsFor(TENAX_OID, 'test.tenax@tenaxgrupa.lv'), { exp: Math.floor(Date.now() / 1000) - 3600 });
    expect((await call(t)).statusCode).toBe(401);
  });
  it('rejects a token signed by another key', async () => {
    const other = await generateKeyPair('RS256');
    const t = await signToken(other.privateKey, claimsFor(TENAX_OID, 'test.tenax@tenaxgrupa.lv'));
    expect((await call(t)).statusCode).toBe(401);
  });
  it('rejects a token without the Signature.Read scope', async () => {
    const t = await signToken(keys!.privateKey, { ...claimsFor(TENAX_OID, 'test.tenax@tenaxgrupa.lv'), scp: 'User.Read' });
    expect((await call(t)).statusCode).toBe(403);
  });
  it('accepts the Office SSO access_as_user scope', async () => {
    const t = await signToken(keys!.privateKey, { ...claimsFor(TENAX_OID, 'test.tenax@tenaxgrupa.lv'), scp: 'access_as_user' });
    expect((await call(t)).statusCode).toBe(200);
  });
  it('rejects a UPN that does not belong to the oid', async () => {
    const t = await signToken(keys!.privateKey, claimsFor(VARENO_OID, 'test.tenax@tenaxgrupa.lv'));
    expect((await call(t)).statusCode).toBe(403);
  });
  it('ignores a upn query parameter — the token decides who you are', async () => {
    const t = await signToken(keys!.privateKey, claimsFor(VARENO_OID, 'test.vareno@tenaxgrupa.lv'));
    const res = await app.inject({ url: '/api/signature?type=newMail&upn=test.tenax@tenaxgrupa.lv', headers: { authorization: `Bearer ${t}` } });
    expect(res.body).toContain('Laura Ozola');
    expect(res.body).not.toContain('Jānis');
  });
  it('ignores X-Mock-User when mock auth is off', async () => {
    const res = await app.inject({ url: '/api/signature', headers: mock('test.tenax@tenaxgrupa.lv') });
    expect(res.statusCode).toBe(401);
  });
  void APP_ID_URI;
});

describe('admin authorisation', async () => {
  const { app, keys } = await makeApp({ mockAuthHeader: false }, { withKeys: true });

  it('allows members of the admins group', async () => {
    const t = await signToken(keys!.privateKey, claimsFor(TENAX_OID, 'test.tenax@tenaxgrupa.lv'));
    const res = await app.inject({ url: '/api/admin/users', headers: { authorization: `Bearer ${t}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(9);
  });
  it('forbids non-admins', async () => {
    const t = await signToken(keys!.privateKey, claimsFor(VARENO_OID, 'test.vareno@tenaxgrupa.lv'));
    for (const url of ['/api/admin/users', '/api/admin/report.csv', '/api/admin/settings', '/api/admin/users/test.tenax@tenaxgrupa.lv/preview']) {
      expect((await app.inject({ url, headers: { authorization: `Bearer ${t}` } })).statusCode).toBe(403);
    }
    const put = await app.inject({ method: 'PUT', url: '/api/admin/users/test.vareno@tenaxgrupa.lv/overrides', headers: { authorization: `Bearer ${t}` }, payload: { jobTitleLv: 'CEO' } });
    expect(put.statusCode).toBe(403);
  });
  it('requires sign-in', async () => {
    expect((await app.inject({ url: '/api/admin/users' })).statusCode).toBe(401);
  });
});

describe('mock header safety', () => {
  it('can never be enabled in production', () => {
    const prev = { NODE_ENV: process.env.NODE_ENV, MOCK_GRAPH: process.env.MOCK_GRAPH };
    process.env.NODE_ENV = 'production';
    process.env.MOCK_GRAPH = 'true';
    try {
      expect(loadEnv().mockAuthHeader).toBe(false);
    } finally {
      process.env.NODE_ENV = prev.NODE_ENV;
      process.env.MOCK_GRAPH = prev.MOCK_GRAPH;
    }
    expect(() => assertSafe({ ...loadEnv(), isProduction: true, mockAuthHeader: true })).toThrow(/FATAL/);
  });
});

describe('first launch + local login', async () => {
  const { app, ctx } = await makeApp({ mockAuthHeader: false });
  ctx.setupToken = 'ABCD-EFGH';
  const cookieOf = (res: any) => String(res.headers['set-cookie']).split(';')[0];

  it('rejects a wrong setup code', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/setup/verify', payload: { token: 'nope' } });
    expect(res.statusCode).toBe(403);
  });
  it('rejects a weak password', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/setup/admin', payload: { token: 'abcd-efgh', username: 'admin', password: 'short' } });
    expect(res.statusCode).toBe(400);
  });
  let cookie = '';
  it('creates the first admin, signs in, and burns the code', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/setup/admin', payload: { token: 'abcd-efgh', username: 'admin', password: 'correct horse 42' } });
    expect(res.statusCode).toBe(200);
    cookie = cookieOf(res);
    expect(String(res.headers['set-cookie'])).toMatch(/HttpOnly/i);
    expect(ctx.setupToken).toBeNull();
    const again = await app.inject({ method: 'POST', url: '/api/setup/admin', payload: { token: 'ABCD-EFGH', username: 'evil', password: 'correct horse 42' } });
    expect(again.statusCode).toBe(409);
  });
  it('the session reaches admin endpoints', async () => {
    const res = await app.inject({ url: '/api/admin/settings', headers: { cookie } });
    expect(res.statusCode).toBe(200);
  });
  it('blocks cross-origin writes made with the cookie', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/admin/cache/clear', headers: { cookie, origin: 'https://evil.example' } });
    expect(res.statusCode).toBe(403);
  });
  it('logs in and out with username/password', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'wrong password 1' } });
    expect(bad.statusCode).toBe(401);
    const ok = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'ADMIN', password: 'correct horse 42' } });
    expect(ok.statusCode).toBe(200);
    const c = cookieOf(ok);
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: c, origin: 'http://localhost:80' } });
    expect((await app.inject({ url: '/api/admin/settings', headers: { cookie: c } })).statusCode).toBe(401);
  });
  it('lets an admin rename a company group and see it take effect', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/api/admin/companies/vareno', headers: { cookie, 'sec-fetch-site': 'same-origin' },
      payload: { displayName: 'Vareno', legalName: 'SIA "Vareno Group"', groupName: 'SG-Sig-Vareno-New', groupId: '00000000-0000-0000-0000-00000000a004', priority: 4 },
    });
    expect(res.statusCode).toBe(200);
    const list = await app.inject({ url: '/api/admin/companies', headers: { cookie } });
    expect(list.json().find((c: any) => c.key === 'vareno').groupName).toBe('SG-Sig-Vareno-New');
  });
});

describe('report CSV', async () => {
  const { app } = await makeApp();
  it('lists every user with source flags and conflicts', async () => {
    const res = await app.inject({ url: '/api/admin/report.csv', headers: mock('test.tenax@tenaxgrupa.lv') });
    expect(res.statusCode).toBe(200);
    const lines = res.body.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines).toHaveLength(10);
    expect(lines.find((l) => l.startsWith('test.multi'))).toContain(',yes,tenax vareno,');
    expect(lines.find((l) => l.startsWith('test.nogroup'))).toContain(',default,');
    expect(lines.find((l) => l.startsWith('test.panel'))).toContain('jobTitleLv');
    expect(lines.find((l) => l.startsWith('test.lv'))).toContain('Ņikita');
  });
});
