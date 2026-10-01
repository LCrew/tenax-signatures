import { describe, expect, it } from 'vitest';
import { validateMeta } from '../src/services/renderer.js';
import { makeApp, mock, signToken } from './helpers.js';

const VARENO_OID = '11111111-0000-0000-0000-000000000004';

describe('self-service (Microsoft sign-in)', async () => {
  const { app, ctx, keys } = await makeApp({ mockAuthHeader: false }, { withKeys: true });
  const token = await signToken(keys!.privateKey, { oid: VARENO_OID, preferred_username: 'test.vareno@tenaxgrupa.lv' });
  const auth = { authorization: `Bearer ${token}` };

  it('shows the signed-in person their own data', async () => {
    const res = await app.inject({ url: '/api/me', headers: auth });
    expect(res.statusCode).toBe(200);
    const me = res.json();
    expect(me.upn).toBe('test.vareno@tenaxgrupa.lv');
    expect(me.companyName).toBe('Vareno Group');
    expect(me.isAdmin).toBe(false);
    expect(me.entra.jobTitle).toBe('Grāmatvede');
  });

  it('previews their own signature', async () => {
    const res = await app.inject({ url: '/api/me/preview?type=newMail', headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Laura Ozola');
  });

  it('needs sign-in, and a local admin session is not a mailbox user', async () => {
    expect((await app.inject({ url: '/api/me' })).statusCode).toBe(401);
  });

  it('refuses edits while self-service is off', async () => {
    ctx.settings.update({ selfServiceEnabled: false });
    const res = await app.inject({ method: 'PUT', url: '/api/me/overrides', headers: auth, payload: { jobTitleEn: 'Accountant' } });
    expect(res.statusCode).toBe(403);
  });

  it('allows only the configured fields', async () => {
    ctx.settings.update({ selfServiceEnabled: true, selfServiceFields: ['jobTitleEn', 'hideMobile'] });
    const bad = await app.inject({ method: 'PUT', url: '/api/me/overrides', headers: auth, payload: { displayName: 'CEO' } });
    expect(bad.statusCode).toBe(403);
    const badDraft = await app.inject({ method: 'POST', url: '/api/me/preview-draft', headers: auth, payload: { type: 'newMail', overrides: { company: 'tenax' } } });
    expect(badDraft.statusCode).toBe(403);

    const draft = await app.inject({ method: 'POST', url: '/api/me/preview-draft', headers: auth, payload: { type: 'newMail', overrides: { jobTitleEn: 'Accountant' } } });
    expect(draft.body).toContain('Accountant');
    expect(ctx.repo.getOverrides('test.vareno@tenaxgrupa.lv')?.jobTitleEn ?? null).toBeNull(); // preview stores nothing

    const ok = await app.inject({ method: 'PUT', url: '/api/me/overrides', headers: auth, payload: { jobTitleEn: 'Accountant' } });
    expect(ok.statusCode).toBe(200);
    const sig = await app.inject({ url: '/api/signature?type=newMail', headers: auth });
    expect(sig.body).toContain('Accountant');
    expect(ctx.repo.listAudit(5, 'test.vareno@tenaxgrupa.lv')[0].action).toBe('overrides.self');
  });
});

describe('current designs', async () => {
  const { app, ctx, repo } = await makeApp();
  const sig = (upn: string, type = 'newMail') => app.inject({ url: `/api/signature?type=${type}`, headers: mock(upn) }).then((r) => r.body);

  it('ships Tenax Install as a fifth company', async () => {
    expect(repo.listCompanies().map((c) => c.key)).toContain('tenaxinstall');
    const html = await sig('test.install@tenaxgrupa.lv');
    expect(html).toContain('signature:tenaxinstall:new');
    expect(html).toContain('TENAX INSTALL SIA, TENAX grupa');
    expect(html).toContain('https://www.tenaxinstall.com/');
  });

  it('keeps the current content: M: line, company line, address, both Tenax websites', async () => {
    const html = await sig('test.tenax@tenaxgrupa.lv');
    expect(html).toContain('M: <a href="tel:+37129123456"');
    expect(html).toContain('Sabiedrība ar ierobežotu atbildību “TENAX”');
    expect(html).toContain('Spodrības iela 1, Dobele, LV-3701, Latvija');
    expect(html).toContain('www.tenaxpanel.lv');
    expect(html).toContain('www.tenapors.lv');
    expect(html).not.toMatch(/<style/i); // inline styles only
  });

  it('renders greeting, banner and confidentiality notice only when set', async () => {
    const before = await sig('test.tenapors@tenaxgrupa.lv');
    expect(before).not.toContain('Ar cieņu');
    expect(before).not.toContain('banner-');
    const meta = JSON.parse(repo.latestTemplate('tenapors', 'meta')!.content);
    meta.greeting = 'Ar cieņu,';
    meta.banner = { file: 'banner-600x300px-tenapors-banneris-parakstam.png', width: 600, height: 300, link: 'https://www.tenapors.lv', alt: 'Tenapors' };
    meta.footer.confidential = 'Šis e-pasts ir konfidenciāls.';
    repo.addTemplateVersion({ company: 'tenapors', kind: 'meta', content: JSON.stringify(meta), note: null, createdBy: 'test' });
    const after = await sig('test.tenapors@tenaxgrupa.lv');
    expect(after).toContain('Ar cieņu,');
    expect(after).toContain('src="https://sig.tenaxgrupa.lv/assets/tenapors/banner-600x300px-tenapors-banneris-parakstam.png"');
    expect(after).toContain('<a href="https://www.tenapors.lv"');
    expect(after).toContain('Šis e-pasts ir konfidenciāls.');
    const reply = await sig('test.tenapors@tenaxgrupa.lv', 'reply');
    expect(reply).not.toContain('banner-');
    void ctx;
  });

  it('rejects non-https links in design settings', () => {
    expect(() => validateMeta(JSON.stringify({ websites: [{ label: 'x', url: 'javascript:alert(1)' }] }))).toThrow(/https/);
    expect(() => validateMeta(JSON.stringify({ banner: { file: 'a.png', width: 1, height: 1, link: 'javascript:x' } }))).toThrow(/https/);
  });
});
