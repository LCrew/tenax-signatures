import Handlebars from 'handlebars';
import { z } from 'zod';
import type { Repository } from '../db/repository.js';
import type { Company, ComposeType, Design, MetaOverrides, ResolvedUser, Settings, SharedMailbox } from '../types.js';
import { applyOverrides } from './designs.js';
import type { ImageSignatures } from './imagesig.js';
import { telHref } from './phone.js';
import { stripBlocksHeader } from './blocks.js';

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
}

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
    banner: z
      .union([
        z.null(),
        z.object({ file: assetFile, width: px(1200), height: px(1200), link: z.union([httpsUrl, z.literal('')]).optional(), alt: text(200).optional() }).strict(),
      ])
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
  ) {}

  private compile(id: number, src: string): Compiled {
    let fn = this.compiled.get(id);
    if (!fn) {
      fn = hb.compile(stripBlocksHeader(src), { noEscape: false, strict: false });
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
    const metaSrc = applyOverrides(companyMeta, opts.draft?.metaOverrides ?? opts.design?.metaOverrides);
    const meta = validateMeta(metaSrc);
    // A personal closing line replaces the company/design one ('' hides it).
    if (opts.data.greeting != null) meta.greeting = opts.data.greeting;
    // A personal address line replaces the company's, wherever the design shows it.
    if (opts.data.address) meta.footer = { ...meta.footer, address: opts.data.address };
    // A design can choose its own job title language (e.g. an English design for foreign clients).
    const language = opts.design?.language ?? opts.settings.language;

    // Image designs: one rendered PNG for new messages and replies alike (Vareno's SVG signature).
    if (opts.design?.format === 'image' && opts.draft?.template == null) {
      if (!this.images) throw new TemplateError('Image designs are not available here');
      const { greeting: _g, address: _a, ...d } = applyLanguage(opts.data, language);
      return this.images.html({
        company: opts.company,
        design: { id: opts.design.id, name: opts.design.name ?? opts.design.id },
        // The closing line is HTML above the image, never part of the rendered image. {{address}}: theirs, else the company's.
        values: { ...d, address: meta.footer?.address || null },
        publicUrl: opts.settings.publicUrl,
        greeting: meta.greeting,
        greetingColor: meta.colors?.text,
      });
    }

    let fn: Compiled;
    if (opts.draft?.template != null) {
      validateTemplateSource(opts.draft.template);
      fn = hb.compile(stripBlocksHeader(opts.draft.template));
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
      },
      type: opts.type,
    };
    return fn(context).trim();
  }
}

function applyLanguage(d: SignatureData, lang: Settings['language']): SignatureData {
  if (lang === 'lv') return { ...d, jobTitleEn: null };
  if (lang === 'en') return { ...d, jobTitleLv: d.jobTitleEn ?? d.jobTitleLv, jobTitleEn: null };
  return d;
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
