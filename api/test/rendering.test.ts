import { describe, expect, it } from 'vitest';
import { validateTemplateSource } from '../src/services/renderer.js';
import { makeApp, mock } from './helpers.js';

const FIXTURE_USERS = [
  'test.tenax', 'test.tenapors', 'test.panel', 'test.install', 'test.vareno', 'test.multi', 'test.nogroup', 'test.xss', 'test.lv',
].map((u) => `${u}@tenaxgrupa.lv`);

describe('rendered signatures', async () => {
  const { app } = await makeApp();
  const sig = async (upn: string, type = 'newMail') => {
    const res = await app.inject({ url: `/api/signature?type=${type}`, headers: mock(upn) });
    expect(res.statusCode).toBe(200);
    return res.body;
  };

  it('picks the right company design', async () => {
    expect(await sig('test.tenax@tenaxgrupa.lv')).toContain('signature:tenax:new');
    expect(await sig('test.tenapors@tenaxgrupa.lv')).toContain('signature:tenapors:new');
    expect(await sig('test.panel@tenaxgrupa.lv')).toContain('signature:tenaxpanel:new');
    expect(await sig('test.vareno@tenaxgrupa.lv')).toContain('signature:vareno:new');
  });

  it('uses the compact template for reply and forward', async () => {
    expect(await sig('test.tenax@tenaxgrupa.lv', 'reply')).toContain('signature:tenax:reply');
    expect(await sig('test.tenax@tenaxgrupa.lv', 'forward')).toContain('signature:tenax:reply');
  });

  it('omits lines for empty fields (no dangling labels)', async () => {
    const vareno = await sig('test.vareno@tenaxgrupa.lv');
    expect(vareno).not.toContain('M: ');
    const tenapors = await sig('test.tenapors@tenaxgrupa.lv');
    // Title row absent: the name row is followed directly by the department row.
    expect(tenapors).not.toMatch(/<tr><td style="padding:0;"><\/td><\/tr>/);
    expect(tenapors).not.toContain('undefined');
    expect(tenapors).not.toContain('null');
  });

  it('shows the override title for test.panel', async () => {
    expect(await sig('test.panel@tenaxgrupa.lv')).toContain('Tehniskais direktors');
  });

  it('escapes HTML in directory data', async () => {
    const html = await sig('test.xss@tenaxgrupa.lv');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;img src&#x3D;x onerror&#x3D;alert(1)&gt;');
  });

  it('keeps Latvian diacritics intact (UTF-8)', async () => {
    const res = await app.inject({ url: '/api/signature?type=newMail', headers: mock('test.lv@tenaxgrupa.lv') });
    expect(res.headers['content-type']).toContain('charset=utf-8');
    expect(res.body).toContain('Ņikita Āboliņš-Ēķīšūžļģč');
    expect(Buffer.from(res.rawPayload).toString('utf8')).toContain('ā');
  });

  it('honours hideMobile', async () => {
    const before = await sig('test.tenax@tenaxgrupa.lv');
    expect(before).toContain('+371 29 123 456');
    await app.inject({ method: 'PUT', url: '/api/admin/users/test.tenax@tenaxgrupa.lv/overrides', headers: mock('test.tenax@tenaxgrupa.lv'), payload: { hideMobile: true } });
    expect(await sig('test.tenax@tenaxgrupa.lv')).not.toContain('+371 29 123 456');
    await app.inject({ method: 'PUT', url: '/api/admin/users/test.tenax@tenaxgrupa.lv/overrides', headers: mock('test.tenax@tenaxgrupa.lv'), payload: { hideMobile: null } });
  });

  it('uses absolute HTTPS asset URLs', async () => {
    expect(await sig('test.tenax@tenaxgrupa.lv')).toContain('src="https://sig.tenaxgrupa.lv/assets/tenax/logo.png"');
  });

  it('switches to a shared mailbox signature only for configured mailboxes', async () => {
    const shared = await app.inject({ url: '/api/signature?type=newMail&from=info@tenaxgrupa.lv', headers: mock('test.vareno@tenaxgrupa.lv') });
    expect(shared.body).toContain('Tenax klientu serviss');
    expect(shared.body).toContain('signature:tenax:new');
    const other = await app.inject({ url: '/api/signature?type=newMail&from=ceo@tenaxgrupa.lv', headers: mock('test.vareno@tenaxgrupa.lv') });
    expect(other.body).toContain('Laura Ozola');
  });

  it('rejects an unknown compose type', async () => {
    const res = await app.inject({ url: '/api/signature?type=evil', headers: mock('test.tenax@tenaxgrupa.lv') });
    expect(res.statusCode).toBe(400);
  });

  describe('snapshots', () => {
    for (const upn of FIXTURE_USERS) {
      it(`${upn} new + reply`, async () => {
        expect(await sig(upn, 'newMail')).toMatchSnapshot('new');
        expect(await sig(upn, 'reply')).toMatchSnapshot('reply');
      });
    }
  });
});

describe('template safety', () => {
  it('rejects triple-stash and {{& }}', () => {
    expect(() => validateTemplateSource('{{{user.displayName}}}')).toThrow(/Unescaped/);
    expect(() => validateTemplateSource('{{& user.displayName}}')).toThrow(/Unescaped/);
  });
  it('rejects script tags and syntax errors', () => {
    expect(() => validateTemplateSource('<script>x</script>')).toThrow();
    expect(() => validateTemplateSource('{{#if x}}')).toThrow();
  });

  it('refuses to save an unsafe template through the API', async () => {
    const { app } = await makeApp();
    const res = await app.inject({
      method: 'POST', url: '/api/admin/templates/tenax/new', headers: mock('test.tenax@tenaxgrupa.lv'),
      payload: { content: '<b>{{{user.displayName}}}</b>' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('versions templates and restores old versions', async () => {
    const { app, repo } = await makeApp();
    const h = mock('test.tenax@tenaxgrupa.lv');
    const v1 = repo.latestTemplate('tenax', 'reply')!;
    const saved = await app.inject({ method: 'POST', url: '/api/admin/templates/tenax/reply', headers: h, payload: { content: '<p>{{user.displayName}} – v2</p>' } });
    expect(saved.json().version).toBe(v1.version + 1);
    const reply = await app.inject({ url: '/api/signature?type=reply', headers: h });
    expect(reply.body).toBe('<p>Jānis Testeris – v2</p>');
    const restored = await app.inject({ method: 'POST', url: `/api/admin/templates/restore/${v1.id}`, headers: h });
    expect(restored.json().version).toBe(v1.version + 2);
    expect((await app.inject({ url: '/api/signature?type=reply', headers: h })).body).toContain('signature:tenax:reply');
  });
});
