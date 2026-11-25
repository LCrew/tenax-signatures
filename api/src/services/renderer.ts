import Handlebars from 'handlebars';
import { z } from 'zod';
import type { Repository } from '../db/repository.js';
import type { Company, ComposeType, Design, MetaOverrides, PersonLanguage, ResolvedUser, Settings, SharedMailbox, SignatureLocale } from '../types.js';
import { keepBannerProportions, type ImageSize } from './assets.js';
import { applyOverrides } from './designs.js';
import type { ImageSignatures } from './imagesig.js';
import { telHref } from './phone.js';
import { languageAwareBanners, stripBlocksHeader } from './blocks.js';

export interface TemplateMeta {
  version?: number;
  logo?: { file: string; width: number; height: number; alt?: string };
  colors?: Record<string, string>;
  /** Closing line above the signature, e.g. "Ar cieņu,". Empty = left out. */
  greeting?: string;
  websites?: { label: string; url?: string }[];
  footer?: {
    companyLine?: string;
    registrationNumber?: string;
    address?: string;
    /** Legacy single website (pre-websites[] meta files). */
    website?: string;
    confidential?: string;
  };
  /** Optional promo banner under the signature (new messages only in the shipped designs). */
  banner?: { file: string; width: number; height: number; link?: string; alt?: string } | null;
  /**
   * The other signature languages (Brand › Languages and banners). greeting and banner above are the Latvian ones.
   * Per language: greeting left out = the standard one (et/lt) or the Latvian one (en); banner left out = the Latvian
   * banner, null = no banner.
   */
  languages?: Partial<Record<Exclude<SignatureLocale, 'lv'>, { greeting?: string; banner?: TemplateMeta['banner'] }>>;
}

/** Closing lines Estonian and Lithuanian signatures get until the company sets its own. */
export const STANDARD_GREETINGS: Record<PersonLanguage, string> = { et: 'Lugupidamisega,', lt: 'Pagarbiai,' };

export interface SignatureData {
  displayName: string | null;
  jobTitleLv: string | null;
  jobTitleEn: string | null;
  mobilePhone: string | null;
  officePhone: string | null;
  email: string | null;
  department: string | null;
  /** The person's own closing line (null/undefined = the design's; '' = none). */
  greeting?: string | null;
  /** The person's own address line (null/undefined = the company's). */
  address?: string | null;
  /** Estonian / Lithuanian colleague (jobTitleLv then holds the title in that language); null = Latvian. */
  language?: PersonLanguage | null;
}

/**
 * Handlebars with escaping ON. Templates are checked on the parsed AST (not with regexes), so no form of
 * unescaped output ({{{x}}}, {{&x}}, {{~{x}~}} …), partials or decorators can reach a signature.
 */
const hb = Handlebars.create();
hb.registerHelper('tel', (v: unknown) => telHref(typeof v === 'string' ? v : ''));
hb.registerHelper('eq', (a: unknown, b: unknown) => a === b);
// Templates must not write to the server log or call unknown helpers.
hb.registerHelper('log', () => '');
hb.registerHelper('helperMissing', function (...args: any[]) {
  const options = args[args.length - 1];
  if (args.length > 1) throw new TemplateError(`Unknown helper "${options?.name}"`);
  return undefined;
});

export class TemplateError extends Error {
  constructor(message: string, readonly line?: number) {
    super(message);
  }
}

const ALLOWED_BLOCK_HELPERS = new Set(['if', 'unless', 'each', 'with']);
const ALLOWED_HELPERS = new Set(['tel', 'eq']);

class SafetyVisitor extends (Handlebars as any).Visitor {
  MustacheStatement(node: any) {
    if (node.escaped === false) {
      throw new TemplateError('Unescaped output ({{{ … }}} or {{& … }}) is not allowed in signature templates.', node.loc?.start?.line);
    }
    if (node.params?.length && !ALLOWED_HELPERS.has(node.path?.original)) {
      throw new TemplateError(`Unknown helper "${node.path?.original}"`, node.loc?.start?.line);
    }
    return super.MustacheStatement(node);
  }
  BlockStatement(node: any) {
    if (!ALLOWED_BLOCK_HELPERS.has(node.path?.original)) {
      throw new TemplateError(`Only {{#if}}, {{#unless}}, {{#each}} and {{#with}} blocks are allowed (found {{#${node.path?.original}}})`, node.loc?.start?.line);
    }
    return super.BlockStatement(node);
  }
  PartialStatement(node: any) {
    throw new TemplateError('Partials ({{> … }}) are not allowed in signature templates.', node.loc?.start?.line);
  }
  PartialBlockStatement(node: any) {
    throw new TemplateError('Partials ({{#> … }}) are not allowed in signature templates.', node.loc?.start?.line);
  }
  DecoratorBlock(node: any) {
    throw new TemplateError('Decorators are not allowed in signature templates.', node.loc?.start?.line);
  }
  Decorator(node: any) {
    throw new TemplateError('Decorators are not allowed in signature templates.', node.loc?.start?.line);
  }
}

export function validateTemplateSource(src: string): void {
  if (/<script[\s>]/i.test(src)) throw new TemplateError('<script> is not allowed in signature templates.');
  let ast: unknown;
  try {
    ast = hb.parse(src);
  } catch (e: any) {
    const line = /line (\d+)/.exec(e.message)?.[1];
    throw new TemplateError(e.message.split('\n')[0], line ? Number(line) : undefined);
  }
  new SafetyVisitor().accept(ast);
}

// Strict schema for brand settings (meta.json). Everything that reaches an attribute or style is typed and bounded,
// so e.g. a logo width can't smuggle CSS ("1px;background:url(…)").
const httpsUrl = z
  .string()
  .max(500)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === 'https:' && !u.username && !u.password;
    } catch {
      return false;
    }
  }, 'Links must be full https:// addresses');
const assetFile = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}\.(png|jpe?g|gif)$/i, 'Image file name: letters, digits, dot, dash; .png/.jpg/.gif');
const px = (max: number) => z.number().int().min(1).max(max);
const text = (max: number) => z.string().max(max);
const bannerSchema = z.union([
  z.null(),
  z.object({ file: assetFile, width: px(1200), height: px(1200), link: z.union([httpsUrl, z.literal('')]).optional(), alt: text(200).optional() }).strict(),
]);
const metaSchema = z
  .object({
    version: z.number().optional(),
    logo: z.object({ file: assetFile, width: px(1200), height: px(1200), alt: text(200).optional() }).strict().optional(),
    colors: z
      .record(z.enum(['primary', 'text', 'name', 'title', 'muted', 'rule']), z.string().regex(/^#[0-9a-fA-F]{3,8}$/, 'Colours must be hex values like #1F4E8C'))
      .optional(),
    greeting: text(200).optional(),
    websites: z.array(z.object({ label: z.string().min(1, 'Every website needs a label, e.g. www.tenax.lv').max(100), url: z.union([httpsUrl, z.literal('')]).optional() }).strict()).max(8).optional(),
    footer: z
      .object({
        companyLine: text(200).optional(),
        registrationNumber: text(60).optional(),
        address: text(300).optional(),
        website: text(100).optional(),
        confidential: text(3000).optional(),
      })
      .strict()
      .optional(),
    banner: bannerSchema.optional(),
    languages: z
      .object(Object.fromEntries(['en', 'et', 'lt'].map((l) => [l, z.object({ greeting: text(200).optional(), banner: bannerSchema.optional() }).strict().optional()])))
      .strict()
      .optional(),
  })
  .strict();

export function validateMeta(src: string): TemplateMeta {
  let raw: unknown;
  try {
    raw = JSON.parse(src);
  } catch (e: any) {
    throw new TemplateError(`Brand settings are not valid JSON: ${e.message}`);
  }
  const parsed = metaSchema.safeParse(raw);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    throw new TemplateError(`${i.path.join('.') || 'Brand settings'}: ${i.message}`);
  }
  return parsed.data as TemplateMeta;
}

type Compiled = HandlebarsTemplateDelegate;

export class Renderer {
  private compiled = new Map<number, Compiled>();

  constructor(
    private repo: Repository,
    /** Image (SVG) designs; optional so plain HTML rendering works without fonts (tests, scripts). */
    private images?: ImageSignatures,
    /** Pixel size of a company's banner file, so banners go out at their own proportions; optional like `images`. */
    private assetSize?: (company: string, file: string) => ImageSize | null,
  ) {}

  private fitBanners(html: string, publicUrl: string): string {
    return this.assetSize ? keepBannerProportions(html, publicUrl, this.assetSize) : html;
  }

  private compile(id: number, src: string): Compiled {
    let fn = this.compiled.get(id);
    if (!fn) {
      fn = hb.compile(languageAwareBanners(stripBlocksHeader(src)), { noEscape: false, strict: false });
      this.compiled.set(id, fn);
    }
    return fn;
  }

  /** Render with the latest stored template, or with a draft source (editor preview). */
  render(opts: {
    company: Company;
    type: ComposeType;
    data: SignatureData;
    settings: Settings;
    /** Which design (default design when omitted); its wording overrides apply on top of the company brand. */
    design?: Pick<Design, 'id' | 'metaOverrides'> & Partial<Pick<Design, 'name' | 'format' | 'language'>>;
    draft?: { template?: string; meta?: string; metaOverrides?: MetaOverrides };
  }): string {
    const kind = opts.type === 'newMail' ? 'new' : 'reply';
    // A design without its own template (shouldn't happen: designs are created as copies) falls back to the default.
    const stored = this.repo.latestTemplate(opts.company.key, kind, opts.design?.id) ?? this.repo.latestTemplate(opts.company.key, kind);
    const storedMeta = this.repo.latestTemplate(opts.company.key, 'meta');
    const companyMeta = opts.draft?.meta ?? storedMeta?.content ?? '{}';
    // A design can choose its own job title language (e.g. an English design for foreign clients).
    const language = opts.design?.language ?? opts.settings.language;
    // Closing line and promo banner follow the language the signature is written in: Estonian / Lithuanian colleagues
    // get theirs, English designs the English ones; the person's own closing line goes on top.
    const locale = signatureLocale(opts.data.language, language);
    const overrides = opts.draft?.metaOverrides ?? opts.design?.metaOverrides;
    const meta = validateMeta(designMeta(companyMeta, locale, overrides));
    const languageBanner = ownBannerReplacesLayouts(companyMeta, locale, overrides);
    // A personal closing line replaces the company/design one ('' hides it).
    if (opts.data.greeting != null) meta.greeting = opts.data.greeting;
    // A personal address line replaces the company's, wherever the design shows it.
    if (opts.data.address) meta.footer = { ...meta.footer, address: opts.data.address };

    // Image designs: one rendered PNG for new messages and replies alike (Vareno's SVG signature), plus its promo banner in new messages.
    if (opts.design?.format === 'image' && opts.draft?.template == null) {
      if (!this.images) throw new TemplateError('Image designs are not available here');
      const { greeting: _g, address: _a, language: _l, ...d } = applyLanguage(opts.data, language);
      const html = this.images.html({
        company: opts.company,
        design: { id: opts.design.id, name: opts.design.name ?? opts.design.id },
        type: opts.type,
        // The closing line is HTML above the image, never part of the rendered image. {{address}}: theirs, else the company's.
        values: { ...d, address: meta.footer?.address || null },
        publicUrl: opts.settings.publicUrl,
        greeting: meta.greeting,
        greetingColor: meta.colors?.text,
      });
      return this.fitBanners(html, opts.settings.publicUrl);
    }

    let fn: Compiled;
    if (opts.draft?.template != null) {
      validateTemplateSource(opts.draft.template);
      fn = hb.compile(languageAwareBanners(stripBlocksHeader(opts.draft.template)));
    } else {
      if (!stored) throw new TemplateError(`No ${kind} template for company ${opts.company.key}`);
      fn = this.compile(stored.id, stored.content);
    }

    const base = opts.settings.publicUrl.replace(/\/+$/, '');
    const asset = (file: string) => `${base}/assets/${encodeURIComponent(opts.company.key)}/${encodeURIComponent(file)}`;
    const toUrl = (s: string) => (/^https?:\/\//i.test(s) ? s : `https://${s}`);
    const websites = (meta.websites ?? (meta.footer?.website ? [{ label: meta.footer.website }] : [])).map((w) => ({
      label: w.label,
      url: toUrl(w.url || w.label),
    }));
    const context = {
      user: applyLanguage(opts.data, language),
      company: {
        key: opts.company.key,
        displayName: opts.company.displayName,
        legalName: opts.company.legalName,
      },
      meta: {
        ...meta,
        colors: { primary: '#000000', text: '#222222', muted: '#666666', rule: '#DDDDDD', ...meta.colors },
        logoUrl: meta.logo ? asset(meta.logo.file) : '',
        logoWidth: meta.logo?.width,
        logoHeight: meta.logo?.height,
        logoAlt: meta.logo?.alt || opts.company.displayName,
        websites,
        footer: {
          ...meta.footer,
          websiteUrl: websites[0]?.url ?? '',
        },
        bannerUrl: meta.banner ? asset(meta.banner.file) : '',
        // For banners chosen per layout (block designer): <assetBase><file>.
        assetBase: `${base}/assets/${encodeURIComponent(opts.company.key)}/`,
        // Estonian / Lithuanian colleagues whose language has its own banner (or none): that, not a layout's banner.
        languageBanner,
      },
      type: opts.type,
    };
    return this.fitBanners(fn(context).trim(), base);
  }
}

/**
 * Which job titles show. Latvian colleagues: the design's (or Settings') choice. Estonian / Lithuanian colleagues
 * always get their own-language title (jobTitleLv) and the English one, except in designs set to English only.
 */
function applyLanguage(d: SignatureData, lang: Settings['language']): SignatureData {
  if (lang === 'en') return { ...d, jobTitleLv: d.jobTitleEn ?? d.jobTitleLv, jobTitleEn: null };
  if (d.language) return d;
  if (lang === 'lv') return { ...d, jobTitleEn: null };
  return d;
}

/** The language a signature is written in (closing line, promo banner): English designs are English for everyone. */
export function signatureLocale(person: PersonLanguage | null | undefined, titles: Settings['language']): SignatureLocale {
  if (titles === 'en') return 'en';
  return person ?? 'lv';
}

/** Company brand settings (meta.json text) with the closing line and promo banner of `locale`; returns meta.json text. */
export function localizeMeta(metaSrc: string, locale: SignatureLocale): string {
  if (locale === 'lv') return metaSrc;
  let meta: any;
  try {
    meta = JSON.parse(metaSrc);
  } catch {
    return metaSrc; // validateMeta reports it
  }
  if (!meta || typeof meta !== 'object') return metaSrc;
  const own = meta.languages?.[locale];
  const next = { ...meta };
  if (typeof own?.greeting === 'string') next.greeting = own.greeting;
  // No line of their own: the standard Estonian / Lithuanian one, unless the company uses no closing line at all.
  else if (locale !== 'en' && meta.greeting) next.greeting = STANDARD_GREETINGS[locale];
  if (own && own.banner !== undefined) next.banner = own.banner;
  return JSON.stringify(next);
}

/**
 * Company brand settings with a design's wording, in the language the signature is written in; returns meta.json text.
 * Latvian and English: the design's closing line and banner win (an English design's wording is English).
 * Estonian / Lithuanian: a design's own closing line and banner are its Latvian ones, so the language's own win, and a
 * design's own line becomes the language's standard line. A design with no closing line or no banner has none in any
 * language.
 */
export function designMeta(companyMeta: string, locale: SignatureLocale, o: MetaOverrides | undefined): string {
  if (locale === 'lv' || locale === 'en') return applyOverrides(localizeMeta(companyMeta, locale), o);
  const text = localizeMeta(applyOverrides(companyMeta, o), locale);
  if (o?.greeting !== '' && o?.banner !== null) return text;
  try {
    const meta = JSON.parse(text);
    if (o?.greeting === '') meta.greeting = '';
    if (o?.banner === null) meta.banner = null;
    return JSON.stringify(meta);
  } catch {
    return text; // validateMeta reports it
  }
}

/** Whether an Estonian / Lithuanian colleague's language banner (or "no banner") replaces banners picked per layout. */
function ownBannerReplacesLayouts(companyMeta: string, locale: SignatureLocale, o: MetaOverrides | undefined): boolean {
  if (locale !== 'et' && locale !== 'lt') return false;
  if (o?.banner === null) return false;
  try {
    return JSON.parse(companyMeta)?.languages?.[locale]?.banner !== undefined;
  } catch {
    return false;
  }
}

/** Proves a template + brand settings actually render (catches runtime-only failures before they reach Outlook). */
export function trialRender(template: string, metaSrc: string, kind: 'new' | 'reply'): void {
  const meta = validateMeta(metaSrc);
  const fn = hb.compile(stripBlocksHeader(template), { strict: false });
  try {
    fn({
      user: { displayName: 'A', jobTitleLv: 'B', jobTitleEn: 'C', mobilePhone: '+371 20 000 000', officePhone: '+371 60 000 000', email: 'a@example.com', department: 'D' },
      company: { key: 'x', displayName: 'X', legalName: 'X' },
      meta: { ...meta, colors: { primary: '#000000', ...meta.colors }, logoUrl: 'https://x/a.png', logoWidth: 1, logoHeight: 1, logoAlt: 'X', websites: [{ label: 'x', url: 'https://x' }], footer: { ...meta.footer, websiteUrl: 'https://x' }, bannerUrl: '', assetBase: 'https://x/assets/x/' },
      type: kind === 'new' ? 'newMail' : 'reply',
    });
  } catch (e: any) {
    throw new TemplateError(`This template fails when rendered: ${String(e.message).split('\n')[0]}`);
  }
}

export function signatureDataFor(user: ResolvedUser): SignatureData {
  const f = user.fields;
  return {
    displayName: f.displayName,
    jobTitleLv: f.jobTitleLv,
    jobTitleEn: f.jobTitleEn,
    mobilePhone: f.hideMobile ? null : f.mobilePhone,
    officePhone: f.officePhone,
    email: f.email,
    department: f.department,
    greeting: f.greeting,
    address: f.address,
    language: f.language,
  };
}

/** The company's address line (Brand and footer): what a person gets without their own. */
export function companyAddress(repo: Repository, company: string): string {
  try {
    return String(JSON.parse(repo.latestTemplate(company, 'meta')?.content ?? '{}').footer?.address ?? '');
  } catch {
    return '';
  }
}

export function signatureDataForMailbox(m: SharedMailbox): SignatureData {
  return {
    displayName: m.displayName,
    jobTitleLv: null,
    jobTitleEn: null,
    mobilePhone: null,
    officePhone: m.officePhone,
    email: m.email,
    department: null,
  };
}
