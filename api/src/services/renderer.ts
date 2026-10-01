import Handlebars from 'handlebars';
import type { Repository } from '../db/repository.js';
import type { Company, ComposeType, ResolvedUser, Settings, SharedMailbox } from '../types.js';
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
}

/**
 * Handlebars with escaping ON. Triple-stash ({{{ }}}) and SafeString helpers are rejected at
 * compile/save time so user data can never reach the output unescaped.
 */
const hb = Handlebars.create();
hb.registerHelper('tel', (v: unknown) => telHref(typeof v === 'string' ? v : ''));
hb.registerHelper('eq', (a: unknown, b: unknown) => a === b);

export class TemplateError extends Error {
  constructor(message: string, readonly line?: number) {
    super(message);
  }
}

export function validateTemplateSource(src: string): void {
  if (/\{\{\{|\{\{&/.test(src)) {
    throw new TemplateError('Unescaped output ({{{ … }}} or {{& … }}) is not allowed in signature templates.');
  }
  if (/<script[\s>]/i.test(src)) throw new TemplateError('<script> is not allowed in signature templates.');
  try {
    hb.precompile(src, { strict: false });
  } catch (e: any) {
    const line = /line (\d+)/.exec(e.message)?.[1];
    throw new TemplateError(e.message.split('\n')[0], line ? Number(line) : undefined);
  }
}

export function validateMeta(src: string): TemplateMeta {
  let meta: TemplateMeta;
  try {
    meta = JSON.parse(src);
  } catch (e: any) {
    throw new TemplateError(`meta.json is not valid JSON: ${e.message}`);
  }
  if (meta.logo && (!meta.logo.file || !meta.logo.width || !meta.logo.height)) {
    throw new TemplateError('meta.logo needs file, width and height');
  }
  for (const [k, v] of Object.entries(meta.colors ?? {})) {
    if (!/^#[0-9a-f]{3,8}$/i.test(v)) throw new TemplateError(`Colour "${k}" must be a hex value like #1F4E8C`);
  }
  if (meta.websites && !Array.isArray(meta.websites)) throw new TemplateError('meta.websites must be a list');
  for (const w of meta.websites ?? []) {
    if (!w?.label) throw new TemplateError('Every website needs a label, e.g. www.tenax.lv');
    if (w.url && !/^https?:\/\//i.test(w.url)) throw new TemplateError(`Website link "${w.url}" must start with https://`);
  }
  if (meta.banner) {
    if (!meta.banner.file || !meta.banner.width || !meta.banner.height) throw new TemplateError('meta.banner needs file, width and height');
    if (meta.banner.link && !/^https?:\/\//i.test(meta.banner.link)) throw new TemplateError('The banner link must start with https://');
  }
  return meta;
}

type Compiled = HandlebarsTemplateDelegate;

export class Renderer {
  private compiled = new Map<number, Compiled>();

  constructor(private repo: Repository) {}

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
    draft?: { template?: string; meta?: string };
  }): string {
    const kind = opts.type === 'newMail' ? 'new' : 'reply';
    const stored = this.repo.latestTemplate(opts.company.key, kind);
    const storedMeta = this.repo.latestTemplate(opts.company.key, 'meta');
    const metaSrc = opts.draft?.meta ?? storedMeta?.content ?? '{}';
    const meta = validateMeta(metaSrc);

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
      user: applyLanguage(opts.data, opts.settings.language),
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
  };
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
