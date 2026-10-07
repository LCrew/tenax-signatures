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
    expect(after).toContain('src="https://sig.tenax.lv/assets/tenapors/banner-600x300px-tenapors-banneris-parakstam.png"');
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

describe('add-in manifest', async () => {
  const { app, ctx } = await makeApp();
  it('serves a test variant with a different, stable add-in ID', async () => {
    const real = (await app.inject({ url: '/addin/manifest.xml' })).body;
    const test1 = (await app.inject({ url: '/addin/manifest.xml?variant=test' })).body;
    const test2 = (await app.inject({ url: '/addin/manifest.xml?variant=test' })).body;
    const id = (x: string) => /<Id>([^<]+)<\/Id>/.exec(x)![1];
    expect(id(real)).toBe(ctx.settings.get().addinId);
    expect(id(test1)).not.toBe(id(real));
    expect(id(test1)).toBe(id(test2));
    expect(id(test1)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(test1).toContain('Tenax Signature (test)');
    expect(test1).toContain('https://sig.tenax.lv/addin/launchevent.js');
  });
});

describe('personal closing line', async () => {
  const { app, ctx, repo } = await makeApp();
  const PANEL = mock('test.panel@tenaxgrupa.lv');
  const sig = () => app.inject({ url: '/api/signature?type=newMail', headers: PANEL }).then((r) => r.body);

  it('works with self-service turned off, replaces the company line, and can hide it', async () => {
    ctx.settings.update({ selfServiceEnabled: false });
    const meta = JSON.parse(repo.latestTemplate('tenaxpanel', 'meta')!.content);
    meta.greeting = 'Ar cieņu,';
    repo.addTemplateVersion({ company: 'tenaxpanel', kind: 'meta', content: JSON.stringify(meta), note: null, createdBy: 'test' });
    expect(await sig()).toContain('Ar cieņu,');
    expect((await app.inject({ url: '/api/me', headers: PANEL })).json()).toMatchObject({ greeting: null, defaultGreeting: 'Ar cieņu,' });

    // Live preview of an unsaved closing line (no self-service needed)
    const prev = await app.inject({ method: 'POST', url: '/api/me/preview-draft', headers: PANEL, payload: { type: 'newMail', greeting: 'Paldies!' } });
    expect(prev.statusCode).toBe(200);
    expect(prev.body).toContain('Paldies!');

    expect((await app.inject({ method: 'PUT', url: '/api/me/greeting', headers: PANEL, payload: { greeting: '  Best regards,\n' } })).statusCode).toBe(200);
    const own = await sig();
    expect(own).toContain('Best regards,');
    expect(own).not.toContain('Ar cieņu,');

    await app.inject({ method: 'PUT', url: '/api/me/greeting', headers: PANEL, payload: { greeting: '' } });
    expect(await sig()).not.toMatch(/Best regards|Ar cieņu/);

    await app.inject({ method: 'PUT', url: '/api/me/greeting', headers: PANEL, payload: { greeting: null } });
    expect(await sig()).toContain('Ar cieņu,');
  });

  it('is plain text and limited in length', async () => {
    await app.inject({ method: 'PUT', url: '/api/me/greeting', headers: PANEL, payload: { greeting: '<img src=x onerror=alert(1)>' } });
    expect(await sig()).toContain('&lt;img src&#x3D;x onerror&#x3D;alert(1)&gt;');
    expect((await app.inject({ method: 'PUT', url: '/api/me/greeting', headers: PANEL, payload: { greeting: 'x'.repeat(121) } })).statusCode).toBe(400);
  });

  it('admins can set it too', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/admin/users/test.panel@tenaxgrupa.lv/overrides', headers: mock('test.tenax@tenaxgrupa.lv'), payload: { greeting: 'Ar labākajiem vēlējumiem,' } });
    expect(res.statusCode).toBe(200);
    expect(await sig()).toContain('Ar labākajiem vēlējumiem,');
  });
});

describe('personal address line', async () => {
  const { app, ctx } = await makeApp();
  const PANEL = mock('test.panel@tenaxgrupa.lv');
  const COMPANY = 'Spodrības iela 1, Dobele, LV-3701, Latvija';
  const sig = () => app.inject({ url: '/api/signature?type=newMail', headers: PANEL }).then((r) => r.body);
  const setOwn = (address: string | null) => app.inject({ method: 'PUT', url: '/api/me/overrides', headers: PANEL, payload: { address } });

  it('is a self-service field IT turns on', async () => {
    ctx.settings.update({ selfServiceEnabled: true, selfServiceFields: ['jobTitleEn'] });
    expect((await setOwn('Rīga')).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: '/api/admin/settings', headers: mock('test.tenax@tenaxgrupa.lv'), payload: { selfServiceFields: ['jobTitleEn', 'address'] } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/me', headers: PANEL })).json()).toMatchObject({ defaultAddress: COMPANY, selfService: { fields: ['jobTitleEn', 'address'] } });
  });

  it('replaces the company address in their signature, one line, and empty brings it back', async () => {
    expect(await sig()).toContain(COMPANY);
    expect((await setOwn('  Brīvības iela 100\nRīga, LV-1001 ')).statusCode).toBe(200);
    const own = await sig();
    expect(own).toContain('Brīvības iela 100, Rīga, LV-1001');
    expect(own).not.toContain(COMPANY);
    expect((await app.inject({ url: '/api/me', headers: PANEL })).json().overrides.address).toBe('Brīvības iela 100, Rīga, LV-1001');
    // Only their own signature changes.
    expect((await app.inject({ url: '/api/signature?type=newMail', headers: mock('test.tenax@tenaxgrupa.lv') })).body).toContain(COMPANY);

    await setOwn('');
    expect(await sig()).toContain(COMPANY);
  });

  it('is plain text and limited in length; admins can set it on the person page', async () => {
    await setOwn('<b>Rīga</b>');
    expect(await sig()).toContain('&lt;b&gt;Rīga&lt;/b&gt;');
    expect((await setOwn('x'.repeat(201))).statusCode).toBe(400);
    const res = await app.inject({ method: 'PUT', url: '/api/admin/users/test.panel@tenaxgrupa.lv/overrides', headers: mock('test.tenax@tenaxgrupa.lv'), payload: { address: 'Jelgava' } });
    expect(res.statusCode).toBe(200);
    expect(await sig()).toContain('Jelgava');
  });
});
