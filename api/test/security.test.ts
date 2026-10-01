// Regression tests for the security review findings (one block per finding).
import { describe, expect, it } from 'vitest';
import { trialRender, validateMeta, validateTemplateSource } from '../src/services/renderer.js';
import { assertSafe, loadEnv } from '../src/env.js';
import { makeApp, mock, signToken } from './helpers.js';

const IT = mock('test.tenax@tenaxgrupa.lv');

describe('template validation works on the parsed template, not regexes', () => {
  it.each([
    ['{{{user.displayName}}}'],
    ['{{& user.displayName}}'],
    ['{{~{user.displayName}~}}'],
    ['{{~& user.displayName}}'],
    ['{{> footer}}'],
    ['{{#> layout}}x{{/layout}}'],
    ['{{#*inline "x"}}y{{/inline}}'],
    ['{{nohelper user.email}}'],
    ['{{#lookup this "constructor"}}x{{/lookup}}'],
    ['<script>x</script>'],
  ])('rejects %s', (src) => {
    expect(() => validateTemplateSource(src)).toThrow();
  });

  it('accepts the normal helpers', () => {
    expect(() => validateTemplateSource('{{#if user.mobilePhone}}<a href="tel:{{tel user.mobilePhone}}">{{user.mobilePhone}}</a>{{/if}}{{#each meta.websites}}{{label}}{{/each}}')).not.toThrow();
  });

  it('trial render catches templates that only fail at render time', () => {
    expect(() => trialRender('{{#with}}x{{/with}}', '{}', 'new')).toThrow(/fails when rendered/);
  });

  it('{{log}} is rejected, so templates can never write to the server log', () => {
    expect(() => validateTemplateSource('{{log "forged"}}')).toThrow(/Unknown helper/);
  });
});

describe('brand settings are strictly typed', () => {
  it.each([
    [{ logo: { file: 'logo.png', width: '1px;background-image:url(https://x)', height: 40 } }],
    [{ logo: { file: '../x.png', width: 10, height: 10 } }],
    [{ banner: { file: 'b.png', width: '600px;position:fixed', height: 10 } }],
    [{ banner: { file: 'b.png', width: 600, height: 10, link: 'javascript:alert(1)' } }],
    [{ websites: [{ label: 'x', url: 'http://plain-http.example' }] }],
    [{ colors: { primary: 'red;background:url(x)' } }],
    [{ colors: { evil: '#000000' } }],
    [{ unexpected: true }],
    [null],
  ])('rejects %j', (meta) => {
    expect(() => validateMeta(JSON.stringify(meta))).toThrow();
  });
});

describe('API hardening', async () => {
  const { app, ctx, keys } = await makeApp({ mockAuthHeader: true }, { withKeys: true });

  it('HTML from the API carries a sandboxing CSP', async () => {
    const res = await app.inject({ url: '/api/signature?type=newMail', headers: IT });
    expect(res.headers['content-security-policy']).toContain('sandbox');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
  });

  it('a template that breaks at render time yields 204, not a 500 for the whole company', async () => {
    ctx.repo.addTemplateVersion({ company: 'tenax', kind: 'new', content: '{{#with}}x{{/with}}', note: 'broken', createdBy: 'test' });
    const res = await app.inject({ url: '/api/signature?type=newMail', headers: IT });
    expect(res.statusCode).toBe(204);
    expect(ctx.repo.listTelemetry(1)[0].stage).toBe('render');
  });

  it('rejects saving a template that breaks at render time', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/admin/templates/tenax/new', headers: IT, payload: { content: '{{#with}}x{{/with}}' } });
    expect(res.statusCode).toBe(422);
  });

  it('only tokens issued to our own app get admin rights', async () => {
    const claims = { oid: '11111111-0000-0000-0000-000000000001', preferred_username: 'test.tenax@tenaxgrupa.lv' };
    const other = await signToken(keys!.privateKey, { ...claims, azp: 'deadbeef-0000-0000-0000-000000000000' });
    expect((await app.inject({ url: '/api/admin/settings', headers: { authorization: `Bearer ${other}` } })).statusCode).toBe(403);
    const officeSso = await signToken(keys!.privateKey, { ...claims, scp: 'access_as_user' });
    expect((await app.inject({ url: '/api/admin/settings', headers: { authorization: `Bearer ${officeSso}` } })).statusCode).toBe(403);
    // …but Office SSO still works for the caller's own signature.
    expect((await app.inject({ url: '/api/signature', headers: { authorization: `Bearer ${officeSso}` } })).statusCode).toBeLessThan(300);
    const ours = await signToken(keys!.privateKey, claims);
    expect((await app.inject({ url: '/api/admin/settings', headers: { authorization: `Bearer ${ours}` } })).statusCode).toBe(200);
  });

  it('server address and origins are stored as bare https origins', async () => {
    const bad = ['https://x.example/"><svg onload=alert(1)>', 'https://x.example:443@evil.example', 'http://sig.example', 'javascript:alert(1)'];
    for (const publicUrl of bad) {
      expect((await app.inject({ method: 'PUT', url: '/api/admin/settings', headers: IT, payload: { publicUrl } })).statusCode, publicUrl).toBe(400);
    }
    const ok = await app.inject({ method: 'PUT', url: '/api/admin/settings', headers: IT, payload: { publicUrl: 'https://sig.tenax.lv/', allowedOrigins: ['http://localhost:8085'] } });
    expect(ok.json().publicUrl).toBe('https://sig.tenax.lv');
  });

  it('malformed URL escapes do not crash the static handler', async () => {
    expect((await app.inject({ url: '/%25' })).statusCode).toBeLessThan(500);
  });

  it('telemetry scrubs email addresses', async () => {
    await app.inject({ method: 'POST', url: '/api/telemetry', payload: { event: 'x', message: 'AADSTS50020 user john.doe@tenaxgrupa.lv failed' } });
    expect(ctx.repo.listTelemetry(1)[0].message).toBe('AADSTS50020 user [email] failed');
  });
});

describe('guests and disabled accounts', async () => {
  const { app, ctx } = await makeApp();
  it('get no signature and no console', async () => {
    const dir = ctx.directory() as any;
    const u = dir.data.users.find((x: any) => x.userPrincipalName === 'test.vareno@tenaxgrupa.lv');
    u.userType = 'Guest';
    ctx.resolver.clearCache();
    expect((await app.inject({ url: '/api/signature', headers: mock('test.vareno@tenaxgrupa.lv') })).statusCode).toBe(403);
    u.userType = 'Member';
    u.accountEnabled = false;
    ctx.resolver.clearCache();
    expect((await app.inject({ url: '/api/signature', headers: mock('test.vareno@tenaxgrupa.lv') })).statusCode).toBe(403);
  });
});

describe('local accounts and sessions', async () => {
  const { app, ctx } = await makeApp({ mockAuthHeader: false });
  const cookieOf = (res: any) => String(res.headers['set-cookie']).split(';')[0];
  const same = { 'sec-fetch-site': 'same-origin' };

  it('the setup code creates exactly one admin, even under a parallel race', async () => {
    ctx.setupToken = 'RACE-RACE-RACE-RACE';
    const results = await Promise.all(
      ['alpha', 'bravo', 'charlie', 'delta', 'echo'].map((username) =>
        app.inject({ method: 'POST', url: '/api/setup/admin', payload: { token: 'RACE-RACE-RACE-RACE', username, password: 'correct horse 42' } }),
      ),
    );
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(ctx.repo.countAdmins()).toBe(1);
  });

  it('changing your password signs out your other sessions but keeps this one', async () => {
    const admin = ctx.repo.listAdmins()[0];
    const login = () => app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: admin.username, password: 'correct horse 42' } });
    const a = cookieOf(await login());
    const b = cookieOf(await login());
    const res = await app.inject({ method: 'PUT', url: `/api/admin/accounts/${admin.id}/password`, headers: { cookie: a, ...same }, payload: { password: 'new horse battery 7' } });
    expect(res.statusCode).toBe(200);
    expect((await app.inject({ url: '/api/auth/session', headers: { cookie: a } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/auth/session', headers: { cookie: b } })).statusCode).toBe(401);
  });

  it('cookie writes without Origin or Sec-Fetch-Site are rejected (CSRF fails closed)', async () => {
    const admin = ctx.repo.listAdmins()[0];
    const c = cookieOf(await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: admin.username, password: 'new horse battery 7' } }));
    expect((await app.inject({ method: 'POST', url: '/api/admin/cache/clear', headers: { cookie: c } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/admin/cache/clear', headers: { cookie: c, ...same } })).statusCode).toBe(200);
  });

  it('locks an account after 10 failed sign-ins, whatever the client address', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: `198.51.100.${i}`, payload: { username: 'victim', password: 'wrong password 1' } });
      statuses.push(r.statusCode);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });
});

describe('rate limiting', async () => {
  const { app } = await makeApp({ mockAuthHeader: false, trustProxy: true });
  it('an encoded path ("/%61pi/…") is still rate limited', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) {
      codes.push((await app.inject({ method: 'POST', url: '/%61pi/setup/verify', payload: { token: 'x' } })).statusCode);
    }
    expect(codes).toContain(429);
  });

  it('a client-chosen X-Forwarded-For does not pick the rate-limit key', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await app.inject({
        method: 'POST', url: '/api/setup/verify', remoteAddress: '203.0.113.7',
        headers: { 'x-forwarded-for': `10.9.${i}.1` }, payload: { token: 'x' },
      });
      codes.push(r.statusCode);
    }
    expect(codes).toContain(429);
  });
});

describe('startup safety', () => {
  it('refuses a weak fixed SETUP_TOKEN in production', () => {
    expect(() => assertSafe({ ...loadEnv(), isProduction: true, mockAuthHeader: false, setupToken: '1234' })).toThrow(/SETUP_TOKEN/);
  });
});
