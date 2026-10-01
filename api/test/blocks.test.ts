import { describe, expect, it } from 'vitest';
import { blockDocSchema, compileBlocks, extractBlocks, presetDoc, stripBlocksHeader, type BlockDoc } from '../src/services/blocks.js';
import { validateTemplateSource } from '../src/services/renderer.js';
import { makeApp, mock } from './helpers.js';

const doc = (patch: Partial<BlockDoc> = {}): BlockDoc => ({ ...presetDoc('side'), ...patch });

describe('block compiler', () => {
  it('produces a valid, email-safe template with the design embedded', () => {
    const html = compileBlocks(doc(), 'new');
    expect(() => validateTemplateSource(html)).not.toThrow();
    expect(extractBlocks(html)).toEqual(doc());
    const body = stripBlocksHeader(html);
    expect(body.startsWith('<!-- signature:{{company.key}}:new -->')).toBe(true);
    expect(body).not.toContain('sig-blocks');
    expect(body).not.toMatch(/<style|<div|class=/);
  });

  it('wraps every data block in {{#if}} so empty fields drop their line', () => {
    const body = stripBlocksHeader(compileBlocks(doc(), 'new'));
    for (const cond of ['user.jobTitleLv', 'user.mobilePhone', 'user.officePhone', 'meta.footer.registrationNumber', 'meta.websites']) {
      expect(body).toContain(`{{#if ${cond}}}`);
    }
  });

  it('treats static text and labels as literal text, never as markup or Handlebars', () => {
    const d = doc({ main: [{ id: 't', type: 'text', text: '<b>{{user.email}}</b> & {{{x}}}', style: {} }] });
    const body = stripBlocksHeader(compileBlocks(d, 'new'));
    expect(body).toContain('&lt;b&gt;&#123;&#123;user.email&#125;&#125;&lt;/b&gt; &amp; &#123;&#123;&#123;x&#125;&#125;&#125;');
    expect(() => validateTemplateSource(compileBlocks(d, 'new'))).not.toThrow();
  });

  it('applies styles: size in pt, bold, italic, uppercase, colours (token or hex), spacing', () => {
    const d = doc({
      base: { font: 'verdana', size: 9, lineHeight: 1.5, color: 'text' },
      main: [{ id: 'n', type: 'name', style: { size: 14, bold: true, italic: true, uppercase: true, color: '#ff0000', spaceAfter: 8 } }],
    });
    const body = stripBlocksHeader(compileBlocks(d, 'new'));
    expect(body).toContain('padding:0 0 8px 0;font-family:Verdana, Geneva, sans-serif;font-size:14pt;line-height:21pt;color:#ff0000;font-weight:bold;font-style:italic;text-transform:uppercase');
  });

  it('skips hidden blocks', () => {
    const d = doc({ main: [{ id: 'n', type: 'name', hidden: true, style: {} }, { id: 'e', type: 'email', style: {} }] });
    const body = stripBlocksHeader(compileBlocks(d, 'new'));
    expect(body).not.toContain('user.displayName');
    expect(body).toContain('user.email');
  });

  it('rejects invalid designs', () => {
    expect(blockDocSchema.safeParse({ ...doc(), base: { ...doc().base, font: 'comic-sans' } }).success).toBe(false);
    expect(blockDocSchema.safeParse({ ...doc(), main: [{ id: 'n', type: 'name', style: { color: 'red; background:url(x)' } }] }).success).toBe(false);
    expect(blockDocSchema.safeParse({ ...doc(), main: [{ id: 'n', type: 'name', style: { size: 200 } }] }).success).toBe(false);
  });

  it('ignores a tampered header', () => {
    expect(extractBlocks('<!-- sig-blocks:v1:bm90IGpzb24= -->\n<p>x</p>')).toBeNull();
    expect(extractBlocks('<p>hand-written</p>')).toBeNull();
  });
});

describe('visual designs through the API', async () => {
  const { app, repo } = await makeApp();
  const h = mock('test.tenax@tenaxgrupa.lv');

  it('the shipped designs are visual (block) designs', async () => {
    const rows = (await app.inject({ url: '/api/admin/templates', headers: h })).json();
    for (const r of rows) {
      expect(r.new.blocks?.version, r.company.key).toBe(1);
      expect(r.reply.blocks?.version, r.company.key).toBe(1);
    }
  });

  it('previews and saves a block design; the sent signature never contains the design data', async () => {
    const d = doc({ main: [{ id: 'n', type: 'name', style: { size: 20, color: '#123456' } }, { id: 'e', type: 'email', style: {} }] });
    const prev = await app.inject({ method: 'POST', url: '/api/admin/templates/preview', headers: h, payload: { company: 'tenax', type: 'newMail', blocks: d } });
    expect(prev.statusCode).toBe(200);
    expect(prev.body).toContain('font-size:20pt');
    const saved = await app.inject({ method: 'POST', url: '/api/admin/templates/tenax/new', headers: h, payload: { blocks: d, note: 'bigger name' } });
    expect(saved.statusCode).toBe(200);
    expect(extractBlocks(repo.latestTemplate('tenax', 'new')!.content)).toEqual(d);
    const sig = await app.inject({ url: '/api/signature?type=newMail', headers: h });
    expect(sig.body).toContain('font-size:20pt');
    expect(sig.body).toContain('Jānis Testeris');
    expect(sig.body).not.toContain('sig-blocks');
  });

  it('rejects an invalid block design with a 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/admin/templates/tenax/new', headers: h, payload: { blocks: { version: 1, layout: 'nope', main: [] } } });
    expect(res.statusCode).toBe(400);
  });

  it('serves presets', async () => {
    const p = (await app.inject({ url: '/api/admin/templates/presets', headers: h })).json();
    expect(Object.keys(p)).toEqual(['side', 'stacked', 'textOnly', 'reply']);
  });
});

describe('uploaded fonts in visual designs', () => {
  it('uses the family with a fallback stack', () => {
    const d = doc({ base: { font: 'custom:Arial Nova', fallback: 'arial', size: 10, lineHeight: 1.3, color: 'text' } as any });
    expect(blockDocSchema.safeParse(d).success).toBe(true);
    const body = stripBlocksHeader(compileBlocks(blockDocSchema.parse(d), 'new'));
    expect(body).toContain("font-family:'Arial Nova', Arial, Helvetica, sans-serif");
  });
  it('rejects anything that could break out of the style attribute', () => {
    for (const font of ["custom:x';background:url(y)", 'custom:"x"', 'custom:x;color:red', 'comic']) {
      expect(blockDocSchema.safeParse(doc({ base: { font, size: 10, lineHeight: 1.3, color: 'text' } as any })).success, font).toBe(false);
    }
  });
});
