import { describe, expect, it } from 'vitest';
import { fillSvg, listTextFields, sanitizeSvg, suggestCrop } from '../src/services/svgsig.js';
import { readFontNames } from '../src/services/fonts.js';
import fs from 'node:fs';
import path from 'node:path';
import { XMLSerializer } from '@xmldom/xmldom';
import { makeApp, mock } from './helpers.js';

const IT = mock('test.tenax@tenaxgrupa.lv');
const VARENO = mock('test.vareno@tenaxgrupa.lv');
const EDITOR = mock('test.lv@tenaxgrupa.lv'); // Tenapors editor
const root = path.resolve(import.meta.dirname, '..', '..');

// A small Inkscape-style card: page bigger than the card, nested styled tspans, a script and an external image.
const SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="400" height="300" viewBox="0 0 400 300">
  <defs><color-profile name="x" xlink:href="data:application/vnd.iccprofile;base64,AAAA"/></defs>
  <script>alert(1)</script>
  <rect x="50" y="100" width="300" height="80" style="fill:#20314e" onclick="alert(2)"/>
  <image x="0" y="0" width="1" height="1" xlink:href="https://evil.example/track.png"/>
  <text id="name" x="200" y="125" style="font-size:12px;font-weight:700;font-family:Poppins;fill:#ffffff">VĀRDS UZVĀRDS</text>
  <text id="title" x="200" y="140" style="font-size:9px;font-weight:700;font-family:Poppins;fill:#ffffff">Amats</text>
  <text id="contact" style="font-size:8px" transform="translate(200,150)">
    <tspan x="0" y="0"><tspan style="font-weight:300;font-family:Poppins;fill:#f3f4f5">Spodrības iela 1</tspan></tspan>
    <tspan x="0" y="10"><tspan style="font-weight:300;font-family:Poppins;fill:#f3f4f5">Mob: +371 11111111</tspan></tspan>
    <tspan x="0" y="20"><tspan style="font-weight:300;font-family:Poppins;fill:#f3f4f5">www.varenogroup.lv</tspan></tspan>
  </text>
</svg>`;

describe('SVG templates', () => {
  it('sanitizes scripts, handlers, external references and colour profiles', () => {
    const clean = sanitizeSvg(SVG);
    expect(clean).not.toMatch(/<script|onclick|evil\.example|color-profile/);
    expect(clean).toContain('VĀRDS UZVĀRDS');
  });

  it('lists text fields with their lines and nested fonts', () => {
    const fields = listTextFields(sanitizeSvg(SVG));
    expect(fields.map((f) => f.id)).toEqual(['name', 'title', 'contact']);
    expect(fields[2]).toMatchObject({ family: 'Poppins', weight: 300, lines: [{ text: 'Spodrības iela 1' }, { text: 'Mob: +371 11111111' }, { text: 'www.varenogroup.lv' }] });
  });

  it('suggests a crop around the visible card, not the whole page', () => {
    const crop = suggestCrop(sanitizeSvg(SVG), [path.join(root, 'assets/fonts/Poppins-Bold.ttf')]);
    expect(crop.x).toBeCloseTo(50, 0);
    expect(crop.y).toBeCloseTo(100, 0);
    expect(crop.width).toBeGreaterThanOrEqual(299);
    expect(crop.height).toBeGreaterThanOrEqual(79);
  });

  it('fills fields as plain text, keeps line styles, and drops empty lines moving the rest up', () => {
    const cfg = {
      svg: sanitizeSvg(SVG), crop: { x: 50, y: 100, width: 300, height: 80 }, width: 500, link: '',
      fields: {
        name: { lines: ['{{displayName|upper}}'], shrinkToFit: true },
        contact: { lines: ['Spodrības iela 1', 'Mob: {{mobilePhone}}', 'www.varenogroup.lv'], shrinkToFit: false },
      },
    };
    const out = new XMLSerializer().serializeToString(fillSvg(cfg, { displayName: 'ļoti <b>īss</b>', jobTitleLv: null, jobTitleEn: null, mobilePhone: null, officePhone: null, email: null, department: null }));
    expect(out).toContain('ĻOTI &lt;B&gt;ĪSS&lt;/B&gt;'); // text, never markup
    expect(out).not.toContain('Mob:');
    // website moved up into the second line slot (y=10) and keeps its styled inner tspan
    expect(out).toMatch(/<tspan x="0" y="10"><tspan style="font-weight:300;font-family:Poppins;fill:#f3f4f5">www\.varenogroup\.lv<\/tspan><\/tspan>/);
  });

  it('reads font names and weights', () => {
    expect(readFontNames(fs.readFileSync(path.join(root, 'assets/fonts/Poppins-Light.ttf')))).toMatchObject({ family: 'Poppins', weight: 300 });
  });
});

describe('image designs through the API', async () => {
  const { app, repo } = await makeApp();
  let id = '';

  it('creates an image design: analyze → save → signature is a linked image', async () => {
    id = (await app.inject({ method: 'POST', url: '/api/admin/designs', headers: IT, payload: { company: 'vareno', name: 'Image' } })).json().id;
    const an = await app.inject({ method: 'POST', url: `/api/admin/designs/${id}/image/analyze`, headers: IT, payload: { svg: SVG } });
    expect(an.statusCode).toBe(200);
    const a = an.json();
    expect(a.suggested.fields.name.lines).toEqual(['{{displayName|upper}}']);
    expect(a.suggested.fields.title.lines).toEqual(['{{title}}']);
    expect(a.suggested.fields.contact.lines[1]).toBe('Mob: {{mobilePhone}}');
    expect(a.missingFonts).toEqual([]);

    expect(a.suggested.width).toBe(300); // card width (300 units) when narrower than 650px
    const prev = await app.inject({ method: 'POST', url: `/api/admin/designs/${id}/image/preview`, headers: IT, payload: { svg: a.svg, ...a.suggested, width: 500, link: 'https://www.varenogroup.lv' } });
    expect(prev.json().dataUrl).toMatch(/^data:image\/png;base64,iVBOR/);

    const save = await app.inject({ method: 'POST', url: `/api/admin/designs/${id}/image`, headers: IT, payload: { svg: a.svg, ...a.suggested, width: 500, link: 'https://www.varenogroup.lv' } });
    expect(save.statusCode).toBe(200);
    await app.inject({ method: 'PUT', url: `/api/admin/designs/${id}`, headers: IT, payload: { isDefault: true } });

    for (const type of ['newMail', 'reply']) {
      const sig = (await app.inject({ url: `/api/signature?type=${type}`, headers: VARENO })).body;
      expect(sig).toMatch(/^<!-- signature:vareno:image -->\n<a href="https:\/\/www\.varenogroup\.lv" style="text-decoration:none;"><img src="https:\/\/sig\.tenax\.lv\/sig-img\/[a-f0-9]{40}\.png" width="500" height="133"/);
      expect(sig).toContain('alt="Laura Ozola, Grāmatvede | SIA &#34;Vareno Group&#34; | Tālr.: +371 67 333 444 | test.vareno@tenaxgrupa.lv | www.varenogroup.lv"');
    }
  });

  it('serves the rendered PNG only for hashes the server created', async () => {
    const sig = (await app.inject({ url: '/api/signature?type=newMail', headers: VARENO })).body;
    const hash = /sig-img\/([a-f0-9]{40})\.png/.exec(sig)![1];
    const img = await app.inject({ url: `/sig-img/${hash}.png` });
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.rawPayload.subarray(1, 4).toString()).toBe('PNG');
    expect((await app.inject({ url: `/sig-img/${'0'.repeat(40)}.png` })).statusCode).toBe(404);
    expect((await app.inject({ url: '/sig-img/../../etc/passwd.png' })).statusCode).toBe(404);
  });

  it('rejects mappings to text that isn’t in the SVG, and non-https links', async () => {
    const bad = await app.inject({ method: 'POST', url: `/api/admin/designs/${id}/image`, headers: IT, payload: { fields: { nope: { lines: ['x'] } }, crop: { x: 0, y: 0, width: 10, height: 10 }, width: 500, link: '' } });
    expect(bad.statusCode).toBe(400);
    const link = await app.inject({ method: 'POST', url: `/api/admin/designs/${id}/image`, headers: IT, payload: { fields: {}, crop: { x: 0, y: 0, width: 10, height: 10 }, width: 500, link: 'javascript:alert(1)' } });
    expect(link.statusCode).toBe(400);
  });

  it('only that company’s editors (and IT) can touch it; fonts are IT-only', async () => {
    expect((await app.inject({ method: 'POST', url: `/api/admin/designs/${id}/image/analyze`, headers: EDITOR, payload: { svg: SVG } })).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/admin/fonts', headers: EDITOR })).statusCode).toBe(403);
    const fonts = (await app.inject({ url: '/api/admin/fonts', headers: IT })).json();
    expect(fonts.map((f: any) => `${f.family} ${f.weight} ${f.source}`)).toContain('Poppins 700 bundled');
  });

  it('font upload accepts real fonts only', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/admin/fonts', headers: IT, payload: { name: 'x.ttf', dataBase64: Buffer.from('<svg>').toString('base64') } });
    expect(bad.statusCode).toBe(400);
    const font = fs.readFileSync(path.join(root, 'assets/fonts/Poppins-Regular.ttf')).toString('base64');
    const ok = await app.inject({ method: 'POST', url: '/api/admin/fonts', headers: IT, payload: { name: 'Copy-Regular.ttf', dataBase64: font } });
    expect(ok.json()).toMatchObject({ family: 'Poppins', weight: 400, source: 'uploaded' });
    expect((await app.inject({ method: 'DELETE', url: '/api/admin/fonts/Copy-Regular.ttf', headers: IT })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: '/api/admin/fonts/Poppins-Bold.ttf', headers: IT })).statusCode).toBe(404);
  });

  it('a new design copied from an image design is an image design too', async () => {
    const copy = (await app.inject({ method: 'POST', url: '/api/admin/designs', headers: IT, payload: { company: 'vareno', name: 'Image EN', copyFrom: id } })).json();
    expect(repo.getDesign(copy.id)?.format).toBe('image');
    expect(repo.latestTemplate('vareno', 'image', copy.id)).toBeTruthy();
  });
});
