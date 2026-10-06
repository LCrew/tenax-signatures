import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { INLINE_MAX_BYTES, inlineImages, type ImageSource } from '../src/services/inline.js';
import { makeApp, mock } from './helpers.js';

const root = path.resolve(import.meta.dirname, '..', '..');
const LOGO = fs.readFileSync(path.join(root, 'assets/tenax/logo.png'));

describe('inline signature images (add-in, ?inline=1)', async () => {
  const { app } = await makeApp();
  const get = (q: string, upn = 'test.tenax@tenaxgrupa.lv') => app.inject({ url: `/api/signature?${q}`, headers: mock(upn) });

  it('embeds the logo as a cid: attachment and returns its bytes', async () => {
    const res = await get('type=newMail&inline=1');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['cache-control']).toBe('no-store');
    const { html, images } = res.json();
    expect(images).toHaveLength(1);
    expect(images[0].name).toMatch(/^tenax-logo-[a-f0-9]{8}\.png$/);
    expect(images[0].url).toBe('https://sig.tenax.lv/assets/tenax/logo.png');
    expect(Buffer.from(images[0].base64, 'base64').equals(LOGO)).toBe(true);
    expect(html).toContain(`src="cid:${images[0].name}"`);
    expect(html).not.toContain('/assets/tenax/logo.png');
  });

  it('uses a fresh name per signature, so it never clashes with a quoted earlier one', async () => {
    const a = (await get('type=newMail&inline=1')).json().images[0].name;
    const b = (await get('type=newMail&inline=1')).json().images[0].name;
    expect(a).not.toBe(b);
  });

  it('applies to shared mailbox signatures too', async () => {
    const { html, images } = (await get('type=newMail&from=info@tenaxgrupa.lv&inline=1', 'test.vareno@tenaxgrupa.lv')).json();
    expect(html).toContain('Tenax klientu serviss');
    expect(html).toContain(`src="cid:${images[0].name}"`);
  });

  it('without ?inline=1 the HTML keeps linked images (copy button, older add-in builds)', async () => {
    const res = await get('type=newMail');
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('src="https://sig.tenax.lv/assets/tenax/logo.png"');
  });
});

describe('inlineImages', () => {
  const source = (over: Partial<ImageSource> = {}): ImageSource => ({
    asset: (company, file) => (company === 'tenax' && file === 'logo.png' ? LOGO : file.startsWith('banner-') ? LOGO : null),
    signatureImage: () => Buffer.from('png'),
    ...over,
  });
  const base = 'https://sig.tenax.lv';

  it('embeds each of our images once, even when used twice', () => {
    const html = `<img src="${base}/assets/tenax/logo.png"><img width="1" src='${base}/assets/tenax/logo.png'>`;
    const out = inlineImages(html, `${base}/`, source());
    expect(out.images).toHaveLength(1);
    const n = out.images[0].name;
    expect(out.html).toBe(`<img src="cid:${n}"><img width="1" src='cid:${n}'>`);
  });

  it('embeds image signatures', () => {
    const out = inlineImages(`<img src="${base}/sig-img/${'a'.repeat(40)}.png">`, base, source());
    expect(out.images[0]).toMatchObject({ url: `${base}/sig-img/${'a'.repeat(40)}.png`, base64: Buffer.from('png').toString('base64') });
    expect(out.images[0].name).toMatch(/^signature-[a-f0-9]{8}\.png$/);
  });

  it('leaves banners, other hosts, missing files and oversized images linked', () => {
    const html = [
      `<img src="${base}/assets/tenax/banner-promo.png">`,
      '<img src="https://evil.example/assets/tenax/logo.png">',
      `<img src="${base}/assets/tenax/missing.png">`,
      `<img src="${base}/assets/tenax/../x/logo.png">`,
    ].join('');
    expect(inlineImages(html, base, source())).toEqual({ html, images: [] });
    const big = inlineImages(`<img src="${base}/assets/tenax/logo.png">`, base, source({ asset: () => Buffer.alloc(INLINE_MAX_BYTES + 1) }));
    expect(big.images).toEqual([]);
  });

  it('a failed image-signature render keeps the link', () => {
    const html = `<img src="${base}/sig-img/${'b'.repeat(40)}.png">`;
    expect(inlineImages(html, base, source({ signatureImage: () => null })).html).toBe(html);
  });
});
