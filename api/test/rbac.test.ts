import { describe, expect, it } from 'vitest';
import { makeApp, mock } from './helpers.js';

// test.lv@ is a Tenapors employee AND in SG-Signature-Tenapors-Editors (fixtures). test.tenax@ is an IT admin.
const EDITOR = mock('test.lv@tenaxgrupa.lv');
const IT = mock('test.tenax@tenaxgrupa.lv');
const EMPLOYEE = mock('test.vareno@tenaxgrupa.lv');

describe('company signature editors', async () => {
  const { app, repo } = await makeApp();
  const get = (url: string, headers = EDITOR) => app.inject({ url, headers });
  const send = (method: 'POST' | 'PUT' | 'DELETE', url: string, payload: unknown, headers = EDITOR) => app.inject({ method, url, headers, payload: payload as any });

  it('session tells the console the role', async () => {
    expect((await get('/api/auth/session')).json()).toMatchObject({ isAdmin: false, editorOf: ['tenapors'] });
    expect((await get('/api/auth/session', IT)).json()).toMatchObject({ isAdmin: true, editorOf: [] });
    expect((await get('/api/auth/session', EMPLOYEE)).json()).toMatchObject({ isAdmin: false, editorOf: [] });
  });

  it('sees only their company’s people, report and designs', async () => {
    const users = (await get('/api/admin/users')).json();
    expect(users.length).toBeGreaterThan(0);
    expect(users.every((u: any) => u.company === 'tenapors')).toBe(true);
    const report = (await get('/api/admin/report')).json();
    expect(Object.keys(report.byCompany)).toEqual(['tenapors']);
    const csv = (await get('/api/admin/report.csv')).body;
    expect(csv).not.toContain('test.tenax@');
    const designs = (await get('/api/admin/templates')).json();
    expect(designs.map((d: any) => d.company.key)).toEqual(['tenapors']);
    expect(designs[0].company.groupId).toBeUndefined(); // group mappings are IT-only
    const companies = (await get('/api/admin/companies')).json();
    expect(companies).toEqual([expect.objectContaining({ key: 'tenapors' })]);
    expect(companies[0].editorGroupId).toBeUndefined();
  });

  it('cannot read or touch people of another company (looks like "not found")', async () => {
    expect((await get('/api/admin/users/test.tenax@tenaxgrupa.lv')).statusCode).toBe(404);
    expect((await get('/api/admin/users/test.tenax@tenaxgrupa.lv/preview?type=newMail')).statusCode).toBe(404);
    expect((await send('POST', '/api/admin/users/test.tenax@tenaxgrupa.lv/preview-draft', { type: 'newMail', overrides: {} })).statusCode).toBe(404);
    expect((await send('PUT', '/api/admin/users/test.tenax@tenaxgrupa.lv/overrides', { jobTitleLv: 'Hacked' })).statusCode).toBe(404);
    expect(repo.getOverrides('test.tenax@tenaxgrupa.lv')?.jobTitleLv ?? null).toBeNull();
    const prev = await send('POST', '/api/admin/templates/preview', { company: 'tenapors', type: 'newMail', upn: 'test.tenax@tenaxgrupa.lv' });
    expect(prev.statusCode).toBe(404);
  });

  it('can correct their own company’s people, but not move them to another company', async () => {
    const ok = await send('PUT', '/api/admin/users/test.tenapors@tenaxgrupa.lv/overrides', { jobTitleLv: 'Loģistikas vadītāja' });
    expect(ok.statusCode).toBe(200);
    expect(repo.getOverrides('test.tenapors@tenaxgrupa.lv')?.jobTitleLv).toBe('Loģistikas vadītāja');
    const move = await send('PUT', '/api/admin/users/test.tenapors@tenaxgrupa.lv/overrides', { company: 'tenax' });
    expect(move.statusCode).toBe(403);
    const moveDraft = await send('POST', '/api/admin/users/test.tenapors@tenaxgrupa.lv/preview-draft', { type: 'newMail', overrides: { company: 'tenax' } });
    expect(moveDraft.statusCode).toBe(403);
  });

  it('can edit their own company’s designs and images, nobody else’s', async () => {
    const own = await send('POST', '/api/admin/templates/tenapors/reply', { content: '<p>{{user.displayName}}</p>' });
    expect(own.statusCode).toBe(200);
    const other = await send('POST', '/api/admin/templates/tenax/reply', { content: '<p>pwned</p>' });
    expect(other.statusCode).toBe(403);
    expect(repo.latestTemplate('tenax', 'reply')!.content).not.toContain('pwned');
    expect((await send('POST', '/api/admin/templates/preview', { company: 'tenax', type: 'newMail' })).statusCode).toBe(403);
    expect((await get('/api/admin/templates/tenax/history')).statusCode).toBe(403);
    const tenaxVersion = repo.latestTemplate('tenax', 'new')!;
    expect((await get(`/api/admin/templates/version/${tenaxVersion.id}`)).statusCode).toBe(404);
    expect((await send('POST', `/api/admin/templates/restore/${tenaxVersion.id}`, {})).statusCode).toBe(404);
    expect((await get('/api/admin/assets/tenax')).statusCode).toBe(403);
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]).toString('base64');
    expect((await send('POST', '/api/admin/assets/tenax', { name: 'x.png', dataBase64: png })).statusCode).toBe(403);
    expect((await send('POST', '/api/admin/assets/tenapors', { name: 'x.png', dataBase64: png })).statusCode).toBe(200);
  });

  it('cannot use any IT-only function', async () => {
    const itOnly: [string, string, unknown?][] = [
      ['GET', '/api/admin/settings'],
      ['PUT', '/api/admin/settings', { language: 'lv' }],
      ['PUT', '/api/admin/settings/directory', { directoryMode: 'mock' }],
      ['POST', '/api/admin/settings/directory/test', { directoryMode: 'mock' }],
      ['PUT', '/api/admin/companies/tenapors', { displayName: 'X', legalName: 'X', groupName: 'X', groupId: '', priority: 1 }],
      ['POST', '/api/admin/companies', { key: 'evil', displayName: 'E', legalName: 'E', groupName: 'E', groupId: '', priority: 9 }],
      ['DELETE', '/api/admin/companies/tenax'],
      ['GET', '/api/admin/directory/groups?search=SG'],
      ['GET', '/api/admin/shared-mailboxes'],
      ['PUT', '/api/admin/shared-mailboxes/x@tenaxgrupa.lv', { company: 'tenapors', displayName: 'X' }],
      ['POST', '/api/admin/templates/reload', {}],
      ['POST', '/api/admin/setup/complete', {}],
      ['POST', '/api/admin/setup/restart', {}],
      ['POST', '/api/admin/cache/clear', {}],
      ['GET', '/api/admin/accounts'],
      ['POST', '/api/admin/accounts', { username: 'evil', password: 'aaaaaaaaaaaa1' }],
      ['GET', '/api/admin/audit'],
      ['GET', '/api/admin/telemetry'],
      ['GET', '/api/admin/addin/manifest.xml'],
    ];
    for (const [method, url, payload] of itOnly) {
      const res = await app.inject({ method: method as any, url, headers: EDITOR, payload: payload as any });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
    expect(repo.listCompanies().map((c) => c.key)).toContain('tenax');
  });

  it('ordinary employees get nothing from the admin API', async () => {
    for (const url of ['/api/admin/users', '/api/admin/templates', '/api/admin/report']) {
      expect((await get(url, EMPLOYEE)).statusCode).toBe(403);
    }
  });

  it('IT admins still see and do everything', async () => {
    expect((await get('/api/admin/users', IT)).json()).toHaveLength(9);
    expect((await get('/api/admin/users/test.tenapors@tenaxgrupa.lv', IT)).statusCode).toBe(200);
    expect((await get('/api/admin/settings', IT)).statusCode).toBe(200);
  });
});

describe('deleting a company', async () => {
  const { app, repo, ctx } = await makeApp();

  it('refuses the default company and companies used by shared mailboxes', async () => {
    expect((await app.inject({ method: 'DELETE', url: '/api/admin/companies/tenax', headers: IT })).statusCode).toBe(409);
  });

  it('removes a company; its people fall back to the default company', async () => {
    ctx.settings.update({ defaultCompany: 'tenax' });
    const res = await app.inject({ method: 'DELETE', url: '/api/admin/companies/vareno', headers: IT });
    expect(res.statusCode).toBe(200);
    expect(repo.listCompanies().map((c) => c.key)).not.toContain('vareno');
    const sig = await app.inject({ url: '/api/signature?type=newMail', headers: mock('test.vareno@tenaxgrupa.lv') });
    expect(sig.body).toContain('signature:tenax:new');
    expect(repo.listAudit(5).some((a) => a.action === 'company.delete' && a.target === 'company:vareno')).toBe(true);
  });

  it('rejects an editors group that is the company group or the IT group', async () => {
    const c = repo.listCompanies().find((x) => x.key === 'tenapors')!;
    const res = await app.inject({
      method: 'PUT', url: '/api/admin/companies/tenapors', headers: IT,
      payload: { displayName: c.displayName, legalName: c.legalName, groupName: c.groupName, groupId: c.groupId, priority: c.priority, editorGroupName: 'x', editorGroupId: c.groupId },
    });
    expect(res.statusCode).toBe(409);
  });
});
