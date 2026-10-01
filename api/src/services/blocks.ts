import { z } from 'zod';

/**
 * Visual ("block") signature designs.
 *
 * A design is a small JSON document (layout + ordered blocks with styles). It's compiled here into an
 * email-safe Handlebars template: nested tables, inline styles, one table row per block wrapped in {{#if}} so
 * empty fields drop their whole line. The JSON travels with the template as a leading HTML comment, so template
 * versioning, restore and "reload from disk" work unchanged; the renderer strips the comment before sending.
 */

export const FONTS = {
  calibri: 'Calibri, Arial, Helvetica, sans-serif',
  arial: 'Arial, Helvetica, sans-serif',
  helvetica: 'Helvetica, Arial, sans-serif',
  verdana: 'Verdana, Geneva, sans-serif',
  tahoma: 'Tahoma, Verdana, sans-serif',
  trebuchet: "'Trebuchet MS', Arial, sans-serif",
  segoe: "'Segoe UI', Arial, sans-serif",
  georgia: 'Georgia, serif',
  times: "'Times New Roman', Times, serif",
} as const;
export type FontKey = keyof typeof FONTS;

/**
 * An uploaded font (Settings › Fonts) used in a visual design: "custom:<family>". Email apps draw text with the
 * reader's installed fonts, so it shows only where installed; everyone else sees the chosen fallback.
 * Plain family names only (letters, digits, space, dash), so it can never break out of the style attribute.
 */
export const CUSTOM_FONT = /^custom:[A-Za-z0-9][A-Za-z0-9 -]{0,60}$/;
const fontKeys = Object.keys(FONTS) as [FontKey, ...FontKey[]];

export function fontStack(base: { font: string; fallback?: FontKey }): string {
  if (base.font.startsWith('custom:')) return `'${base.font.slice(7).trim()}', ${FONTS[base.fallback ?? 'arial']}`;
  return FONTS[base.font as FontKey] ?? FONTS.arial;
}

/** Colour tokens resolve to the company's brand colours (meta.json) so one palette drives every block. */
export const COLOR_TOKENS = ['primary', 'text', 'name', 'title', 'muted', 'rule'] as const;
const colorSchema = z.union([z.enum(COLOR_TOKENS), z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colours are hex like #002060')]);
export type BlockColor = z.infer<typeof colorSchema>;

const styleSchema = z
  .object({
    size: z.number().min(6).max(36).optional(),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    uppercase: z.boolean().optional(),
    color: colorSchema.optional(),
    /** Space below the block, px. */
    spaceAfter: z.number().int().min(0).max(48).optional(),
  })
  .strict();
export type BlockStyle = z.infer<typeof styleSchema>;

const id = z.string().min(1).max(40);
const hidden = z.boolean().optional();

const fieldBlock = z.object({
  id,
  hidden,
  type: z.enum(['name', 'jobTitleLv', 'jobTitleEn', 'department', 'email', 'companyLine', 'address']),
  style: styleSchema.default({}),
});
const labelledBlock = z.object({
  id,
  hidden,
  type: z.enum(['mobile', 'officePhone', 'registration']),
  label: z.string().max(40).default(''),
  style: styleSchema.default({}),
});
const websitesBlock = z.object({
  id,
  hidden,
  type: z.literal('websites'),
  arrangement: z.enum(['stack', 'inline']).default('stack'),
  separator: z.string().max(10).default(' | '),
  style: styleSchema.default({}),
});
const textBlock = z.object({ id, hidden, type: z.literal('text'), text: z.string().max(500), style: styleSchema.default({}) });
const spacerBlock = z.object({ id, hidden, type: z.literal('spacer'), height: z.number().int().min(1).max(60) });
const dividerBlock = z.object({
  id,
  hidden,
  type: z.literal('divider'),
  color: colorSchema.default('rule'),
  thickness: z.number().int().min(1).max(6).default(1),
  spaceAfter: z.number().int().min(0).max(48).default(6),
});
const bannerBlock = z.object({ id, hidden, type: z.literal('banner'), spaceAfter: z.number().int().min(0).max(48).default(10) });
const confidentialBlock = z.object({ id, hidden, type: z.literal('confidential'), style: styleSchema.default({}) });

export const blockSchema = z.discriminatedUnion('type', [
  fieldBlock,
  labelledBlock,
  websitesBlock,
  textBlock,
  spacerBlock,
  dividerBlock,
  bannerBlock,
  confidentialBlock,
]);
export type Block = z.infer<typeof blockSchema>;
export type BlockType = Block['type'];

export const blockDocSchema = z
  .object({
    version: z.literal(1),
    layout: z.enum(['side', 'stacked', 'textOnly']),
    logo: z
      .object({
        valign: z.enum(['top', 'middle']).default('middle'),
        /** Gap between logo and text, px. */
        gap: z.number().int().min(0).max(40).default(12),
      })
      .default({ valign: 'middle', gap: 12 }),
    /** Vertical line between logo and text (side layout) or accent bar left of the text (text-only layout). */
    divider: z
      .object({ show: z.boolean().default(true), color: colorSchema.default('primary'), thickness: z.number().int().min(1).max(6).default(1) })
      .default({ show: true, color: 'primary', thickness: 1 }),
    base: z
      .object({
        font: z.union([z.enum(fontKeys), z.string().regex(CUSTOM_FONT, 'Unknown font')]).default('calibri'),
        /** Used where the uploaded font isn't installed. */
        fallback: z.enum(fontKeys).optional(),
        size: z.number().min(6).max(24).default(10),
        lineHeight: z.number().min(1).max(2).default(1.3),
        color: colorSchema.default('text'),
      })
      .default({ font: 'calibri', size: 10, lineHeight: 1.3, color: 'text' }),
    maxWidth: z.number().int().min(280).max(600).default(500),
    greeting: z.object({ show: z.boolean().default(true), style: styleSchema.default({}) }).default({ show: true, style: {} }),
    /** The text column. */
    main: z.array(blockSchema).max(40),
    /** Below the signature: banner, notice, extra lines. */
    footer: z.array(blockSchema).max(20).default([]),
  })
  .strict();
export type BlockDoc = z.infer<typeof blockDocSchema>;

// ─────────────────────────────── Header (blocks travel inside the template) ───────────────────────────────

const HEADER_RE = /^\s*<!-- sig-blocks:v1:([A-Za-z0-9+/=]+) -->\r?\n?/;

export function embedBlocks(doc: BlockDoc, html: string): string {
  return `<!-- sig-blocks:v1:${Buffer.from(JSON.stringify(doc), 'utf8').toString('base64')} -->\n${html}`;
}

/** Block document stored in a template, or null for hand-written HTML templates. */
export function extractBlocks(template: string): BlockDoc | null {
  const m = HEADER_RE.exec(template);
  if (!m) return null;
  try {
    const parsed = blockDocSchema.safeParse(JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Removes the design-data comment so it never reaches an email. */
export function stripBlocksHeader(template: string): string {
  return template.replace(HEADER_RE, '');
}

// ─────────────────────────────── Compiler ───────────────────────────────

/** HTML-escape static text AND neutralise Handlebars syntax so admin-typed text is always literal. */
function literal(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;');
}

function color(c: BlockColor | undefined, fallback: BlockColor): string {
  const v = c ?? fallback;
  // @root so tokens also resolve inside {{#each}} (websites).
  return v.startsWith('#') ? v : `{{@root.meta.colors.${v}}}`;
}

const round = (n: number) => Math.round(n * 10) / 10;

function textCss(doc: BlockDoc, style: BlockStyle = {}, defaults: Partial<BlockStyle> = {}): string {
  const s = { ...defaults, ...style };
  const size = s.size ?? doc.base.size;
  return [
    `font-family:${fontStack(doc.base)}`,
    `font-size:${size}pt`,
    `line-height:${round(size * doc.base.lineHeight)}pt`,
    `color:${color(s.color, doc.base.color)}`,
    `font-weight:${s.bold ? 'bold' : 'normal'}`,
    s.italic ? 'font-style:italic' : '',
    s.uppercase ? 'text-transform:uppercase' : '',
  ]
    .filter(Boolean)
    .join(';');
}

const linkCss = (c: string) => `color:${c};text-decoration:none;`;

/** Sensible per-block defaults so a fresh block looks right without styling. */
export const BLOCK_DEFAULTS: Partial<Record<BlockType, Partial<BlockStyle>>> = {
  name: { size: 12, bold: true, color: 'name' },
  jobTitleLv: { size: 11, color: 'title' },
  jobTitleEn: { color: 'muted' },
  email: { color: 'primary' },
  websites: { color: 'primary' },
  confidential: { size: 7, italic: true, color: 'muted' },
};

/** [condition, inner HTML] for each block; condition null = always shown. */
function blockContent(doc: BlockDoc, b: Block): [string | null, string] {
  const style = 'style' in b ? b.style : {};
  const d = BLOCK_DEFAULTS[b.type] ?? {};
  const c = color(style?.color, d.color ?? doc.base.color);
  switch (b.type) {
    case 'name':
      return ['user.displayName', '{{user.displayName}}'];
    case 'jobTitleLv':
      return ['user.jobTitleLv', '{{user.jobTitleLv}}'];
    case 'jobTitleEn':
      return ['user.jobTitleEn', '{{user.jobTitleEn}}'];
    case 'department':
      return ['user.department', '{{user.department}}'];
    case 'email':
      return ['user.email', `<a href="mailto:{{user.email}}" style="${linkCss(c)}">{{user.email}}</a>`];
    case 'companyLine':
      return ['meta.footer.companyLine', '{{meta.footer.companyLine}}'];
    case 'address':
      return ['meta.footer.address', '{{meta.footer.address}}'];
    case 'mobile':
      return ['user.mobilePhone', `${b.label ? literal(b.label) + ' ' : ''}<a href="tel:{{tel user.mobilePhone}}" style="${linkCss(c)}">{{user.mobilePhone}}</a>`];
    case 'officePhone':
      return ['user.officePhone', `${b.label ? literal(b.label) + ' ' : ''}<a href="tel:{{tel user.officePhone}}" style="${linkCss(c)}">{{user.officePhone}}</a>`];
    case 'registration':
      return ['meta.footer.registrationNumber', `${b.label ? literal(b.label) + ' ' : ''}{{meta.footer.registrationNumber}}`];
    case 'websites': {
      const sep = b.arrangement === 'inline' ? literal(b.separator) : '<br>';
      return [
        'meta.websites',
        `{{#each meta.websites}}<a href="{{url}}" style="${linkCss(c)}">{{label}}</a>{{#unless @last}}${sep}{{/unless}}{{/each}}`,
      ];
    }
    case 'text':
      return [null, literal(b.text).replace(/\r?\n/g, '<br>')];
    case 'confidential':
      return ['meta.footer.confidential', '{{meta.footer.confidential}}'];
    default:
      return [null, ''];
  }
}

function blockRow(doc: BlockDoc, b: Block): string {
  if (b.hidden) return '';
  if (b.type === 'spacer') {
    return `<tr><td style="height:${b.height}px;line-height:${b.height}px;font-size:1px;">&nbsp;</td></tr>`;
  }
  if (b.type === 'divider') {
    return `<tr><td style="padding:0 0 ${b.spaceAfter}px 0;"><table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%" style="border-collapse:collapse;"><tr><td style="border-top:${b.thickness}px solid ${color(b.color, 'rule')};height:1px;line-height:1px;font-size:1px;">&nbsp;</td></tr></table></td></tr>`;
  }
  if (b.type === 'banner') {
    return `{{#if meta.bannerUrl}}<tr><td style="padding:0 0 ${b.spaceAfter}px 0;">{{#if meta.banner.link}}<a href="{{meta.banner.link}}" style="text-decoration:none;">{{/if}}<img src="{{meta.bannerUrl}}" width="{{meta.banner.width}}" height="{{meta.banner.height}}" alt="{{meta.banner.alt}}" style="display:block;border:0;width:{{meta.banner.width}}px;max-width:100%;height:auto;">{{#if meta.banner.link}}</a>{{/if}}</td></tr>{{/if}}`;
  }
  const style = b.style ?? {};
  const d = BLOCK_DEFAULTS[b.type] ?? {};
  const space = style.spaceAfter ?? d.spaceAfter ?? 0;
  const [cond, inner] = blockContent(doc, b);
  const extra = b.type === 'confidential' ? 'text-align:justify;' : '';
  const row = `<tr><td style="padding:0 0 ${space}px 0;${extra}${textCss(doc, style, d)}">${inner}</td></tr>`;
  return cond ? `{{#if ${cond}}}${row}{{/if}}` : row;
}

function rows(doc: BlockDoc, blocks: Block[]): string {
  return blocks.map((b) => blockRow(doc, b)).filter(Boolean).join('\n      ');
}

const TABLE = 'cellpadding="0" cellspacing="0" border="0" role="presentation"';

export function compileBlocks(doc: BlockDoc, kind: 'new' | 'reply'): string {
  const font = fontStack(doc.base);
  const divider = doc.divider.show ? `border-left:${doc.divider.thickness}px solid ${color(doc.divider.color, 'primary')};` : '';
  const valign = doc.logo.valign;
  const gap = doc.logo.gap;
  const logo = `<img src="{{meta.logoUrl}}" width="{{meta.logoWidth}}" height="{{meta.logoHeight}}" alt="{{meta.logoAlt}}" style="display:block;border:0;width:{{meta.logoWidth}}px;height:{{meta.logoHeight}}px;">`;
  const main = `<table ${TABLE} style="border-collapse:collapse;">\n      ${rows(doc, doc.main)}\n    </table>`;

  let body: string;
  if (doc.layout === 'side') {
    const textPad = doc.divider.show ? `padding:0 0 0 ${gap}px;` : 'padding:0;';
    body = `<table ${TABLE} style="border-collapse:collapse;max-width:${doc.maxWidth}px;font-family:${font};">
  <tr>
    <td style="padding:0 ${gap}px 0 0;vertical-align:${valign};">${logo}</td>
    <td style="${textPad}vertical-align:${valign};${divider}">
    ${main}
    </td>
  </tr>
</table>`;
  } else if (doc.layout === 'stacked') {
    body = `<table ${TABLE} style="border-collapse:collapse;max-width:${doc.maxWidth}px;font-family:${font};">
  <tr><td style="padding:0 0 ${gap}px 0;">${logo}</td></tr>
  <tr>
    <td style="${doc.divider.show ? `padding:0 0 0 ${gap}px;` : 'padding:0;'}${divider}">
    ${main}
    </td>
  </tr>
</table>`;
  } else {
    body = `<table ${TABLE} style="border-collapse:collapse;max-width:${doc.maxWidth}px;font-family:${font};">
  <tr>
    <td style="${doc.divider.show ? `padding:0 0 0 ${gap}px;` : 'padding:0;'}${divider}">
    ${main}
    </td>
  </tr>
</table>`;
  }

  const greeting = doc.greeting.show
    ? `{{#if meta.greeting}}<p style="margin:0 0 ${doc.greeting.style.spaceAfter ?? 12}px 0;${textCss(doc, doc.greeting.style, { size: 11 })}">{{meta.greeting}}</p>{{/if}}\n`
    : '';
  const footerRows = rows(doc, doc.footer ?? []);
  const footer = footerRows
    ? `\n<table ${TABLE} style="border-collapse:collapse;width:100%;max-width:600px;margin-top:10px;">\n      ${footerRows}\n</table>`
    : '';

  const html = `<!-- signature:{{company.key}}:${kind} -->\n${greeting}${body}${footer}\n`;
  return embedBlocks(doc, html);
}

// ─────────────────────────────── Presets ───────────────────────────────

let seq = 0;
const bid = (t: string) => `${t}-${++seq}`;

export function presetDoc(preset: 'side' | 'stacked' | 'textOnly' | 'reply'): BlockDoc {
  seq = 0;
  const contact: Block[] = [
    { id: bid('mobile'), type: 'mobile', label: 'M:', style: {} },
    { id: bid('officePhone'), type: 'officePhone', label: 'T:', style: {} },
    { id: bid('email'), type: 'email', style: {} },
    { id: bid('websites'), type: 'websites', arrangement: 'stack', separator: ' | ', style: {} },
    { id: bid('companyLine'), type: 'companyLine', style: {} },
    { id: bid('registration'), type: 'registration', label: 'Reģ. nr.', style: {} },
    { id: bid('address'), type: 'address', style: {} },
  ];
  const heading: Block[] = [
    { id: bid('name'), type: 'name', style: {} },
    { id: bid('jobTitleLv'), type: 'jobTitleLv', style: {} },
    { id: bid('jobTitleEn'), type: 'jobTitleEn', style: { spaceAfter: 6 } },
  ];
  const footer: Block[] = [
    { id: bid('banner'), type: 'banner', spaceAfter: 10 },
    { id: bid('confidential'), type: 'confidential', style: {} },
  ];
  if (preset === 'reply') {
    return blockDocSchema.parse({
      version: 1,
      layout: 'textOnly',
      divider: { show: true, color: 'primary', thickness: 2 },
      logo: { valign: 'top', gap: 8 },
      main: [
        { id: bid('name'), type: 'name', style: { size: 10 } },
        { id: bid('jobTitleLv'), type: 'jobTitleLv', style: { size: 10, color: 'muted' } },
        { id: bid('companyLine'), type: 'companyLine', style: {} },
        { id: bid('mobile'), type: 'mobile', label: 'M:', style: {} },
        { id: bid('email'), type: 'email', style: {} },
      ],
      footer: [],
    });
  }
  return blockDocSchema.parse({
    version: 1,
    layout: preset,
    divider: { show: preset === 'side', color: 'primary', thickness: 1 },
    logo: { valign: preset === 'side' ? 'middle' : 'top', gap: preset === 'stacked' ? 10 : 12 },
    main: [...heading, ...contact],
    footer,
  });
}
