import { Resvg } from '@resvg/resvg-js';
import { DOMParser, XMLSerializer, type Document, type Element } from '@xmldom/xmldom';
import { z } from 'zod';

/**
 * Image signatures from an SVG template (e.g. Vareno's Inkscape design). Email clients don't show SVG, so the
 * template is filled with the person's details and rendered to PNG on the server. The SVG is never served to
 * browsers; it's only rasterised, with fonts limited to the files we pass in.
 */

export const MAX_SVG_BYTES = 5 * 1024 * 1024;

export interface SvgTextLine {
  text: string;
}
export interface SvgTextField {
  id: string;
  lines: SvgTextLine[];
  family: string;
  weight: number;
  size: number;
}
export interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What gets saved (versioned) for an image design. */
export const imageConfigSchema = z
  .object({
    svg: z.string().min(20).max(MAX_SVG_BYTES),
    /** text element id → line templates, e.g. ["Mob: {{mobilePhone}}"]. Unmapped elements keep their text. */
    fields: z.record(
      z.string().max(100),
      z.object({ lines: z.array(z.string().max(200)).max(12), shrinkToFit: z.boolean().default(true) }).strict(),
    ),
    crop: z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() }).strict(),
    /** Width shown in the email, px (rendered at 2x for sharp screens). */
    width: z.number().int().min(200).max(800),
    /** Clicking the image opens this (https only); empty = not clickable. */
    link: z.union([z.literal(''), z.string().max(500).refine((v) => /^https:\/\/[^\s"'<>]+$/i.test(v), 'The link must be a full https:// address')]),
  })
  .strict();
export type ImageConfig = z.infer<typeof imageConfigSchema>;

export interface PersonValues {
  displayName: string | null;
  jobTitleLv: string | null;
  jobTitleEn: string | null;
  mobilePhone: string | null;
  officePhone: string | null;
  email: string | null;
  department: string | null;
  /** Their own address line, else the company's. Optional: older stored renders don't have it. */
  address?: string | null;
}

export const PLACEHOLDERS: [string, string][] = [
  ['{{displayName}}', 'Name'],
  ['{{displayName|upper}}', 'NAME IN CAPITALS'],
  ['{{title}}', 'Job title (Latvian, else English)'],
  ['{{jobTitleLv}}', 'Job title (LV)'],
  ['{{jobTitleEn}}', 'Job title (EN)'],
  ['{{mobilePhone}}', 'Mobile'],
  ['{{officePhone}}', 'Office phone'],
  ['{{email}}', 'Email'],
  ['{{department}}', 'Department'],
  ['{{address}}', 'Address (their own, else the company’s)'],
];

const SVG_NS = 'http://www.w3.org/2000/svg';

function parse(svg: string): Document {
  const errors: string[] = [];
  const doc = new DOMParser({ onError: (level, msg) => level !== 'warning' && errors.push(msg) }).parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  if (errors.length || !root || root.localName !== 'svg') throw new SvgError(`This isn't a valid SVG file${errors[0] ? `: ${errors[0].split('\n')[0]}` : ''}`);
  return doc;
}

export class SvgError extends Error {}

function walk(el: Element, fn: (e: Element) => void) {
  fn(el);
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) walk(n as Element, fn);
}

/**
 * Cleans an uploaded SVG: no scripts, event handlers, foreignObject or external references (only embedded
 * data: images), and drops embedded colour profiles (Inkscape adds ~1 MB; they don't change sRGB rendering).
 */
export function sanitizeSvg(svg: string): string {
  if (Buffer.byteLength(svg) > MAX_SVG_BYTES) throw new SvgError('The SVG is larger than 5 MB');
  const doc = parse(svg);
  const remove: Element[] = [];
  walk(doc.documentElement as unknown as Element, (e) => {
    const name = (e.localName ?? '').toLowerCase();
    if (['script', 'foreignobject', 'color-profile', 'iframe', 'audio', 'video'].includes(name)) return void remove.push(e);
    for (const a of Array.from(e.attributes ?? [])) {
      const n = a.name.toLowerCase();
      const v = a.value.trim().toLowerCase();
      if (n.startsWith('on')) e.removeAttribute(a.name);
      else if ((n === 'href' || n.endsWith(':href')) && !v.startsWith('#') && !v.startsWith('data:image/')) e.removeAttribute(a.name);
    }
  });
  for (const e of remove) e.parentNode?.removeChild(e);
  return new XMLSerializer().serializeToString(doc);
}

function styleValue(e: Element, prop: string): string | undefined {
  for (let n: Element | null = e; n && n.nodeType === 1; n = n.parentNode as Element | null) {
    const style = n.getAttribute?.('style') ?? '';
    const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(style);
    if (m) return m[1].trim();
    const attr = n.getAttribute?.(prop);
    if (attr) return attr;
  }
  return undefined;
}

function firstElementChild(e: Element): Element | null {
  for (let n = e.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) return n as Element;
  return null;
}

/** Innermost element of a line (Inkscape nests a styled tspan inside each positioned line tspan). */
function innermost(e: Element): Element {
  let n = e;
  for (let c = firstElementChild(n); c; c = firstElementChild(n)) n = c;
  return n;
}

/** Replaces a line's text but keeps its nested styled tspans (font, weight, colour). */
function setLineText(doc: Document, line: Element, text: string) {
  const chain: Element[] = [];
  for (let c = firstElementChild(line); c; c = firstElementChild(c)) chain.push(c);
  while (line.firstChild) line.removeChild(line.firstChild);
  let parent = line;
  for (const c of chain) {
    const shallow = c.cloneNode(false) as Element;
    parent.appendChild(shallow);
    parent = shallow;
  }
  parent.appendChild(doc.createTextNode(text));
}

function lineTspans(text: Element): Element[] {
  const out: Element[] = [];
  for (let n = text.firstChild; n; n = n.nextSibling) if (n.nodeType === 1 && (n as Element).localName === 'tspan') out.push(n as Element);
  return out;
}

/** The editable text in a template: one entry per <text>, with its lines (tspans) and font. */
export function listTextFields(svg: string): SvgTextField[] {
  const doc = parse(svg);
  const out: SvgTextField[] = [];
  const texts = doc.getElementsByTagNameNS(SVG_NS, 'text');
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i] as unknown as Element;
    if (t.parentNode && (t.parentNode as Element).localName === 'defs') continue;
    const spans = lineTspans(t);
    const lines = (spans.length ? spans : [t]).map((s) => ({ text: (s.textContent ?? '').replace(/\s+$/g, '') })).filter((l, idx, all) => l.text || all.length === 1);
    if (!lines.some((l) => l.text.trim())) continue;
    const anyLine = innermost(spans[0] ?? t);
    out.push({
      id: t.getAttribute('id') || `text${i}`,
      lines,
      family: (styleValue(anyLine, 'font-family') ?? '').replace(/['"]/g, '').split(',')[0].trim(),
      weight: Number(styleValue(anyLine, 'font-weight') ?? 400) || (styleValue(anyLine, 'font-weight') === 'bold' ? 700 : 400),
      size: parseFloat(styleValue(anyLine, 'font-size') ?? '12') || 12,
    });
  }
  return out;
}

function viewBoxOf(doc: Document): Crop {
  const root = doc.documentElement as unknown as Element;
  const vb = (root.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb.every(Number.isFinite)) return { x: vb[0], y: vb[1], width: vb[2], height: vb[3] };
  return { x: 0, y: 0, width: parseFloat(root.getAttribute('width') ?? '0') || 100, height: parseFloat(root.getAttribute('height') ?? '0') || 100 };
}

function rasterize(svg: string, fonts: string[], widthPx?: number) {
  const r = new Resvg(svg, {
    fitTo: widthPx ? { mode: 'width', value: Math.round(widthPx) } : { mode: 'original' },
    font: { fontFiles: fonts, loadSystemFonts: false, defaultFontFamily: 'Poppins' },
    background: 'rgba(0,0,0,0)',
  });
  return r.render();
}

/** Bounding box of everything visible, in SVG units (used to suggest the crop and measure text). */
function visibleBox(svg: string, fonts: string[]): Crop | null {
  const doc = parse(svg);
  const vb = viewBoxOf(doc);
  const scale = 2; // render at 2 px per unit for a precise edge
  const img = rasterize(svg, fonts, vb.width * scale);
  const { width, height } = img;
  const px = img.pixels;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (px[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const k = vb.width / width;
  return { x: vb.x + minX * k, y: vb.y + minY * k, width: (maxX - minX + 1) * k, height: (maxY - minY + 1) * k };
}

/** Suggested crop: the visible artwork (e.g. the card on an A4 Inkscape page). */
export function suggestCrop(svg: string, fonts: string[]): Crop {
  const doc = parse(svg);
  return visibleBox(svg, fonts) ?? viewBoxOf(doc);
}

function fill(template: string, v: PersonValues): { text: string; hadPlaceholder: boolean; allEmpty: boolean } {
  const values: Record<string, string> = {
    displayName: v.displayName ?? '',
    title: v.jobTitleLv || v.jobTitleEn || '',
    jobTitleLv: v.jobTitleLv ?? '',
    jobTitleEn: v.jobTitleEn ?? '',
    mobilePhone: v.mobilePhone ?? '',
    officePhone: v.officePhone ?? '',
    email: v.email ?? '',
    department: v.department ?? '',
    address: v.address ?? '',
  };
  let had = false;
  let anyValue = false;
  const text = template.replace(/\{\{\s*(\w+)\s*(?:\|\s*(upper)\s*)?\}\}/g, (_m, key: string, filter?: string) => {
    had = true;
    const val = values[key] ?? '';
    if (val) anyValue = true;
    return filter === 'upper' ? val.toLocaleUpperCase('lv-LV') : val;
  });
  return { text, hadPlaceholder: had, allEmpty: had && !anyValue };
}

/**
 * Fills the template and crops it. For each mapped <text>: lines whose placeholders are all empty are dropped and
 * the remaining lines move up into the template's line positions (so a missing mobile leaves no gap). Text is set
 * with textContent, so it can never become markup.
 */
export function fillSvg(cfg: ImageConfig, values: PersonValues): Document {
  const doc = parse(cfg.svg);
  for (const [id, field] of Object.entries(cfg.fields)) {
    const text = doc.getElementById(id) as unknown as Element | null;
    if (!text || text.localName !== 'text') continue;
    const lines = field.lines.map((l) => fill(l, values)).filter((l) => !l.allEmpty).map((l) => l.text);
    const spans = lineTspans(text);
    if (spans.length === 0) {
      setLineText(doc, text, lines.join(' '));
      continue;
    }
    // Template line positions (y/x of each tspan), extended downward if there are more lines than slots.
    const ys = spans.map((s) => s.getAttribute('y'));
    const step = spans.length > 1 ? Number(ys[1]) - Number(ys[0]) : Number.NaN;
    for (let i = 0; i < Math.max(spans.length, lines.length); i++) {
      if (i < lines.length) {
        let span = spans[i];
        if (!span) {
          span = spans[spans.length - 1].cloneNode(true) as Element;
          if (Number.isFinite(step)) span.setAttribute('y', String(Number(ys[spans.length - 1]) + step * (i - spans.length + 1)));
          text.appendChild(span);
        }
        setLineText(doc, span, lines[i]);
      } else {
        text.removeChild(spans[i]);
      }
    }
  }
  return doc;
}

function setFontSize(text: Element, factor: number) {
  walk(text, (e) => {
    const style = e.getAttribute('style');
    if (style && /font-size\s*:/.test(style)) {
      e.setAttribute('style', style.replace(/font-size\s*:\s*([\d.]+)(px)?/, (_m, n: string) => `font-size:${(parseFloat(n) * factor).toFixed(3)}px`));
    }
    const attr = e.getAttribute('font-size');
    if (attr) e.setAttribute('font-size', String(parseFloat(attr) * factor));
  });
}

/** Shrinks mapped text that would run past the crop's right edge (e.g. very long names). */
function shrinkToFit(doc: Document, cfg: ImageConfig, fonts: string[]) {
  const serializer = new XMLSerializer();
  const right = cfg.crop.x + cfg.crop.width * 0.985;
  for (const [id, field] of Object.entries(cfg.fields)) {
    if (!field.shrinkToFit) continue;
    const text = doc.getElementById(id) as unknown as Element | null;
    if (!text) continue;
    // Measure this element alone: hide every other text and graphic by rendering a copy with only it visible.
    const solo = parse(serializer.serializeToString(doc));
    walk(solo.documentElement as unknown as Element, (e) => {
      if (e.getAttribute('id') === id || e.localName === 'defs') return;
      const isShape = ['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'image', 'text', 'use'].includes(e.localName ?? '');
      if (isShape && !hasAncestorId(e, id)) e.setAttribute('visibility', 'hidden');
    });
    const box = visibleBox(serializer.serializeToString(solo), fonts);
    if (!box) continue;
    const over = box.x + box.width - right;
    if (over > 0) {
      const factor = Math.max(0.5, (right - box.x) / box.width);
      setFontSize(text, factor);
    }
  }
}

function hasAncestorId(e: Element, id: string): boolean {
  for (let n = e.parentNode as Element | null; n && n.nodeType === 1; n = n.parentNode as Element | null) if (n.getAttribute('id') === id) return true;
  return false;
}

/** The final PNG (2x the shown width) for one person. */
export function renderSignaturePng(cfg: ImageConfig, values: PersonValues, fonts: string[]): Buffer {
  const doc = fillSvg(cfg, values);
  shrinkToFit(doc, cfg, fonts);
  const root = doc.documentElement as unknown as Element;
  const { x, y, width, height } = cfg.crop;
  root.setAttribute('viewBox', `${x} ${y} ${width} ${height}`);
  root.setAttribute('width', String(width));
  root.setAttribute('height', String(height));
  return rasterize(new XMLSerializer().serializeToString(doc), fonts, cfg.width * 2).asPng();
}

export function displayHeight(cfg: ImageConfig): number {
  return Math.round((cfg.width * cfg.crop.height) / cfg.crop.width);
}

/** Fonts the template uses that aren't available (family + weight). */
export function missingFonts(svg: string, has: (family: string, weight: number) => boolean): string[] {
  const missing = new Set<string>();
  for (const f of listTextFields(svg)) if (f.family && !has(f.family, f.weight)) missing.add(`${f.family} ${f.weight}`);
  return [...missing];
}
