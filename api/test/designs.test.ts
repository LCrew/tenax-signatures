import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS, SqliteRepository } from '../src/db/sqlite.js';
import { makeApp, mock } from './helpers.js';

const IT = mock('test.tenax@tenaxgrupa.lv');
const PANEL = mock('test.panel@tenaxgrupa.lv'); // Tenax Panel employee
const TENAPORS_EDITOR = mock('test.lv@tenaxgrupa.lv');

describe('migration to designs (v3 → v4)', () => {
  it('moves existing layouts into a Standard default design and keeps brand settings per company', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sig-mig-')), 'db.sqlite');
    const db = new Database(file);
    for (const m of MIGRATIONS.slice(0, 3)) db.exec(m);
    db.pragma('user_version = 3');
    db.prepare("INSERT INTO companies(key, display_name, legal_name, group_name, group_id, priority) VALUES('acme','Acme','SIA Acme','G','',1)").run();
    const ins = db.prepare('INSERT INTO templates(company, kind, version, content, note, created_by, created_at) VALUES(?,?,?,?,?,?,?)');
    ins.run('acme', 'new', 1, '<p>v1</p>', null, 'x', 'now');
    ins.run('acme', 'new', 2, '<p>v2</p>', null, 'x', 'now');
    ins.run('acme', 'reply', 1, '<p>r</p>', null, 'x', 'now');
    ins.run('acme', 'meta', 1, '{}', null, 'x', 'now');
    db.close();

    const repo = new SqliteRepository(file);
    expect(repo.listDesigns('acme')).toEqual([expect.objectContaining({ id: 'acme-standard', name: 'Standard', isDefault: true, purpose: 'person' })]);
    expect(repo.latestTemplate('acme', 'new')!.content).toBe('<p>v2</p>');
    expect(repo.latestTemplate('acme', 'new', 'acme-standard')!.version).toBe(2);
    expect(repo.latestTemplate('acme', 'meta')!.design).toBe('');
    // New versions keep counting per design.
    expect(repo.addTemplateVersion({ company: 'acme', kind: 'new', content: '<p>v3</p>', note: null, createdBy: 'x' }).version).toBe(3);
    repo.close();
  });
});

describe('several designs per company', async () => {
  const { app, repo } = await makeApp();
  const create = (payload: unknown, h = IT) => app.inject({ method: 'POST', url: '/api/admin/designs', headers: h, payload: payload as any });
  const sig = (h = PANEL, q = '') => app.inject({ url: `/api/signature?type=newMail${q}`, headers: h });
  let english = '';
  let service = '';

  it('creates designs as copies, with their own layouts', async () => {
    const res = await create({ company: 'tenaxpanel', name: 'English' });
    expect(res.statusCode).toBe(200);
    english = res.json().id;
    expect(english).toBe('tenaxpanel-english');
    expect(repo.latestTemplate('tenaxpanel', 'new', english)!.content).toBe(repo.latestTemplate('tenaxpanel', 'new')!.content);
    const svc = await create({ company: 'tenaxpanel', name: 'Service', purpose: 'service' });
    service = svc.json().id;
    expect(svc.json()).toMatchObject({ purpose: 'service', selectable: false });
    // Give English a recognisable layout and English wording.
    await app.inject({ method: 'POST', url: '/api/admin/templates/tenaxpanel/new', headers: IT, payload: { design: english, content: '<p>EN {{user.displayName}} {{meta.footer.companyLine}}</p>' } });
    const put = await app.inject({ method: 'PUT', url: `/api/admin/designs/${english}`, headers: IT, payload: { metaOverrides: { footer: { companyLine: 'TENAX PANEL Ltd' } } } });
    expect(put.statusCode).toBe(200);
  });

  it('everyone gets the default until they choose or an admin assigns', async () => {
    expect((await sig()).body).toContain('signature:tenaxpanel:new');
    const me = (await app.inject({ url: '/api/me', headers: PANEL })).json();
    expect(me.design).toMatchObject({ id: 'tenaxpanel-standard', source: 'default' });
    expect(me.designs.map((d: any) => d.id)).toEqual(['tenaxpanel-standard', english]); // service not offered
  });

  it('the person chooses English; per-design wording overrides apply', async () => {
    expect((await app.inject({ method: 'PUT', url: '/api/me/design', headers: PANEL, payload: { design: english } })).statusCode).toBe(200);
    expect((await sig()).body).toBe('<p>EN Pēteris Kalniņš TENAX PANEL Ltd</p>');
  });

  it('people cannot pick a service design or another company’s design', async () => {
    expect((await app.inject({ method: 'PUT', url: '/api/me/design', headers: PANEL, payload: { design: service } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: '/api/me/design', headers: PANEL, payload: { design: 'tenax-standard' } })).statusCode).toBe(403);
    // …nor set it through the self-service corrections endpoint.
    expect((await app.inject({ method: 'PUT', url: '/api/me/overrides', headers: PANEL, payload: { design: service } })).statusCode).toBeGreaterThanOrEqual(400);
  });

  it('Outlook can switch per email only to allowed designs', async () => {
    expect((await sig(PANEL, '&design=tenaxpanel-standard')).body).toContain('signature:tenaxpanel:new');
    expect((await sig(PANEL, `&design=${service}`)).body).toContain('EN '); // not allowed → their own design
    expect((await sig(PANEL, '&design=tenax-standard')).body).toContain('EN ');
    const list = (await app.inject({ url: '/api/me/designs', headers: PANEL })).json();
    expect(list.designs.find((d: any) => d.current).id).toBe(english);
  });

  it('an admin assignment replaces the person’s choice; locking stops them changing it', async () => {
    const assign = await app.inject({ method: 'PUT', url: '/api/admin/users/test.panel@tenaxgrupa.lv/overrides', headers: IT, payload: { design: service, designLocked: true } });
    expect(assign.statusCode).toBe(200);
    const me = (await app.inject({ url: '/api/me', headers: PANEL })).json();
    expect(me.design).toMatchObject({ id: service, source: 'locked' });
    expect(me.designLocked).toBe(true);
    expect(me.designs.map((d: any) => d.id)).toEqual([service]);
    expect((await app.inject({ method: 'PUT', url: '/api/me/design', headers: PANEL, payload: { design: english } })).statusCode).toBe(403);
    expect((await sig(PANEL, `&design=${english}`)).body).toContain('signature:tenaxpanel:new'); // locked: switching ignored
    // Unlock: the assignment stays as their default, and they may choose again.
    await app.inject({ method: 'PUT', url: '/api/admin/users/test.panel@tenaxgrupa.lv/overrides', headers: IT, payload: { design: english, designLocked: false } });
    expect((await app.inject({ url: '/api/me', headers: PANEL })).json().design).toMatchObject({ id: english, source: 'assigned' });
  });

  it('rejects assigning a design of another company', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/admin/users/test.panel@tenaxgrupa.lv/overrides', headers: IT, payload: { design: 'tenax-standard' } });
    expect(res.statusCode).toBe(400);
  });

  it('validates per-design wording like brand settings', async () => {
    const bad = await app.inject({ method: 'PUT', url: `/api/admin/designs/${english}`, headers: IT, payload: { metaOverrides: { banner: { file: 'x.png', width: 600, height: 100, link: 'javascript:alert(1)' } } } });
    expect(bad.statusCode).toBe(422);
    const css = await app.inject({ method: 'PUT', url: `/api/admin/designs/${english}`, headers: IT, payload: { metaOverrides: { banner: { file: 'x.png', width: '1px;background:url(x)', height: 1 } } } });
    expect(css.statusCode).toBe(400);
  });

  it('the default can’t be deleted or be a service design; deleting a design moves its people to their fallback', async () => {
    expect((await app.inject({ method: 'DELETE', url: '/api/admin/designs/tenaxpanel-standard', headers: IT })).statusCode).toBe(409);
    expect((await app.inject({ method: 'PUT', url: `/api/admin/designs/${service}`, headers: IT, payload: { isDefault: true } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: `/api/admin/designs/${english}`, headers: IT })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/me', headers: PANEL })).json().design).toMatchObject({ id: 'tenaxpanel-standard', source: 'default' });
    expect((await sig()).body).toContain('signature:tenaxpanel:new');
  });

  it('makes another design the default', async () => {
    const d = (await create({ company: 'tenaxpanel', name: 'Summer' })).json();
    await app.inject({ method: 'PUT', url: `/api/admin/designs/${d.id}`, headers: IT, payload: { isDefault: true } });
    const designs = repo.listDesigns('tenaxpanel');
    expect(designs.filter((x) => x.isDefault).map((x) => x.id)).toEqual([d.id]);
    await app.inject({ method: 'PUT', url: '/api/admin/designs/tenaxpanel-standard', headers: IT, payload: { isDefault: true } });
  });

  it('company editors manage designs of their own company only', async () => {
    expect((await create({ company: 'tenaxpanel', name: 'Nope' }, TENAPORS_EDITOR)).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: `/api/admin/designs/${service}`, headers: TENAPORS_EDITOR, payload: { name: 'x' } })).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/admin/designs?company=tenaxpanel', headers: TENAPORS_EDITOR })).statusCode).toBe(403);
    const own = await create({ company: 'tenapors', name: 'English' }, TENAPORS_EDITOR);
    expect(own.statusCode).toBe(200);
    const assign = await app.inject({ method: 'PUT', url: '/api/admin/users/test.tenapors@tenaxgrupa.lv/overrides', headers: TENAPORS_EDITOR, payload: { design: own.json().id } });
    expect(assign.statusCode).toBe(200);
  });

  it('shared mailboxes use their design, else the company’s service design', async () => {
    await app.inject({ method: 'PUT', url: '/api/admin/shared-mailboxes/panel-info@tenaxgrupa.lv', headers: IT, payload: { company: 'tenaxpanel', displayName: 'Tenax Panel serviss' } });
    await app.inject({ method: 'POST', url: '/api/admin/templates/tenaxpanel/new', headers: IT, payload: { design: service, content: '<p>SERVICE {{user.displayName}}</p>' } });
    const res = await app.inject({ url: '/api/signature?type=newMail&from=panel-info@tenaxgrupa.lv', headers: PANEL });
    expect(res.body).toBe('<p>SERVICE Tenax Panel serviss</p>');
    const bad = await app.inject({ method: 'PUT', url: '/api/admin/shared-mailboxes/panel-info@tenaxgrupa.lv', headers: IT, payload: { company: 'tenaxpanel', displayName: 'X', design: 'tenax-standard' } });
    expect(bad.statusCode).toBe(400);
  });

  it('the designs list comes back per company with each design’s layouts', async () => {
    const rows = (await app.inject({ url: '/api/admin/templates', headers: IT })).json();
    const panel = rows.find((r: any) => r.company.key === 'tenaxpanel');
    expect(panel.designs.map((d: any) => d.name)).toEqual(expect.arrayContaining(['Standard', 'Service']));
    expect(panel.designs.every((d: any) => d.new && d.reply)).toBe(true);
  });
});

describe('admin corrections keep the person’s own design choice', async () => {
  const { app } = await makeApp();
  it('saving a title correction does not reset their chosen design', async () => {
    const d = (await app.inject({ method: 'POST', url: '/api/admin/designs', headers: IT, payload: { company: 'tenaxpanel', name: 'English' } })).json();
    await app.inject({ method: 'PUT', url: '/api/me/design', headers: PANEL, payload: { design: d.id } });
    await app.inject({ method: 'PUT', url: '/api/admin/users/test.panel@tenaxgrupa.lv/overrides', headers: IT, payload: { jobTitleLv: 'Inženieris', design: null, designLocked: false } });
    expect((await app.inject({ url: '/api/me', headers: PANEL })).json().design).toMatchObject({ id: d.id, source: 'chosen' });
  });
});

describe('Outlook add-in: Signatures button', async () => {
  const { app } = await makeApp();
  it('serves the task pane script with the runtime config, and no other script names', async () => {
    const js = await app.inject({ url: '/addin/taskpane.js' });
    expect(js.statusCode).toBe(200);
    expect(js.body.startsWith('globalThis.__SIG_CONFIG__ = {"apiBase":"https://sig.tenax.lv"')).toBe(true);
    expect((await app.inject({ url: '/addin/launchevent.js' })).body.startsWith('globalThis.__SIG_CONFIG__')).toBe(true);
    expect((await app.inject({ url: '/addin/taskpane.html' })).statusCode).toBe(200);
  });
  it('the manifest (normal and test) has the compose button and task pane', async () => {
    for (const url of ['/addin/manifest.xml', '/addin/manifest.xml?variant=test']) {
      const xml = (await app.inject({ url })).body;
      expect(xml).toContain('MessageComposeCommandSurface');
      expect(xml).toContain('AppointmentOrganizerCommandSurface');
      expect(xml).toContain('https://sig.tenax.lv/addin/taskpane.html');
      expect(xml).toContain('<Version>1.1.1.0</Version>');
      expect(xml).toContain('/addin/icon-sig-64.png');
    }
  });
});

describe('company chosen by IT overrides group membership', async () => {
  const { app } = await makeApp();
  const MULTI = mock('test.multi@tenaxgrupa.lv'); // in Tenax + Vareno groups → Tenax by priority
  it('switches company (and default signature) despite the groups, and back', async () => {
    const before = (await app.inject({ url: '/api/admin/users/test.multi@tenaxgrupa.lv', headers: IT })).json();
    expect(before).toMatchObject({ company: 'tenax', companySource: 'group', conflict: true });
    await app.inject({ method: 'PUT', url: '/api/admin/users/test.multi@tenaxgrupa.lv/overrides', headers: IT, payload: { company: 'vareno' } });
    const after = (await app.inject({ url: '/api/admin/users/test.multi@tenaxgrupa.lv', headers: IT })).json();
    expect(after).toMatchObject({ company: 'vareno', companySource: 'override', conflict: false });
    expect((await app.inject({ url: '/api/signature?type=newMail', headers: MULTI })).body).toContain('signature:vareno:new');
    expect((await app.inject({ url: '/api/me', headers: MULTI })).json().design.id).toBe('vareno-standard');
    await app.inject({ method: 'PUT', url: '/api/admin/users/test.multi@tenaxgrupa.lv/overrides', headers: IT, payload: { company: null } });
    expect((await app.inject({ url: '/api/signature?type=newMail', headers: MULTI })).body).toContain('signature:tenax:new');
  });
  it('drops a design of the old company when the company changes', async () => {
    const en = (await app.inject({ method: 'POST', url: '/api/admin/designs', headers: IT, payload: { company: 'tenax', name: 'English' } })).json();
    await app.inject({ method: 'PUT', url: '/api/admin/users/test.multi@tenaxgrupa.lv/overrides', headers: IT, payload: { design: en.id, designLocked: true } });
    await app.inject({ method: 'PUT', url: '/api/admin/users/test.multi@tenaxgrupa.lv/overrides', headers: IT, payload: { company: 'vareno' } });
    const me = (await app.inject({ url: '/api/me', headers: MULTI })).json();
    expect(me).toMatchObject({ designLocked: false, design: { id: 'vareno-standard', source: 'default' } });
  });
});

describe('restoring designs', async () => {
  const { app, repo } = await makeApp();
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const row = async () => (await app.inject({ url: '/api/admin/templates', headers: IT })).json().find((r: any) => r.company.key === 'tenaxpanel');

  it('restores everything (layout fonts/sizes, wording, brand) to a point in time', async () => {
    const r0 = await row();
    const d0 = r0.designs.find((d: any) => d.isDefault);
    const A = d0.new.blocks;
    await sleep(15);
    const checkpoint = new Date().toISOString();
    await sleep(15);
    // Change everything after the checkpoint
    const B = structuredClone(A);
    B.base.font = 'verdana';
    B.base.size = 14;
    B.main[0].style = { ...B.main[0].style, size: 22 };
    await app.inject({ method: 'POST', url: '/api/admin/templates/tenaxpanel/new', headers: IT, payload: { blocks: B, design: d0.id } });
    await app.inject({ method: 'PUT', url: `/api/admin/designs/${d0.id}`, headers: IT, payload: { metaOverrides: { greeting: 'Best regards,', footer: { companyLine: 'TENAX PANEL Ltd' } } } });
    const meta = JSON.parse(r0.meta.content);
    meta.logo.width = 150;
    meta.colors.primary = '#FF0000';
    await app.inject({ method: 'POST', url: '/api/admin/templates/tenaxpanel/meta', headers: IT, payload: { content: JSON.stringify(meta) } });

    const res = await app.inject({ method: 'POST', url: `/api/admin/designs/${d0.id}/restore-to`, headers: IT, payload: { at: checkpoint } });
    expect(res.statusCode).toBe(200);
    expect(res.json().restored.sort()).toEqual(['meta', 'new', 'wording']);
    const r1 = await row();
    const d1 = r1.designs.find((d: any) => d.isDefault);
    expect(d1.new.blocks).toEqual(A);
    expect(d1.metaOverrides).toEqual({});
    expect(r1.meta.content).toBe(r0.meta.content);
  });

  it('restoring a single wording version brings those values back', async () => {
    const d = (await row()).designs.find((x: any) => x.isDefault);
    await app.inject({ method: 'PUT', url: `/api/admin/designs/${d.id}`, headers: IT, payload: { metaOverrides: { greeting: 'One' } } });
    await app.inject({ method: 'PUT', url: `/api/admin/designs/${d.id}`, headers: IT, payload: { metaOverrides: { greeting: 'Two' } } });
    const hist = (await app.inject({ url: `/api/admin/templates/tenaxpanel/history?design=${d.id}&kind=wording`, headers: IT })).json();
    const one = hist.find((h: any) => repo.getTemplateVersion(h.id)!.content.includes('One'));
    await app.inject({ method: 'POST', url: `/api/admin/templates/restore/${one.id}`, headers: IT });
    expect(repo.getDesign(d.id)!.metaOverrides).toEqual({ greeting: 'One' });
  });
});
