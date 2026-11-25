import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { presetDoc } from '../src/services/blocks.js';
import { makeApp, mock } from './helpers.js';

const IT = { ...mock('test.tenax@tenaxgrupa.lv'), origin: 'https://sig.tenax.lv' };
const PERSON = 'test.lv@tenaxgrupa.lv'; // Tenapors
const OTHER = 'test.tenapors@tenaxgrupa.lv'; // Tenapors, Latvian

const LV_BANNER = 'banner-2026-tenapors-e-pasta-banneris-dp-akcija.png';
const LT_BANNER = 'banner-lt-tenapors-e-pasta-banneris-dp-akcija-lt.jpg';
const EN_BANNER = 'banner-tenaporscompact.jpg';

const baseMeta = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../../templates/tenapors/meta.json'), 'utf8'));
const banner = (file: string) => ({ file, width: 600, height: 200 });

describe('Estonian and Lithuanian colleagues', async () => {
  const { app, ctx } = await makeApp();
  const sig = async (upn = PERSON, type = 'newMail') => (await app.inject({ url: `/api/signature?type=${type}`, headers: mock(upn) })).body;
  const setPerson = (payload: object) => app.inject({ method: 'PUT', url: `/api/admin/users/${PERSON}/overrides`, headers: IT, payload });
  const saveMeta = (meta: object) => app.inject({ method: 'POST', url: '/api/admin/templates/tenapors/meta', headers: IT, payload: { content: JSON.stringify(meta) } });

  it('get their own-language title plus the English one, even when Settings say Latvian only', async () => {
    ctx.settings.update({ language: 'lv' });
    expect((await setPerson({ language: 'et', jobTitleLv: 'Kvaliteedispetsialist', jobTitleEn: 'Quality Specialist' })).statusCode).toBe(200);
    const s = await sig();
    expect(s).toContain('Kvaliteedispetsialist');
    expect(s).toContain('Quality Specialist');
    // Latvian colleagues still follow Settings.
    await app.inject({ method: 'PUT', url: `/api/admin/users/${OTHER}/overrides`, headers: IT, payload: { jobTitleEn: 'Production Manager' } });
    expect(await sig(OTHER)).not.toContain('Production Manager');
    ctx.settings.update({ language: 'bilingual' });
  });

  it('designs set to English only stay English only', async () => {
    const def = ctx.repo.listDesigns('tenapors').find((d) => d.isDefault)!;
    await app.inject({ method: 'PUT', url: `/api/admin/designs/${def.id}`, headers: IT, payload: { language: 'en' } });
    const s = await sig();
    expect(s).toContain('Quality Specialist');
    expect(s).not.toContain('Kvaliteedispetsialist');
    await app.inject({ method: 'PUT', url: `/api/admin/designs/${def.id}`, headers: IT, payload: { language: null } });
  });

  it('get their language’s closing line: the standard one until the company sets its own, none when the company uses none', async () => {
    expect((await saveMeta({ ...baseMeta, greeting: 'Ar cieņu,' })).statusCode).toBe(200);
    expect(await sig()).toContain('Lugupidamisega,');
    expect(await sig(OTHER)).toContain('Ar cieņu,');
    await saveMeta({ ...baseMeta, greeting: 'Ar cieņu,', languages: { et: { greeting: 'Parimate soovidega,' } } });
    expect(await sig()).toContain('Parimate soovidega,');
    await saveMeta({ ...baseMeta, greeting: '' });
    expect(await sig()).not.toContain('Lugupidamisega,');
  });

  it('get their language’s promo banner; a language without one gets the Latvian banner, null = none', async () => {
    await saveMeta({ ...baseMeta, banner: banner(LV_BANNER), languages: { lt: { banner: banner(LT_BANNER) }, et: { banner: null }, en: { banner: banner(EN_BANNER) } } });
    expect(await sig(OTHER)).toContain(LV_BANNER);
    expect(await sig()).not.toContain('banner-'); // et: none
    await setPerson({ language: 'lt' });
    expect(await sig()).toContain(LT_BANNER);
    expect(await sig(PERSON, 'reply')).not.toContain('banner-'); // new messages only
    // An English design: English banner for everyone on it.
    const def = ctx.repo.listDesigns('tenapors').find((d) => d.isDefault)!;
    await app.inject({ method: 'PUT', url: `/api/admin/designs/${def.id}`, headers: IT, payload: { language: 'en' } });
    expect(await sig()).toContain(EN_BANNER);
    expect(await sig(OTHER)).toContain(EN_BANNER);
    await app.inject({ method: 'PUT', url: `/api/admin/designs/${def.id}`, headers: IT, payload: { language: null } });
    // No banner settings for English: the Latvian banner, as before languages existed.
    await saveMeta({ ...baseMeta, banner: banner(LV_BANNER), languages: { lt: { banner: banner(LT_BANNER) } } });
    await setPerson({ language: null });
    expect(await sig()).toContain(LV_BANNER);
  });

  it('a design that hides the banner hides it in every language', async () => {
    await setPerson({ language: 'lt' });
    const def = ctx.repo.listDesigns('tenapors').find((d) => d.isDefault)!;
    await app.inject({ method: 'PUT', url: `/api/admin/designs/${def.id}`, headers: IT, payload: { metaOverrides: { banner: null } } });
    expect(await sig()).not.toContain('banner-');
    await app.inject({ method: 'PUT', url: `/api/admin/designs/${def.id}`, headers: IT, payload: { metaOverrides: {} } });
    expect(await sig()).toContain(LT_BANNER);
  });

  it('refuses unknown languages and banners that aren’t uploaded for the company', async () => {
    expect((await saveMeta({ ...baseMeta, languages: { de: { greeting: 'Mit freundlichen Grüßen,' } } })).statusCode).toBe(422);
    expect((await saveMeta({ ...baseMeta, languages: { et: { banner: banner('banner-missing.png') } } })).statusCode).toBe(400);
    expect((await setPerson({ language: 'de' })).statusCode).toBe(400);
  });

  it('only admins and editors set the language, not the person themselves', async () => {
    ctx.settings.update({ selfServiceEnabled: true, selfServiceFields: ['jobTitleEn', 'jobTitleLv'] });
    const res = await app.inject({ method: 'PUT', url: '/api/me/overrides', headers: { ...mock(PERSON), origin: 'https://sig.tenax.lv' }, payload: { language: 'et' } });
    expect(res.statusCode).toBe(403);
    const me = (await app.inject({ url: '/api/me', headers: mock(PERSON) })).json();
    expect(me.fields.language).toBe('lt');
  });

  it('the designer previews a sample Estonian or Lithuanian colleague', async () => {
    const preview = (language?: string) =>
      app.inject({ method: 'POST', url: '/api/admin/templates/preview', headers: IT, payload: { company: 'tenapors', type: 'newMail', language } });
    expect((await preview('et')).body).toContain('Müügiprojektide juht');
    expect((await preview('lt')).body).toContain(LT_BANNER);
    expect((await preview()).body).toContain('Pārdošanas projektu vadītāja');
    const en = (await preview('en')).body;
    expect(en).toContain('Sales Project Manager');
    expect(en).not.toContain('Pārdošanas projektu vadītāja');
    expect((await preview('de')).statusCode).toBe(400);
    // An unsaved "Latvian only" choice for the design.
    const lvOnly = await app.inject({ method: 'POST', url: '/api/admin/templates/preview', headers: IT, payload: { company: 'tenapors', type: 'newMail', designLanguage: 'lv' } });
    expect(lvOnly.body).not.toContain('Sales Project Manager');
  });

  it('a design’s own closing line and banner are its Latvian ones: Estonian and Lithuanian colleagues keep their language’s', async () => {
    const def = ctx.repo.listDesigns('tenapors').find((d) => d.isDefault)!;
    const setDesign = (metaOverrides: object) => app.inject({ method: 'PUT', url: `/api/admin/designs/${def.id}`, headers: IT, payload: { metaOverrides } });
    await saveMeta({ ...baseMeta, greeting: 'Ar cieņu,', banner: banner(LV_BANNER), languages: { lt: { greeting: 'Pagarbiai,', banner: banner(LT_BANNER) } } });
    expect((await setDesign({ greeting: 'Ar labiem vēlējumiem,', banner: banner(EN_BANNER) })).statusCode).toBe(200);
    await setPerson({ language: 'lt' });
    const lv = await sig(OTHER);
    expect(lv).toContain('Ar labiem vēlējumiem,');
    expect(lv).toContain(EN_BANNER);
    const lt = await sig();
    expect(lt).toContain('Pagarbiai,');
    expect(lt).toContain(LT_BANNER);
    expect(lt).not.toContain('Ar labiem vēlējumiem,');
    expect(lt).not.toContain(EN_BANNER);
    // Nothing set for Estonian: the standard Estonian line and the design's banner.
    await setPerson({ language: 'et' });
    const et = await sig();
    expect(et).toContain('Lugupidamisega,');
    expect(et).toContain(EN_BANNER);
    // A design with no closing line has none in any language.
    await setDesign({ greeting: '' });
    await setPerson({ language: 'lt' });
    expect(await sig()).not.toContain('Pagarbiai,');
    await setDesign({});
    expect(await sig()).toContain('Pagarbiai,');
  });

  it('a banner picked on a layout is the Latvian one: a language with its own banner (or none) replaces it', async () => {
    const doc = presetDoc('side');
    doc.footer = doc.footer.map((b) => (b.type === 'banner' ? { ...b, image: { ...banner(LV_BANNER), link: 'https://www.tenapors.lv' } } : b));
    expect((await app.inject({ method: 'POST', url: '/api/admin/templates/tenapors/new', headers: IT, payload: { blocks: doc } })).statusCode).toBe(200);
    await saveMeta({ ...baseMeta, languages: { lt: { banner: banner(LT_BANNER) }, et: { banner: null } } });
    expect(await sig(OTHER)).toContain(LV_BANNER);
    await setPerson({ language: 'lt' });
    const lt = await sig();
    expect(lt).toContain(LT_BANNER);
    expect(lt).not.toContain(LV_BANNER);
    await setPerson({ language: 'et' });
    expect(await sig()).not.toContain('banner-');
    // No banner set for the language: the layout's banner.
    await saveMeta({ ...baseMeta });
    expect(await sig()).toContain(LV_BANNER);
    // The designer's preview of an unsaved layout does the same.
    await saveMeta({ ...baseMeta, languages: { lt: { banner: banner(LT_BANNER) } } });
    const preview = await app.inject({ method: 'POST', url: '/api/admin/templates/preview', headers: IT, payload: { company: 'tenapors', type: 'newMail', language: 'lt', blocks: doc } });
    expect(preview.body).toContain(LT_BANNER);
    expect(preview.body).not.toContain(LV_BANNER);
  });
});
