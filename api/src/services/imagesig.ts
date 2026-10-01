import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Repository, TemplateVersion } from '../db/repository.js';
import type { Company, Design } from '../types.js';
import type { Fonts } from './fonts.js';
import { displayHeight, imageConfigSchema, renderSignaturePng, type ImageConfig, type PersonValues } from './svgsig.js';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Image signatures: the person's details rendered into the design's SVG and served as a PNG at
 *   <publicUrl>/sig-img/<hash>.png
 * The hash identifies a render the server already decided on (template version + values + fonts), stored in
 * rendered_images, so the URL can't be used to draw arbitrary text. Old emails keep their image forever.
 */
export class ImageSignatures {
  constructor(
    private repo: Repository,
    readonly fonts: Fonts,
    private cacheDir: string,
  ) {}

  latest(company: string, designId: string): { version: TemplateVersion; cfg: ImageConfig } | null {
    const v = this.repo.latestTemplate(company, 'image', designId);
    if (!v) return null;
    return { version: v, cfg: imageConfigSchema.parse(JSON.parse(v.content)) };
  }

  /** The signature HTML: an <img> (linked if configured) with the details as alt text. */
  html(opts: { company: Company; design: Pick<Design, 'id' | 'name'>; values: PersonValues; publicUrl: string; greeting?: string; greetingColor?: string }): string {
    const latest = this.latest(opts.company.key, opts.design.id);
    if (!latest) throw new Error(`The image design "${opts.design.name}" has no SVG template yet`);
    const { version, cfg } = latest;
    const valuesJson = JSON.stringify(opts.values);
    const hash = crypto.createHash('sha256').update(`${version.id}|${this.fonts.fingerprint()}|${valuesJson}`).digest('hex').slice(0, 40);
    this.repo.saveRenderedImage({ hash, company: opts.company.key, design: opts.design.id, templateId: version.id, valuesJson });

    const v = opts.values;
    const alt = [
      [v.displayName, v.jobTitleLv || v.jobTitleEn].filter(Boolean).join(', '),
      opts.company.legalName,
      v.mobilePhone && `Mob: ${v.mobilePhone}`,
      v.officePhone && `Tālr.: ${v.officePhone}`,
      v.email,
      cfg.link && cfg.link.replace(/^https:\/\//, ''),
    ]
      .filter(Boolean)
      .join(' | ');
    const w = cfg.width;
    const h = displayHeight(cfg);
    const src = `${opts.publicUrl.replace(/\/+$/, '')}/sig-img/${hash}.png`;
    const img = `<img src="${esc(src)}" width="${w}" height="${h}" alt="${esc(alt)}" style="display:block;border:0;width:${w}px;max-width:100%;height:auto;">`;
    const linked = cfg.link ? `<a href="${esc(cfg.link)}" style="text-decoration:none;">${img}</a>` : img;
    const greeting = opts.greeting
      ? `<p style="margin:0 0 12px 0;font-family:Calibri, Arial, Helvetica, sans-serif;font-size:11pt;color:${esc(opts.greetingColor ?? '#222222')};">${esc(opts.greeting)}</p>\n`
      : '';
    return `<!-- signature:${esc(opts.company.key)}:image -->\n${greeting}${linked}`;
  }

  /** PNG for a public image URL; rendered on first request and cached on disk. */
  png(hash: string): Buffer | null {
    if (!/^[a-f0-9]{40}$/.test(hash)) return null;
    const file = path.join(this.cacheDir, `${hash}.png`);
    if (fs.existsSync(file)) return fs.readFileSync(file);
    const row = this.repo.getRenderedImage(hash);
    if (!row) return null;
    const version = this.repo.getTemplateVersion(row.templateId);
    if (!version) return null;
    const png = renderSignaturePng(imageConfigSchema.parse(JSON.parse(version.content)), JSON.parse(row.valuesJson), this.fonts.files());
    fs.mkdirSync(this.cacheDir, { recursive: true });
    fs.writeFileSync(file, png);
    return png;
  }

  /** Unsaved settings in the console: rendered straight to a data: URL. */
  previewDataUrl(cfg: ImageConfig, values: PersonValues): string {
    return `data:image/png;base64,${renderSignaturePng(cfg, values, this.fonts.files()).toString('base64')}`;
  }
}
